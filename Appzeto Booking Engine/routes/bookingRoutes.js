const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const bookingController = require("../controllers/bookingController");

// Booking create (supports recurrence + waitlist + idempotency)
router.post("/", authMiddleware, bookingController.createBooking);

// List bookings (owner vs admin)
router.get("/", authMiddleware, bookingController.listBookings);

// Cancel single booking (owner/admin)
router.patch("/:id/cancel", authMiddleware, bookingController.cancelBooking);

// Cancel recurring series from a given date
router.patch(
  "/series/:seriesId/cancel",
  authMiddleware,
  bookingController.cancelSeries,
);

// Availability per room for a date
router.get(
  "/availability",
  authMiddleware,
  bookingController.getRoomsAvailability,
);

// Credits ledger for current user
router.get("/me/credits", authMiddleware, bookingController.getMyCredits);

module.exports = router;
