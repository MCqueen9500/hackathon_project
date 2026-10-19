/**
 * OsrmRoutingProvider — OSRM fallback routing provider.
 *
 * Uses the public OSRM demo server (router.project-osrm.org).
 * For production this should be replaced with a self-hosted instance.
 *
 * Matrix: uses /table endpoint (duration + distance).
 * Route:  uses /route endpoint with geometries=geojson.
 */

import type {
  RoutingProvider,
  RouteResult,
  DetailedRouteResult,
  GeoJsonLineString,
} from "./RoutingProvider";

const OSRM_BASE = "https://router.project-osrm.org";
const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export class OsrmRoutingProvider implements RoutingProvider {
  async matrix(
    originLat: number,
    originLng: number,
    destinations: Array<{ id: string; lat: number; lng: number }>
  ): Promise<Array<{ id: string } & RouteResult>> {
    if (destinations.length === 0) return [];

    // OSRM /table: coordinates = origin;dest1;dest2;…
    // sources=0 → only compute rows from origin
    const coords = [
      `${originLng},${originLat}`,
      ...destinations.map((d) => `${d.lng},${d.lat}`),
    ].join(";");

    const destIndices = destinations.map((_, i) => i + 1).join(";");
    const url =
      `${OSRM_BASE}/table/v1/driving/${coords}` +
      `?sources=0&destinations=${destIndices}&annotations=duration,distance`;

    let durations: (number | null)[];
    let distances: (number | null)[];

    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`OSRM table HTTP ${res.status}`);
      const json = (await res.json()) as {
        durations: (number | null)[][];
        distances: (number | null)[][];
      };
      durations = json.durations[0];
      distances = json.distances[0];
    } catch (err) {
      console.warn("[OSRM] matrix failed, falling back to haversine:", err);
      // Degrade gracefully: straight-line fallback within OSRM provider
      return destinations.map((d) => ({
        id: d.id,
        distanceMeters: haversine(originLat, originLng, d.lat, d.lng),
        etaSeconds: Math.round(haversine(originLat, originLng, d.lat, d.lng) / 10),
      }));
    }

    return destinations.map((d, i) => ({
      id: d.id,
      distanceMeters: Math.round(distances[i] ?? haversine(originLat, originLng, d.lat, d.lng)),
      etaSeconds:     Math.round(durations[i] ?? haversine(originLat, originLng, d.lat, d.lng) / 10),
    }));
  }

  async route(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<DetailedRouteResult> {
    const coords = `${originLng},${originLat};${destLng},${destLat}`;
    const url =
      `${OSRM_BASE}/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson`;

    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`OSRM route HTTP ${res.status}`);
      const json = (await res.json()) as {
        routes: Array<{
          duration: number;
          distance: number;
          geometry: GeoJsonLineString;
        }>;
      };
      const route = json.routes[0];
      return {
        distanceMeters: Math.round(route.distance),
        etaSeconds:     Math.round(route.duration),
        geoJson:        route.geometry,
      };
    } catch (err) {
      console.warn("[OSRM] route failed, returning straight-line stub:", err);
      const dist = haversine(originLat, originLng, destLat, destLng);
      return {
        distanceMeters: Math.round(dist),
        etaSeconds:     Math.round(dist / 10),
        geoJson: {
          type: "LineString",
          coordinates: [
            [originLng, originLat],
            [destLng,   destLat],
          ],
        },
      };
    }
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
