module.exports = {
  time: {
    workingHoursStart: "09:00",
    workingHoursEnd: "19:00",
    durationMinMinutes: 30,
    durationMaxMinutes: 180,
    maxAdvanceDays: 30,
  },
  limits: {
    dailyLimitActiveStatuses: ["CONFIRMED", "WAITLISTED"],
    dailyLimitMax: 2,
  },
  credits: {
    weeklyAllowanceMinutes: 600,
  },
};
