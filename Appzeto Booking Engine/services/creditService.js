const CreditLedger = require("../models/CreditLedger");
const { credits: creditsCfg } = require("../config/appConfig");

function yyyyMmDdToDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function getWeekStartMonday(yyyyMmDd) {
  const dt = yyyyMmDdToDate(yyyyMmDd);
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function getCreditsLedger({ userId, week }) {
  const weekStart = getWeekStartMonday(week);

  const entries = await CreditLedger.find({ userId, weekStart })
    .sort({ createdAt: 1 })
    .lean();

  const startingBalanceMinutes = creditsCfg.weeklyAllowanceMinutes;
  const remainingBalanceMinutes = entries.reduce(
    (bal, e) => bal + e.minutesDelta,
    startingBalanceMinutes,
  );

  return {
    success: true,
    weekStart,
    startingBalanceMinutes,
    entries: entries.map((e) => ({
      id: e._id,
      minutesDelta: e.minutesDelta,
      reason: e.reason,
      bookingId: e.bookingId,
      seriesId: e.seriesId,
      createdAt: e.createdAt,
      resultingBalanceMinutes: e.resultingBalanceMinutes,
    })),
    remainingBalanceMinutes,
  };
}

module.exports = { getCreditsLedger };
