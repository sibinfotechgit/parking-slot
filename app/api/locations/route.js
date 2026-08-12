import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getLevelOccupancy, getOccupancyStatus } from "../../../lib/parking-levels";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json();
  const name = String(body.name || "").trim();
  const parkingName = String(body.parkingName || "").trim();
  const city = String(body.city || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Location name is required." }, { status: 400 });
  }

  const location = await prisma.location.create({
    data: {
      name,
      parkingName,
      city
    }
  });

  return NextResponse.json({ location });
}

export async function GET() {
  try {
    const locations = await prisma.location.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        maps: {
          orderBy: [{ parkingLevel: "asc" }, { createdAt: "asc" }],
          include: {
            slots: {
              orderBy: { slotNo: "asc" },
              include: {
                bookings: {
                  where: { status: "active" },
                  orderBy: { createdAt: "desc" }
                }
              }
            }
          }
        }
      }
    });

    return NextResponse.json({
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        parkingName: location.parkingName || "",
        city: location.city,
        maps: location.maps.map((map) => ({
          id: map.id,
          name: map.name,
          parkingLevel: map.parkingLevel || 1,
          isVisible: map.isVisible,
          sourceType: map.sourceType,
          file: getMapFileUrl(map),
          slots: map.slots.map((slot) => {
            const activeBooking = slot.bookings[0];
            const occupancy = getLevelOccupancy(slot.type, slot.bookings);
            return {
              id: slot.id,
              slotNo: slot.slotNo,
              zone: slot.zone,
              type: slot.type,
              x: slot.x,
              y: slot.y,
              w: slot.width,
              h: slot.height,
              status: slot.status,
              occupancyStatus: getOccupancyStatus(slot.status, slot.type, slot.bookings),
              levels: occupancy.levels,
              bookedLevels: occupancy.bookedLevels,
              availableLevels: occupancy.availableLevels,
              bookings: slot.bookings.map((booking) => ({
                id: booking.id,
                level: booking.level || "",
                receiptNo: booking.receiptNo || "",
                allottee: booking.allottee || "",
                mobile: booking.mobile || "",
                email: booking.email || "",
                address: booking.address || "",
                createdAt: booking.createdAt
              })),
              level: activeBooking?.level || "",
              receiptNo: activeBooking?.receiptNo || "",
              allottee: activeBooking?.allottee || "",
              mobile: activeBooking?.mobile || "",
              email: activeBooking?.email || "",
              address: activeBooking?.address || "",
              bookedAt: activeBooking?.createdAt || null
            };
          })
        }))
      }))
    });
  } catch (error) {
    console.error("Failed to load locations", error);
    return NextResponse.json(
      { error: "Could not load parking locations.", detail: error.message },
      { status: 500 }
    );
  }
}

function getMapFileUrl(map) {
  if (String(map.filePath || "").startsWith("data:")) {
    return `/api/maps/${map.id}/image`;
  }

  return map.filePath;
}
