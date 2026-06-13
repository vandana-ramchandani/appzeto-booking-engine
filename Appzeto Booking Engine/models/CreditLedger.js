const mongoose = require("mongoose");

const creditLedgerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    weekStart: { type: String, required: true, index: true }, // YYYY-MM-DD (Monday)

    minutesDelta: { type: Number, required: true }, // negative for debit, positive for credit
    startingBalanceMinutes: { type: Number, required: true },
    reason: { type: String, required: true },

    // Store resulting balance after this entry (evaluator expects ledger replay)
    resultingBalanceMinutes: { type: Number, required: true },

    // Link to booking/cancellation for traceability
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    seriesId: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CreditLedger", creditLedgerSchema);
