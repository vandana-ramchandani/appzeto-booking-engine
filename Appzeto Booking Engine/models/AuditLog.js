const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true }, // e.g., "WAITLIST_PROMOTION"
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      index: true,
    },

    promotedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    skippedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    promotedBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    skippedBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },

    message: { type: String, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
