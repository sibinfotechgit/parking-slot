export function getSlotLevels(type = "") {
  if (String(type).includes("3")) {
    return ["Bottom", "Middle", "Top"];
  }

  if (String(type).includes("2")) {
    return ["Bottom", "Top"];
  }

  return ["Single"];
}

export function normalizeLevel(type, level) {
  const levels = getSlotLevels(type);
  const requested = String(level || "").trim();

  if (levels.length === 1) {
    return levels[0];
  }

  return levels.includes(requested) ? requested : levels[0];
}

export function getLevelOccupancy(type, bookings = []) {
  const levels = getSlotLevels(type);
  const bookedLevels = bookings
    .filter((booking) => booking.status === "active")
    .map((booking) => normalizeLevel(type, booking.level))
    .filter((level, index, list) => list.indexOf(level) === index);

  return {
    levels,
    bookedLevels,
    availableLevels: levels.filter((level) => !bookedLevels.includes(level))
  };
}

export function getOccupancyStatus(slotStatus, type, bookings = []) {
  if (["reserved", "maintenance", "sold"].includes(slotStatus)) {
    return slotStatus;
  }

  const occupancy = getLevelOccupancy(type, bookings);
  if (occupancy.bookedLevels.length === 0) {
    return "available";
  }

  return occupancy.bookedLevels.length >= occupancy.levels.length ? "booked" : "partial";
}
