const bookingService = require("../services/bookingService");
const creditService = require("../services/creditService");

const bookingController = {
  async createBooking(req, res, next) {
    try {
      const result = await bookingService.createBooking(req, {
        userId: req.user.userId,
        role: req.user.role,
      });
      return res.status(result.statusCode || 201).json(result.body);
    } catch (e) {
      next(e);
    }
  },

  async listBookings(req, res, next) {
    try {
      const { date, roomId, page = 1, limit = 10 } = req.query;
      const result = await bookingService.listBookings({
        requester: req.user,
        date,
        roomId,
        page: Number(page),
        limit: Number(limit),
      });
      return res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },

  async cancelBooking(req, res, next) {
    try {
      const { id } = req.params;
      const result = await bookingService.cancelBooking({
        requester: req.user,
        bookingId: id,
      });
      return res.status(result.statusCode || 200).json(result.body);
    } catch (e) {
      next(e);
    }
  },

  async cancelSeries(req, res, next) {
    try {
      const { seriesId } = req.params;
      const { from } = req.query;
      const result = await bookingService.cancelSeries({
        requester: req.user,
        seriesId,
        from,
      });
      return res.status(result.statusCode || 200).json(result.body);
    } catch (e) {
      next(e);
    }
  },

  async getRoomsAvailability(req, res, next) {
    try {
      const { date } = req.query;
      const result = await bookingService.getRoomsAvailability({ date });
      return res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },

  async getMyCredits(req, res, next) {
    try {
      const { week } = req.query;
      const result = await creditService.getCreditsLedger({
        userId: req.user.userId,
        week,
      });
      return res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = bookingController;
