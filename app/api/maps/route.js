import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../../../lib/prisma";
import { broadcastRealtime } from "../../../lib/realtime";

function slugify(value) {
  return String(value || "map")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request) {
  const formData = await request.formData();
  const locationId = String(formData.get("locationId") || "");
  const name = String(formData.get("name") || "Imported Map");
  const parkingLevels = parseParkingLevels(formData);
  const file = formData.get("file");

  if (!locationId || !file || typeof file === "string") {
    return NextResponse.json({ error: "Location and PDF map file are required." }, { status: 400 });
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    return NextResponse.json({ error: "Location not found." }, { status: 404 });
  }

  const extension = path.extname(file.name || "").toLowerCase() || ".pdf";
  if (![".pdf", ".png", ".jpg", ".jpeg", ".svg"].includes(extension)) {
    return NextResponse.json({ error: "Only PDF, image, or SVG maps are supported." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sourceType = extension.replace(".", "");
  let filePath;

  const folder = path.join(process.cwd(), "public", "uploads", "maps", locationId);
  await mkdir(folder, { recursive: true });
  const fileName = `${Date.now()}-${slugify(name)}${extension}`;
  const fullPath = path.join(folder, fileName);
  await writeFile(fullPath, bytes);
  filePath = `/uploads/maps/${locationId}/${fileName}`;

  const maps = await prisma.$transaction(
    parkingLevels.map((parkingLevel) => prisma.map.create({
      data: {
        locationId,
        name,
        parkingLevel,
        isVisible: true,
        filePath,
        sourceType
      }
    }))
  );

  await broadcastRealtime("map:changed", { locationId, mapIds: maps.map((map) => map.id), action: "created" });
  return NextResponse.json({ map: serializeMap(maps[0]), maps: maps.map(serializeMap) });
}

function parseParkingLevels(formData) {
  const rawValues = formData.getAll("parkingLevels");
  const values = rawValues.length ? rawValues : [formData.get("parkingLevel") || 1];
  const levels = values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => clampParkingLevel(value));

  return Array.from(new Set(levels)).sort((a, b) => a - b);
}

function clampParkingLevel(value) {
  const parsed = Number(value || 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(5, Math.trunc(parsed)));
}

function serializeMap(map) {
  return {
    ...map,
    filePath: String(map.filePath || "").startsWith("data:") ? `/api/maps/${map.id}/image` : map.filePath
  };
}
