import { NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { prisma } from "../../../../lib/prisma";
import { broadcastRealtime } from "../../../../lib/realtime";

export async function PATCH(request, { params }) {
  const body = await request.json();
  const data = {};

  if (body.name !== undefined) data.name = String(body.name || "").trim();
  if (body.isVisible !== undefined) data.isVisible = Boolean(body.isVisible);
  if (body.parkingLevel !== undefined) {
    const parkingLevel = Number(body.parkingLevel);
    if (Number.isFinite(parkingLevel)) data.parkingLevel = Math.max(1, Math.min(5, Math.trunc(parkingLevel)));
  }

  if (data.name === "") {
    return NextResponse.json({ error: "Parking/map name is required." }, { status: 400 });
  }

  const map = await prisma.map.update({ where: { id: params.mapId }, data });
  await broadcastRealtime("map:changed", { locationId: map.locationId, mapId: map.id, action: "updated" });
  return NextResponse.json({ map });
}

export async function DELETE(_request, { params }) {
  const map = await prisma.map.findUnique({ where: { id: params.mapId } });
  if (!map) {
    return NextResponse.json({ error: "Map not found." }, { status: 404 });
  }

  const sharedMapCount = map.filePath
    ? await prisma.map.count({ where: { filePath: map.filePath, id: { not: map.id } } })
    : 0;

  await prisma.map.delete({ where: { id: params.mapId } });

  if (!sharedMapCount) {
    await deletePublicMapFile(map.filePath);
  }
  await broadcastRealtime("map:changed", { locationId: map.locationId, mapId: map.id, action: "deleted" });

  return NextResponse.json({ map });
}

async function deletePublicMapFile(filePath) {
  if (!filePath || !filePath.startsWith("/maps/")) {
    return;
  }

  const publicMapsPath = path.join(process.cwd(), "public", "maps");
  const fullPath = path.normalize(path.join(process.cwd(), "public", filePath));

  if (!fullPath.startsWith(publicMapsPath)) {
    return;
  }

  try {
    await unlink(fullPath);
  } catch {
    // The DB record should still be deleted even if the local file is already missing.
  }
}
