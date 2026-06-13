const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

const connectDB = require("./config/db");
const { seedRooms } = require("./seeder/roomSeeder");

const authRoutes = require("./routes/authRoutes");
const bookingRoutes = require("./routes/bookingRoutes");

const errorHandler = require("./middleware/errorMiddleware");

// Load Environment Variables
dotenv.config();

// Connect Database
connectDB()
  .then(seedRooms)
  .catch((e) => {
    console.error("❌ Room seeding failed");
    console.error(e);
    process.exit(1);
  });

const app = express();

// Middlewares
app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

// Test Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Appzeto Booking Engine API Running",
  });
});

// Routes
app.use("/api/auth", authRoutes);

app.use("/api/bookings", bookingRoutes);

// DELETE not allowed anywhere
app.use((req, res, next) => {
  if (req.method === "DELETE") {
    return res.status(405).json({
      success: false,
      message: "DELETE method is not allowed",
    });
  }

  next();
});

// Error Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
