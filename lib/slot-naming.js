export function getSlotPrefixForParkingLevel(level) {
  const value = Number(level || 1);
  if (value <= 1) return "GL";
  return `P${value - 1}`;
}

export function formatParkingSlotNo(level, number) {
  return `${getSlotPrefixForParkingLevel(level)}${String(number).padStart(3, "0")}`;
}

export function formatSurfaceSlotNo(level, number) {
  return `${getSlotPrefixForParkingLevel(level)}S${String(number).padStart(2, "0")}`;
}

export function isSurfaceParkingType(type = "") {
  return String(type).toLowerCase().includes("surface");
}

export function isSurfaceSlotNo(slotNo = "") {
  return /^(GL|P\d+)S\d+$/i.test(String(slotNo));
}

export function getSlotLevelNames(type = "") {
  if (isSurfaceParkingType(type)) return ["Single"];
  if (String(type).includes("3")) return ["Bottom", "Middle", "Top"];
  if (String(type).includes("2")) return ["Bottom", "Top"];
  return ["Single"];
}

export function getSlotCapacity(slotOrType = "") {
  const type = typeof slotOrType === "string" ? slotOrType : slotOrType?.type;
  return getSlotLevelNames(type).length;
}

export function parseSlotNumber(slotNo) {
  const value = String(slotNo || "").trim();
  const structured = value.match(/^(GL|P\d)(S?)(\d+)$/i);
  if (structured) {
    return {
      prefix: `${structured[1].toUpperCase()}${structured[2].toUpperCase()}`,
      number: Number(structured[3]),
      width: structured[3].length
    };
  }

  const match = value.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    number: Number(match[2]),
    width: match[2].length
  };
}

export function getSlotDisplayNumbers(slot) {
  const levels = slot?.levels?.length ? slot.levels : getSlotLevelNames(slot?.type);
  const base = parseSlotNumber(slot?.slotNo);

  return levels.map((level, index) => ({
    level,
    slotNo: base ? `${base.prefix}${String(base.number + index).padStart(base.width, "0")}` : slot?.slotNo || "",
    booked: slot?.bookedLevels?.includes(level)
  }));
}

export function getStackMapDisplayNumbers(slot) {
  return [...getSlotDisplayNumbers(slot)].reverse();
}

export function getTierSlotNo(slot, level) {
  const item = getSlotDisplayNumbers(slot).find((entry) => entry.level === level);
  return item?.slotNo || slot?.slotNo || "";
}

export function getNextSlotNumber(map, type = "Regular") {
  const parkingLevel = map?.parkingLevel || 1;
  const existing = new Set((map?.slots || []).map((slot) => slot.slotNo));

  if (isSurfaceParkingType(type)) {
    const highestSurface = (map?.slots || []).reduce((highest, slot) => {
      if (!isSurfaceParkingType(slot.type) && !isSurfaceSlotNo(slot.slotNo)) return highest;
      const parsed = parseSlotNumber(slot.slotNo);
      return parsed ? Math.max(highest, parsed.number) : highest;
    }, 0);
    let next = highestSurface + 1;
    let candidate = formatSurfaceSlotNo(parkingLevel, next);
    while (existing.has(candidate)) {
      next += 1;
      candidate = formatSurfaceSlotNo(parkingLevel, next);
    }
    return candidate;
  }

  const highestNumber = (map?.slots || []).reduce((highest, slot) => {
    if (isSurfaceParkingType(slot.type) || isSurfaceSlotNo(slot.slotNo)) return highest;
    const parsed = parseSlotNumber(slot.slotNo);
    if (!parsed) return highest;
    return Math.max(highest, parsed.number + getSlotCapacity(slot) - 1);
  }, 0);
  let next = highestNumber + 1;
  let candidate = formatParkingSlotNo(parkingLevel, next);

  while (existing.has(candidate)) {
    next += 1;
    candidate = formatParkingSlotNo(parkingLevel, next);
  }

  return candidate;
}
