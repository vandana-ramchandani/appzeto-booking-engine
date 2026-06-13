const parseTimeToMinutes = (hhmm) => {
  if (typeof hhmm !== "string" || !/^(\d{2}):(\d{2})$/.test(hhmm)) {
    throw new Error(`Invalid time format: ${hhmm}. Expected HH:mm`);
  }
  const [h, m] = hhmm.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time value: ${hhmm}`);
  }
  return h * 60 + m;
};

const minutesToHHmm = (mins) => {
  const clamped = mins;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

module.exports = { parseTimeToMinutes, minutesToHHmm };
