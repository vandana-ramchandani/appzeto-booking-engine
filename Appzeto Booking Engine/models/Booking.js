const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Booking date (YYYY-MM-DD stored as string for deterministic overlap checks)
    date: { type: String, required: true, index: true },

    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true }, // HH:mm

    attendees: { type: Number, required: true, min: 1 },
    purpose: { type: String, default: "" },

    status: {
      type: String,
      enum: ["CONFIRMED", "WAITLISTED", "CANCELLED"],
      default: "CONFIRMED",
      index: true,
    },

    // For recurring series
    seriesId: { type: String, index: true },

    // Waitlist queue position (only meaningful for WAITLISTED)
    queuePosition: { type: Number, index: true },

    cancelledAt: { type: Date },

    // Idempotency marker (optional, helpful for response lookup)
    idempotencyKey: { type: String, index: true },
  },
  { timestamps: true },
);

// Race-safety helper: if we store exact start/end in the unique index,
// parallel exact-slot creates can be prevented.
bookingSchema.index(
  { roomId: 1, date: 1, startTime: 1, endTime: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "CONFIRMED" } },
);

module.exports = mongoose.model("Booking", bookingSchema);
