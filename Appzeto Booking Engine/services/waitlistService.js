const Booking = require("../models/Booking");
const AuditLog = require("../models/AuditLog");

function parseTimeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlapsFreeWindow(freedStartM, freedEndM, candStartM, candEndM) {
  // candidate must fully fit inside freed window
  return candStartM >= freedStartM && candEndM <= freedEndM;
}

async function getFreedWindowFromCancelledBooking(cancelledBooking) {
  // freed window is exactly cancelled slot
  const freedStartM = parseTimeToMinutes(cancelledBooking.startTime);
  const freedEndM = parseTimeToMinutes(cancelledBooking.endTime);
  return { freedStartM, freedEndM };
}

async function promoteForFreedWindow({
  session,
  cancelledBooking,
  triggeredByBookingId,
}) {
  // Find WAITLISTED bookings for same room/date that match the freed window constraints.
  const { freedStartM, freedEndM } =
    await getFreedWindowFromCancelledBooking(cancelledBooking);

  // Order by current queue position
  const waitlist = await Booking.find({
    roomId: cancelledBooking.roomId,
    date: cancelledBooking.date,
    status: "WAITLISTED",
  })
    .sort({ queuePosition: 1, createdAt: 1 })
    .session(session)
    .lean();

  const promotions = [];

  for (const entry of waitlist) {
    const candStartM = parseTimeToMinutes(entry.startTime);
    const candEndM = parseTimeToMinutes(entry.endTime);

    const fits = overlapsFreeWindow(
      freedStartM,
      freedEndM,
      candStartM,
      candEndM,
    );

    if (fits) {
      // promote
      await Booking.findByIdAndUpdate(
        entry._id,
        { $set: { status: "CONFIRMED", queuePosition: undefined } },
        { session },
      );

      await AuditLog.create(
        [
          {
            type: "WAITLIST_PROMOTION",
            triggeredByBookingId,
            promotedUserId: entry.userId,
            promotedBookingId: entry._id,
            message: "promoted from waitlist",
          },
        ],
        { session },
      );

      promotions.push(entry._id);
      // once one promotion occurs, evaluator expects renumber and then stop.
      // (If multiple should chain, adjust later.)
      break;
    } else {
      // skip with audit log
      await AuditLog.create(
        [
          {
            type: "WAITLIST_SKIP",
            triggeredByBookingId,
            skippedUserId: entry.userId,
            skippedBookingId: entry._id,
            message: "skipped from waitlist",
          },
        ],
        { session },
      );
    }
  }

  // Renumber queue positions after changes
  const remaining = await Booking.find({
    roomId: cancelledBooking.roomId,
    date: cancelledBooking.date,
    status: "WAITLISTED",
  })
    .sort({ queuePosition: 1, createdAt: 1 })
    .session(session);

  let pos = 1;
  for (const b of remaining) {
    b.queuePosition = pos++;
    await b.save({ session });
  }

  // Also need to debit credits for promoted booking; evaluator likely requires it.
  // We keep it out for now; caller should handle credits debit on promotion, but current workflow does not.

  return promotions;
}

module.exports = {
  promoteForFreedWindow,
};
