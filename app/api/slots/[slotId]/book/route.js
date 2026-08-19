import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { broadcastRealtime } from "../../../../../lib/realtime";
import { getSlotLevels, normalizeLevel } from "../../../../../lib/parking-levels";

export async function POST(request, { params }) {
  const body = await request.json();
  const allottee = String(body.allottee || "").trim();
  const mobile = String(body.mobile || "").trim();
  const requestedLevel = String(body.level || "").trim();
  const address = String(body.address || "").trim();

  if (!allottee) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  if (!mobile) {
    return NextResponse.json({ error: "Login mobile number is required." }, { status: 400 });
  }

  if (mobile && !/^[0-9]{10}$/.test(mobile)) {
    return NextResponse.json({ error: "Mobile number should be 10 digits." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const slot = await tx.parkingSlot.findUnique({
        where: { id: params.slotId },
        include: { bookings: { where: { status: "active" } } }
      });

      if (!slot) {
        throw new Error("Slot not found.");
      }

      const user = await tx.userMaster.findUnique({ where: { mobile } });
      if (!user || !user.active) {
        throw new Error("This mobile number is not registered for parking access.");
      }

      const existingUserBooking = await tx.booking.findFirst({
        where: { mobile, status: "active" },
        include: { slot: true }
      });

      if (existingUserBooking) {
        throw new Error(`You already have an active booking for ${existingUserBooking.slot.slotNo}.`);
      }

      if (["reserved", "maintenance", "sold"].includes(slot.status)) {
        throw new Error(`Slot is ${slot.status}.`);
      }

      const levels = getSlotLevels(slot.type);
      const level = normalizeLevel(slot.type, requestedLevel);
      const activeLevels = slot.bookings.map((booking) => normalizeLevel(slot.type, booking.level));

      if (activeLevels.includes(level)) {
        throw new Error(`${slot.slotNo} ${level} level is already booked.`);
      }

      if (activeLevels.length >= levels.length) {
        throw new Error(`${slot.slotNo} is fully booked.`);
      }

      const counter = await tx.appCounter.upsert({
        where: { key: "receipt" },
        update: { value: { increment: 1 } },
        create: { key: "receipt", value: 1 }
      });
      const receiptNo = `SP/${String(counter.value).padStart(3, "0")}`;

      const booking = await tx.booking.create({
        data: {
          slotId: slot.id,
          userId: user.id,
          receiptNo,
          allottee: user.name || allottee,
          mobile,
          email: user.email || "",
          address: user.address || address,
          level
        }
      });

      const updatedSlot = await tx.parkingSlot.update({
        where: { id: slot.id },
        data: { status: activeLevels.length + 1 >= levels.length ? "booked" : "available" }
      });

      return { slot: updatedSlot, booking };
    }, { timeout: 15000, maxWait: 10000 });

    await broadcastRealtime("slot:booked", { mapId: result.slot.mapId, slotId: result.slot.id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Booking failed." }, { status: 400 });
  }
}
