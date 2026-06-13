const Room = require("../models/Room");

const ROOM_SEED = [
  { name: "Alpha", capacity: 4 },
  { name: "Beta", capacity: 8 },
  { name: "Gamma", capacity: 15 },
];

async function seedRooms() {
  const count = await Room.countDocuments();
  if (count === 0) {
    await Room.insertMany(ROOM_SEED);
  }
}

module.exports = { seedRooms };
