const mongoose = require("mongoose");

const idempotencySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    requestHash: { type: String, required: true },
    response: { type: Object, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Idempotency", idempotencySchema);
