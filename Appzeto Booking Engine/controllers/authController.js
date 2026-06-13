const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

function signToken(user) {
  const secret = process.env.JWT_SECRET || "dev_secret";
  return jwt.sign({ userId: user._id.toString(), role: user.role }, secret, {
    expiresIn: "7d",
  });
}

const authController = {
  async register(req, res, next) {
    try {
      const { email, password, role } = req.body || {};
      if (!email || !password) {
        return res
          .status(400)
          .json({ success: false, message: "email and password are required" });
      }

      const existing = await User.findOne({
        email: email.toLowerCase().trim(),
      });
      if (existing) {
        return res
          .status(409)
          .json({ success: false, message: "email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({
        email: email.toLowerCase().trim(),
        passwordHash,
        role: role === "admin" ? "admin" : "user",
      });

      const token = signToken(user);
      return res.status(201).json({ success: true, token });
    } catch (e) {
      next(e);
    }
  },

  async login(req, res, next) {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res
          .status(400)
          .json({ success: false, message: "email and password are required" });
      }

      const user = await User.findOne({ email: email.toLowerCase().trim() });
      if (!user) {
        return res
          .status(401)
          .json({ success: false, message: "invalid credentials" });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return res
          .status(401)
          .json({ success: false, message: "invalid credentials" });
      }

      const token = signToken(user);
      return res.status(200).json({ success: true, token });
    } catch (e) {
      next(e);
    }
  },
};

module.exports = authController;
