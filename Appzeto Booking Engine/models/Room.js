const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    capacity: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Room", roomSchema);
