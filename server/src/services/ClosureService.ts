/**
 * ClosureService — road closure lifecycle management (spec section 8 + 10).
 *
 * When a closure is created or cleared, this service:
 *   1. Persists the closure in the DB (done by caller via Prisma directly).
 *   2. Finds all ACTIVE emergencies whose current route intersects the polygon.
 *   3. Re-routes them with avoid_polygons = all currently active closures.
 *   4. Emits `route:updated` on each affected emergency's room.
 *   5. Emits `closure:updated` to all connected clients.
 *
 * Polygon intersection is checked by testing whether any route coordinate
 * falls inside any closure polygon (point-in-polygon test). This is sufficient
 * for the demo and avoids a PostGIS dependency.
 */

import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { OrsRoutingProvider } from "./routing/OrsRoutingProvider";
import { emitEmergencyEvent, getIO } from "../lib/socket";

const routing = new OrsRoutingProvider();

// ── GeoJSON polygon types ─────────────────────────────────────────────────────

interface GeoJsonPolygon {
  type: "Polygon" | "Feature";
  coordinates?: [number, number][][];
  geometry?: { type: "Polygon"; coordinates: [number, number][][] };
}

interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const closureService = {
  /**
   * Called after a new closure is inserted.
   * Re-routes all ACTIVE emergencies that pass through the new closure polygon.
   */
  async onClosureCreated(newClosureId: string): Promise<void> {
    await rerouteAffectedEmergencies(newClosureId);
    broadcastClosureUpdated();
  },

  /**
   * Called after a closure is deactivated (cleared).
   * Re-routes all ACTIVE emergencies so they can now use the previously
   * blocked road (avoid_polygons will shrink by one entry).
   */
  async onClosureCleared(): Promise<void> {
    await rerouteAllActive();
    broadcastClosureUpdated();
  },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

async function rerouteAffectedEmergencies(newClosureId: string): Promise<void> {
  const newClosure = await prisma.roadClosure.findUnique({
    where: { id: newClosureId },
    select: { polygonGeoJson: true },
  });
  if (!newClosure) return;

  let poly: GeoJsonPolygon;
  try {
    poly = JSON.parse(JSON.stringify(newClosure.polygonGeoJson)) as GeoJsonPolygon;
  } catch {
    console.warn("[ClosureService] Invalid polygonGeoJson for closure", newClosureId);
    return;
  }

  // Find all ACTIVE emergencies with a route
  const actives = await prisma.emergency.findMany({
    where: { status: "ACTIVE", routeGeoJson: { not: Prisma.JsonNull } },
    select: {
      id: true, driverId: true, selectedHospitalId: true,
      originLat: true, originLng: true,
      selectedHospital: { select: { lat: true, lng: true } },
      routeGeoJson: true,
    },
  });

  // Collect all active closure polygons for avoid_polygons
  const avoidPolygons = await getAvoidPolygons();

  for (const em of actives) {
    const route = em.routeGeoJson as GeoJsonLineString | null;
    if (!route?.coordinates?.length) continue;

    // Only reroute if the route actually intersects the NEW closure
    if (!routeIntersectsPolygon(route.coordinates, poly)) continue;

    if (!em.selectedHospital) continue;
    await rerouteEmergency(em, avoidPolygons);
  }
}

async function rerouteAllActive(): Promise<void> {
  const actives = await prisma.emergency.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, driverId: true, selectedHospitalId: true,
      originLat: true, originLng: true,
      selectedHospital: { select: { lat: true, lng: true } },
      routeGeoJson: true,
    },
  });

  const avoidPolygons = await getAvoidPolygons();

  for (const em of actives) {
    if (!em.selectedHospital) continue;
    await rerouteEmergency(em, avoidPolygons);
  }
}

async function rerouteEmergency(
  em: {
    id: string;
    driverId: string;
    selectedHospitalId: string | null;
    originLat: number;
    originLng: number;
    selectedHospital: { lat: number; lng: number } | null;
  },
  avoidPolygons: GeoJsonPolygon[]
): Promise<void> {
  if (!em.selectedHospital) return;

  try {
    const result = await routing.route(
      em.originLat, em.originLng,
      em.selectedHospital.lat, em.selectedHospital.lng,
      avoidPolygons
    );

    await prisma.emergency.update({
      where: { id: em.id },
      data: {
        routeGeoJson:   result.geoJson as unknown as Prisma.InputJsonValue,
        etaSeconds:     result.etaSeconds,
        distanceMeters: result.distanceMeters,
      },
    });

    // Emit route:updated to emergency room + driver + police + hospital
    try {
      const io = getIO();
      const payload = {
        emergencyId: em.id,
        routeGeoJson: result.geoJson,
        etaSeconds: result.etaSeconds,
        distanceMeters: result.distanceMeters,
      };
      io.to(`emergency:${em.id}`).emit("route:updated", payload);
      io.to(`driver:${em.driverId}`).emit("route:updated", payload);
      io.to("role:POLICE").emit("route:updated", payload);
      if (em.selectedHospitalId) {
        io.to(`hospital:${em.selectedHospitalId}`).emit("route:updated", payload);
      }
    } catch { /* socket not up in tests */ }

    // Also emit emergency:updated so all listeners refetch full state
    emitEmergencyEvent("emergency:updated", {
      emergencyId: em.id,
      driverId: em.driverId,
      selectedHospitalId: em.selectedHospitalId,
      data: { emergencyId: em.id, action: "ROUTE_UPDATED" },
    });

    console.log(`[ClosureService] Re-routed emergency ${em.id}`);
  } catch (err) {
    console.error(`[ClosureService] Re-route failed for emergency ${em.id}:`, err);
  }
}

async function getAvoidPolygons(): Promise<GeoJsonPolygon[]> {
  const closures = await prisma.roadClosure.findMany({
    where: { active: true },
    select: { polygonGeoJson: true },
  });

  return closures
    .map((c) => {
      try { return JSON.parse(JSON.stringify(c.polygonGeoJson)) as GeoJsonPolygon; }
      catch { return null; }
    })
    .filter((p): p is GeoJsonPolygon => p !== null);
}

function broadcastClosureUpdated(): void {
  try {
    const io = getIO();
    io.emit("closure:updated", { ts: Date.now() });
  } catch { /* ignore */ }
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/**
 * Check if any coordinate of the route linestring falls inside the polygon.
 * Uses the ray-casting (even-odd) algorithm.
 */
function routeIntersectsPolygon(
  coords: [number, number][],
  poly: GeoJsonPolygon
): boolean {
  // Support both raw Polygon and GeoJSON Feature<Polygon>
  const ring: [number, number][] | undefined =
    poly.type === "Feature"
      ? poly.geometry?.coordinates?.[0]
      : (poly as { type: "Polygon"; coordinates: [number, number][][] }).coordinates?.[0];

  if (!ring || ring.length < 3) return false;

  return coords.some(([lng, lat]) => pointInPolygon(lng, lat, ring));
}

/** Ray-casting point-in-polygon. coords are [lng, lat]. */
function pointInPolygon(
  x: number,
  y: number,
  ring: [number, number][]
): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Export helpers for use in driver route (deviation reroute) ────────────────

export { getAvoidPolygons, rerouteEmergency };
