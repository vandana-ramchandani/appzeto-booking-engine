const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Room = require("../models/Room");
const CreditLedger = require("../models/CreditLedger");
const Idempotency = require("../models/Idempotency");
const AuditLog = require("../models/AuditLog");

const {
  time: timeCfg,
  limits: limitsCfg,
  credits: creditsCfg,
} = require("../config/appConfig");
const { parseTimeToMinutes, minutesToHHmm } = require("../utils/timeUtils");

const waitlistService = require("./waitlistService");

function yyyyMmDdToDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function getWeekStartMonday(yyyyMmDd) {
  const dt = yyyyMmDdToDate(yyyyMmDd);
  const day = (dt.getDay() + 6) % 7; // Mon=0..Sun=6
  dt.setDate(dt.getDate() - day);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function validateRecurrenceBody(recurrence) {
  if (!recurrence) return null;
  const { type, count } = recurrence;
  if (type !== "weekly") {
    const err = new Error("recurrence.type must be 'weekly'");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isInteger(count) || count < 1 || count > 8) {
    const err = new Error(
      "recurrence.count must be an integer between 1 and 8",
    );
    err.statusCode = 400;
    throw err;
  }
  return { type, count };
}

function expandWeeklyOccurrences(startDate, count) {
  const start = yyyyMmDdToDate(startDate);
  if (Number.isNaN(start.getTime())) return [];
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime());
    d.setDate(d.getDate() + i * 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

function overlaps(newStartM, newEndM, existingStartM, existingEndM) {
  // boundary touch is not a conflict: [start,end)
  return newStartM < existingEndM && newEndM > existingStartM;
}

function validateWorkingHours(startTime, endTime) {
  const startM = parseTimeToMinutes(startTime);
  const endM = parseTimeToMinutes(endTime);

  const workStart = parseTimeToMinutes(timeCfg.workingHoursStart);
  const workEnd = parseTimeToMinutes(timeCfg.workingHoursEnd);

  if (startM < workStart) {
    const e = new Error("Booking starts before 09:00");
    e.statusCode = 400;
    throw e;
  }
  if (endM > workEnd) {
    const e = new Error("Booking ends after 19:00");
    e.statusCode = 400;
    throw e;
  }
  if (endM <= startM) {
    const e = new Error("endTime must be after startTime");
    e.statusCode = 400;
    throw e;
  }

  const duration = endM - startM;
  if (duration < timeCfg.durationMinMinutes) {
    const e = new Error("Booking duration must be at least 30 minutes");
    e.statusCode = 400;
    throw e;
  }
  if (duration > timeCfg.durationMaxMinutes) {
    const e = new Error("Booking duration must be at most 3 hours");
    e.statusCode = 400;
    throw e;
  }

  return { startM, endM, duration };
}

function validateAttendees(room, attendees) {
  if (!Number.isInteger(attendees) || attendees < 1) {
    const e = new Error("attendees must be >= 1");
    e.statusCode = 400;
    throw e;
  }
  if (attendees > room.capacity) {
    const e = new Error("attendees exceed room capacity");
    e.statusCode = 400;
    throw e;
  }
}

function validateDateInPastAndAdvance(dateStr) {
  const dt = yyyyMmDdToDate(dateStr);
  const today = new Date();
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    0,
    0,
    0,
    0,
  );

  if (dt.getTime() < todayMidnight.getTime()) {
    const e = new Error("Booking date is in the past");
    e.statusCode = 400;
    throw e;
  }

  const diffDays = Math.floor(
    (dt.getTime() - todayMidnight.getTime()) / (24 * 3600 * 1000),
  );
  if (diffDays > timeCfg.maxAdvanceDays) {
    const e = new Error("Booking date too far in the future");
    e.statusCode = 400;
    throw e;
  }
}

async function validateDailyLimit({ userId, date }) {
  const activeCount = await Booking.countDocuments({
    userId,
    date,
    status: { $in: ["CONFIRMED", "WAITLISTED"] },
    cancelledAt: { $exists: false },
  });

  if (activeCount >= limitsCfg.dailyLimitMax) {
    const e = new Error("max 2 active bookings per day");
    e.statusCode = 403;
    throw e;
  }
}

async function checkConflictsForOccurrences({
  roomId,
  occurrenceDates,
  startTime,
  endTime,
}) {
  const dates = occurrenceDates;
  const existing = await Booking.find({
    roomId,
    date: { $in: dates },
    status: "CONFIRMED",
    cancelledAt: { $exists: false },
  }).lean();

  const startM = parseTimeToMinutes(startTime);
  const endM = parseTimeToMinutes(endTime);

  const conflictingDates = [];
  for (const d of dates) {
    const existingForDate = existing.filter((b) => b.date === d);
    const conflict = existingForDate.some((b) => {
      const bStart = parseTimeToMinutes(b.startTime);
      const bEnd = parseTimeToMinutes(b.endTime);
      return overlaps(startM, endM, bStart, bEnd);
    });
    if (conflict) conflictingDates.push(d);
  }

  return conflictingDates;
}

function makeSeriesId() {
  return new mongoose.Types.ObjectId().toString();
}

async function ensureIdempotency({
  session,
  userId,
  idempotencyKey,
  response,
}) {
  if (!idempotencyKey) return;
  // If already exists, return it (handled earlier); otherwise create.
  await Idempotency.create(
    [
      {
        key: idempotencyKey,
        userId,
        requestHash: "",
        response,
      },
    ],
    { session },
  );
}

async function debitCreditsForConfirmedOccurrences({
  session,
  userId,
  occurrenceDates,
  startTime,
  endTime,
  createdBookings,
}) {
  const startM = parseTimeToMinutes(startTime);
  const endM = parseTimeToMinutes(endTime);
  const duration = endM - startM;

  for (let i = 0; i < occurrenceDates.length; i++) {
    const weekStart = getWeekStartMonday(occurrenceDates[i]);

    const existingEntries = await CreditLedger.find({ userId, weekStart })
      .sort({ createdAt: 1 })
      .session(session)
      .lean();

    const startingBalanceMinutes = creditsCfg.weeklyAllowanceMinutes;
    const resultingBalanceMinutes =
      existingEntries.reduce(
        (bal, e) => bal + e.minutesDelta,
        startingBalanceMinutes,
      ) - duration;

    await CreditLedger.create(
      [
        {
          userId,
          weekStart,
          minutesDelta: -duration,
          startingBalanceMinutes,
          reason: "booking",
          resultingBalanceMinutes,
          bookingId: createdBookings[i]?._id ?? null,
          seriesId: createdBookings[i]?.seriesId ?? null,
        },
      ],
      { session },
    );
  }
}

const bookingService = {
  async _createBooking(req, { userId, role, body }) {
    const {
      roomId,
      date,
      startTime,
      endTime,
      attendees,
      purpose,
      recurrence,
      joinWaitlist,
    } = body;

    if (!roomId || !date || !startTime || !endTime || !attendees) {
      const e = new Error("Missing required fields");
      e.statusCode = 400;
      throw e;
    }

    validateDateInPastAndAdvance(date);

    const recurrenceValidated = validateRecurrenceBody(recurrence);
    const occurrenceDates = recurrenceValidated
      ? expandWeeklyOccurrences(date, recurrenceValidated.count)
      : [date];

    validateWorkingHours(startTime, endTime);

    const room = await Room.findById(roomId);
    if (!room) {
      const e = new Error("room not found");
      e.statusCode = 404;
      throw e;
    }

    validateAttendees(room, attendees);

    for (const d of occurrenceDates) {
      await validateDailyLimit({ userId, date: d });
    }

    const session = await mongoose.startSession();
    const idempotencyKey =
      req.headers["idempotency-key"] || req.headers["Idempotency-Key"];

    try {
      session.startTransaction();

      if (idempotencyKey) {
        const existing = await Idempotency.findOne({
          key: idempotencyKey,
          userId,
        }).session(session);
        if (existing) {
          return { statusCode: 200, body: existing.response };
        }
      }

      const conflictingDates = await checkConflictsForOccurrences({
        roomId,
        occurrenceDates,
        startTime,
        endTime,
      });

      // conflict
      if (conflictingDates.length > 0) {
        if (recurrenceValidated) {
          return {
            statusCode: 409,
            body: {
              success: false,
              message: "recurring booking conflict",
              conflictingDates,
            },
          };
        }

        if (joinWaitlist) {
          // queue position = # WAITLISTED for same slot
          const existingQ = await Booking.countDocuments({
            roomId,
            date,
            startTime,
            endTime,
            status: "WAITLISTED",
            cancelledAt: { $exists: false },
          }).session(session);

          const queuePosition = existingQ + 1;

          const waitlisted = await Booking.create(
            [
              {
                roomId,
                userId,
                date,
                startTime,
                endTime,
                attendees,
                purpose: purpose || "",
                status: "WAITLISTED",
                seriesId: undefined,
                queuePosition,
              },
            ],
            { session },
          );

          const response = {
            success: true,
            status: "WAITLISTED",
            booking: waitlisted[0],
          };
          await ensureIdempotency({
            session,
            userId,
            idempotencyKey,
            response,
          });

          await session.commitTransaction();
          return { statusCode: 201, body: response };
        }

        return {
          statusCode: 409,
          body: {
            success: false,
            message: "booking conflict",
            conflictingDates,
          },
        };
      }

      // save confirmed bookings
      const seriesId = recurrenceValidated ? makeSeriesId() : undefined;

      const docs = occurrenceDates.map((d) => ({
        roomId,
        userId,
        date: d,
        startTime,
        endTime,
        attendees,
        purpose: purpose || "",
        status: "CONFIRMED",
        seriesId,
      }));

      const created = await Booking.create(docs, { session });

      await debitCreditsForConfirmedOccurrences({
        session,
        userId,
        occurrenceDates,
        startTime,
        endTime,
        createdBookings: created,
      });

      const response =
        recurrenceValidated && created.length > 1
          ? { success: true, status: "CONFIRMED", seriesId, bookings: created }
          : { success: true, status: "CONFIRMED", booking: created[0] };

      await ensureIdempotency({ session, userId, idempotencyKey, response });

      await session.commitTransaction();
      return { statusCode: 201, body: response };
    } catch (e) {
      await session.abortTransaction();
      // Unique index duplicate confirmed slot (race scenario)
      if (e && (e.code === 11000 || e.code === 11001)) {
        return {
          statusCode: 409,
          body: { success: false, message: "booking conflict" },
        };
      }
      throw e;
    } finally {
      session.endSession();
    }
  },

  async createBooking(req, { userId, role, body }) {
    // controller calls this directly with raw req
    return this._createBooking(req, {
      userId,
      role,
      body: body || req.body || {},
    });
  },

  async createBookingPublic(req, { userId, role }) {
    // legacy wrapper for older callers
    return this._createBooking(req, { userId, role, body: req.body || {} });
  },

  async createBookingLegacy(reqContext, payload) {
    // alternate wrapper if passed a request context object
    return this.createBookingPublic(
      {
        ...reqContext,
        body: payload?.body,
      },
      payload,
    );
  },

  async listBookings({ requester, date, roomId, page = 1, limit = 10 }) {
    const query = {};
    if (date) query.date = date;
    if (roomId) query.roomId = roomId;

    if (requester.role !== "admin") query.userId = requester.userId;

    const skip = (page - 1) * limit;
    const totalCount = await Booking.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    const bookings = await Booking.find(query)
      .sort({ date: 1, startTime: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return { success: true, totalCount, totalPages, page, limit, bookings };
  },

  async cancelBooking({ requester, bookingId }) {
    const booking = await Booking.findById(bookingId);
    if (!booking)
      return {
        statusCode: 404,
        body: { success: false, message: "booking not found" },
      };

    const isAdmin = requester.role === "admin";
    if (!isAdmin && booking.userId.toString() !== requester.userId) {
      return {
        statusCode: 403,
        body: { success: false, message: "forbidden" },
      };
    }

    const startDt = yyyyMmDdToDate(booking.date);
    const [sh, sm] = booking.startTime.split(":").map(Number);
    startDt.setHours(sh, sm, 0, 0);

    if (startDt.getTime() <= Date.now()) {
      return {
        statusCode: 400,
        body: { success: false, message: "cannot cancel after start" },
      };
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const updated = await Booking.findByIdAndUpdate(
        bookingId,
        { $set: { status: "CANCELLED", cancelledAt: new Date() } },
        { new: true, session },
      );

      // Refund only for CONFIRMED
      if (updated.status === "CONFIRMED") {
        const durationMins =
          parseTimeToMinutes(updated.endTime) -
          parseTimeToMinutes(updated.startTime);
        const weekStart = getWeekStartMonday(updated.date);

        const msToStart = startDt.getTime() - Date.now();
        const multiplier = msToStart >= 2 * 3600 * 1000 ? 1 : 0.5;
        const rawRefund = durationMins * multiplier;
        const refundMins =
          multiplier === 1 ? durationMins : Math.floor(rawRefund / 15) * 15;

        const entries = await CreditLedger.find({
          userId: updated.userId,
          weekStart,
        })
          .session(session)
          .sort({ createdAt: 1 })
          .lean();

        const startingBalanceMinutes = creditsCfg.weeklyAllowanceMinutes;
        const resultingBalanceMinutes =
          entries.reduce(
            (bal, e) => bal + e.minutesDelta,
            startingBalanceMinutes,
          ) + refundMins;

        await CreditLedger.create(
          [
            {
              userId: updated.userId,
              weekStart,
              minutesDelta: refundMins,
              startingBalanceMinutes,
              reason: "cancellation refund",
              resultingBalanceMinutes,
              bookingId: updated._id,
              seriesId: updated.seriesId,
            },
          ],
          { session },
        );
      }

      const promotions = await waitlistService.promoteForFreedWindow({
        session,
        cancelledBooking: updated,
        triggeredByBookingId: updated._id,
      });

      await session.commitTransaction();
      return {
        statusCode: 200,
        body: { success: true, booking: updated, promotions },
      };
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  },

  async cancelSeries({ requester, seriesId, from }) {
    if (!from)
      return {
        statusCode: 400,
        body: { success: false, message: "from is required" },
      };

    const seriesBookings = await Booking.find({ seriesId }).lean();
    if (seriesBookings.length === 0)
      return {
        statusCode: 404,
        body: { success: false, message: "series not found" },
      };

    const isAdmin = requester.role === "admin";
    const anyOwned = seriesBookings.some(
      (b) => b.userId.toString() === requester.userId,
    );
    if (!isAdmin && !anyOwned)
      return {
        statusCode: 403,
        body: { success: false, message: "forbidden" },
      };

    const fromDt = yyyyMmDdToDate(from);

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const toCancel = [];
      for (const b of seriesBookings) {
        const dt = yyyyMmDdToDate(b.date);
        if (dt.getTime() >= fromDt.getTime()) toCancel.push(b._id);
      }

      const promotions = [];

      for (const id of toCancel) {
        const b = await Booking.findById(id).session(session);
        const startDt = yyyyMmDdToDate(b.date);
        const [sh, sm] = b.startTime.split(":").map(Number);
        startDt.setHours(sh, sm, 0, 0);

        if (startDt.getTime() <= Date.now()) continue;

        const updated = await Booking.findByIdAndUpdate(
          id,
          { $set: { status: "CANCELLED", cancelledAt: new Date() } },
          { new: true, session },
        );

        if (updated.status === "CONFIRMED") {
          const durationMins =
            parseTimeToMinutes(updated.endTime) -
            parseTimeToMinutes(updated.startTime);
          const weekStart = getWeekStartMonday(updated.date);

          const msToStart = startDt.getTime() - Date.now();
          const multiplier = msToStart >= 2 * 3600 * 1000 ? 1 : 0.5;
          const rawRefund = durationMins * multiplier;
          const refundMins =
            multiplier === 1 ? durationMins : Math.floor(rawRefund / 15) * 15;

          const entries = await CreditLedger.find({
            userId: updated.userId,
            weekStart,
          })
            .session(session)
            .sort({ createdAt: 1 })
            .lean();

          const startingBalanceMinutes = creditsCfg.weeklyAllowanceMinutes;
          const resultingBalanceMinutes =
            entries.reduce(
              (bal, e) => bal + e.minutesDelta,
              startingBalanceMinutes,
            ) + refundMins;

          await CreditLedger.create(
            [
              {
                userId: updated.userId,
                weekStart,
                minutesDelta: refundMins,
                startingBalanceMinutes,
                reason: "cancellation refund",
                resultingBalanceMinutes,
                bookingId: updated._id,
                seriesId: updated.seriesId,
              },
            ],
            { session },
          );
        }

        const ps = await waitlistService.promoteForFreedWindow({
          session,
          cancelledBooking: updated,
          triggeredByBookingId: updated._id,
        });
        promotions.push(...ps);
      }

      await session.commitTransaction();
      return {
        statusCode: 200,
        body: {
          success: true,
          cancelledSeries: seriesId,
          from,
          promotionsCount: promotions.length,
        },
      };
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  },

  async getRoomsAvailability({ date }) {
    if (!date)
      return {
        statusCode: 400,
        body: { success: false, message: "date is required" },
      };

    const rooms = await Room.find({}).lean();
    const result = [];

    for (const room of rooms) {
      const bookings = await Booking.find({
        roomId: room._id,
        date,
        status: "CONFIRMED",
      }).lean();

      const workStartM = parseTimeToMinutes(timeCfg.workingHoursStart);
      const workEndM = parseTimeToMinutes(timeCfg.workingHoursEnd);

      const occupied = bookings
        .map((b) => ({
          startM: parseTimeToMinutes(b.startTime),
          endM: parseTimeToMinutes(b.endTime),
        }))
        .sort((a, b) => a.startM - b.startM);

      let cursor = workStartM;
      const freeSlots = [];
      for (const occ of occupied) {
        if (occ.startM > cursor) {
          freeSlots.push({
            startTime: minutesToHHmm(cursor),
            endTime: minutesToHHmm(occ.startM),
          });
        }
        cursor = Math.max(cursor, occ.endM);
      }
      if (cursor < workEndM) {
        freeSlots.push({
          startTime: minutesToHHmm(cursor),
          endTime: minutesToHHmm(workEndM),
        });
      }

      result.push({ roomId: room._id, roomName: room.name, freeSlots });
    }

    return { success: true, date, rooms: result };
  },
};

module.exports = bookingService;
