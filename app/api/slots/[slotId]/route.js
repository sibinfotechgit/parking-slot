import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { broadcastRealtime } from "../../../../lib/realtime";

export async function PATCH(request, { params }) {
  const body = await request.json();
  const currentSlot = await prisma.parkingSlot.findUnique({
    where: { id: params.slotId },
    include: { bookings: { where: { status: "active" } } }
  });

  if (!currentSlot) {
    return NextResponse.json({ error: "Slot not found." }, { status: 404 });
  }

  const data = {};
  for (const field of ["slotNo", "zone", "type", "status"]) {
    if (body[field] !== undefined) data[field] = String(body[field]);
  }
  if (body.x !== undefined) data.x = Number(body.x);
  if (body.y !== undefined) data.y = Number(body.y);
  if (body.width !== undefined) data.width = Number(body.width);
  if (body.height !== undefined) data.height = Number(body.height);

  if (data.type && data.type !== currentSlot.type && currentSlot.bookings.length) {
    return NextResponse.json(
      { error: "Release active bookings before changing slot tier." },
      { status: 400 }
    );
  }

  if (data.status && ["available", "reserved", "maintenance", "sold"].includes(data.status)) {
    await prisma.booking.updateMany({
      where: { slotId: params.slotId, status: "active" },
      data: { status: "cancelled" }
    });
  }

  const slot = await prisma.parkingSlot.update({ where: { id: params.slotId }, data });

  await broadcastRealtime("slot:changed", { mapId: slot.mapId, slotId: slot.id, action: "updated" });

  return NextResponse.json({ slot });
}

export async function DELETE(_request, { params }) {
  const slot = await prisma.parkingSlot.delete({ where: { id: params.slotId } });
  await broadcastRealtime("slot:changed", { mapId: slot.mapId, slotId: slot.id, action: "deleted" });
  return NextResponse.json({ slot });
}
