/**
 * OrsRoutingProvider — OpenRouteService routing provider.
 *
 * Matrix: POST /v2/matrix/driving-car  (fastest + distance)
 * Route:  POST /v2/directions/driving-car (full GeoJSON geometry)
 *
 * Falls back to OsrmRoutingProvider if:
 *   - ORS_API_KEY is missing / placeholder
 *   - ORS returns a non-2xx response (quota exhausted, 406, etc.)
 *
 * Killing the ORS key in .env and restarting the server will cause
 * every call to go directly to OSRM without crashing.
 */

import type {
  RoutingProvider,
  DetailedRouteResult,
  GeoJsonLineString,
} from "./RoutingProvider";
import { OsrmRoutingProvider } from "./OsrmRoutingProvider";
import { env } from "../../config/env";

const ORS_BASE = "https://api.openrouteservice.org";
const TIMEOUT_MS = 12_000;
const PLACEHOLDER = "PLACEHOLDER_REPLACE_WITH_REAL_ORS_KEY";

const osrm = new OsrmRoutingProvider();
let orsPermanentlyDisabled = false;

function isValidKey(): boolean {
  if (orsPermanentlyDisabled) return false;
  return (
    !!env.ORS_API_KEY &&
    env.ORS_API_KEY !== PLACEHOLDER &&
    env.ORS_API_KEY.length > 10
  );
}

async function orsPost(path: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${ORS_BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: env.ORS_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }
}

export class OrsRoutingProvider implements RoutingProvider {
  async matrix(
    originLat: number,
    originLng: number,
    destinations: Array<{ id: string; lat: number; lng: number }>
  ): Promise<Array<{ id: string; distanceMeters: number; etaSeconds: number }>> {
    if (destinations.length === 0) return [];

    if (!isValidKey()) {
      console.info("[ORS] No valid API key → using OSRM fallback for matrix");
      return osrm.matrix(originLat, originLng, destinations);
    }

    // ORS matrix format: locations = [[lng,lat], ...]
    // sources = [0] (index of origin), destinations = rest
    const locations = [
      [originLng, originLat],
      ...destinations.map((d) => [d.lng, d.lat]),
    ];
    const destIndices = destinations.map((_, i) => i + 1);

    try {
      const res = await orsPost("/v2/matrix/driving-car", {
        locations,
        sources:      [0],
        destinations: destIndices,
        metrics:      ["duration", "distance"],
        units:        "m",
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          orsPermanentlyDisabled = true;
        }
        const text = await res.text().catch(() => "");
        console.warn(`[ORS] matrix HTTP ${res.status} → OSRM fallback: ${text.slice(0, 200)}`);
        return osrm.matrix(originLat, originLng, destinations);
      }

      const json = (await res.json()) as {
        durations: number[][];
        distances: number[][];
      };

      return destinations.map((d, i) => ({
        id:             d.id,
        distanceMeters: Math.round(json.distances[0][i] ?? 0),
        etaSeconds:     Math.round(json.durations[0][i] ?? 0),
      }));
    } catch (err) {
      console.warn("[ORS] matrix error → OSRM fallback:", err);
      return osrm.matrix(originLat, originLng, destinations);
    }
  }

  async route(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    avoidPolygons?: unknown[]
  ): Promise<DetailedRouteResult> {
    if (!isValidKey()) {
      console.info("[ORS] No valid API key → using OSRM fallback for route");
      return osrm.route(originLat, originLng, destLat, destLng);
    }

    try {
      const body: Record<string, unknown> = {
        coordinates: [
          [originLng, originLat],
          [destLng,   destLat],
        ],
        instructions: false,
      };

      // Inject road closure polygons as ORS avoid_polygons
      if (avoidPolygons && avoidPolygons.length > 0) {
        body.options = {
          avoid_polygons: {
            type: "MultiPolygon",
            coordinates: avoidPolygons.map((p) => {
              const poly = p as { type?: string; coordinates?: unknown[][]; geometry?: { coordinates?: unknown[][] } };
              return poly.type === "Feature"
                ? (poly.geometry?.coordinates ?? [])
                : (poly.coordinates ?? []);
            }),
          },
        };
      }

      const res = await orsPost("/v2/directions/driving-car", body);

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          orsPermanentlyDisabled = true;
        }
        const text = await res.text().catch(() => "");
        console.warn(`[ORS] route HTTP ${res.status} → OSRM fallback: ${text.slice(0, 200)}`);
        return osrm.route(originLat, originLng, destLat, destLng);
      }

      const json = (await res.json()) as {
        features: Array<{
          properties: { summary: { distance: number; duration: number } };
          geometry:   GeoJsonLineString;
        }>;
      };

      const feat = json.features[0];
      return {
        distanceMeters: Math.round(feat.properties.summary.distance),
        etaSeconds:     Math.round(feat.properties.summary.duration),
        geoJson:        feat.geometry,
      };
    } catch (err) {
      console.warn("[ORS] route error → OSRM fallback:", err);
      return osrm.route(originLat, originLng, destLat, destLng);
    }
  }
}
