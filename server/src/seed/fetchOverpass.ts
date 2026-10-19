/**
 * fetchOverpass.ts
 *
 * Fetches hospitals (amenity=hospital) and traffic signals (highway=traffic_signals)
 * from the Overpass API within DEMO_RADIUS_KM of DEMO_CENTER_LAT/LNG,
 * and saves them to /server/seed/hospitals.json and /server/seed/signals.json.
 *
 * Run: npm run seed:fetch  (from workspace root)
 *
 * Per spec section 14: "The demo must never depend on Overpass being reachable."
 * Run this once and commit the JSON files.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEED_DIR = path.resolve(__dirname, "../../seed");

async function overpassQuery(query: string): Promise<{ elements: OverpassElement[] }> {
  const body = `data=${encodeURIComponent(query)}`;
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    throw new Error(`Overpass returned HTTP ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<{ elements: OverpassElement[] }>;
}

interface OverpassElement {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface SeedHospital {
  osmId: number;
  name: string;
  lat: number;
  lng: number;
}

interface SeedSignal {
  osmId: number;
  lat: number;
  lng: number;
  name: string | null;
}

async function main() {
  fs.mkdirSync(SEED_DIR, { recursive: true });

  const { DEMO_CENTER_LAT: lat, DEMO_CENTER_LNG: lng, DEMO_RADIUS_KM: radiusKm } = env;
  const radiusM = radiusKm * 1000;

  console.log(`[seed:fetch] Querying Overpass within ${radiusKm} km of (${lat}, ${lng})…`);

  // ── Hospitals ───────────────────────────────────────────────────────────────
  const hospitalQuery = `
[out:json][timeout:60];
(
  node["amenity"="hospital"](around:${radiusM},${lat},${lng});
  way["amenity"="hospital"](around:${radiusM},${lat},${lng});
  relation["amenity"="hospital"](around:${radiusM},${lat},${lng});
);
out center;
`;

  const hospitalData = await overpassQuery(hospitalQuery);
  const hospitals: SeedHospital[] = hospitalData.elements
    .map((el) => {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (!elLat || !elLng) return null;
      return {
        osmId: el.id,
        name:
          el.tags?.name ??
          el.tags?.["name:en"] ??
          el.tags?.["alt_name"] ??
          "Unnamed Hospital",
        lat: elLat,
        lng: elLng,
      };
    })
    .filter((h): h is SeedHospital => h !== null);

  console.log(`[seed:fetch] Found ${hospitals.length} hospitals`);
  fs.writeFileSync(
    path.join(SEED_DIR, "hospitals.json"),
    JSON.stringify(hospitals, null, 2)
  );

  // ── Traffic signals ─────────────────────────────────────────────────────────
  const signalQuery = `
[out:json][timeout:60];
node["highway"="traffic_signals"](around:${radiusM},${lat},${lng});
out;
`;

  const signalData = await overpassQuery(signalQuery);
  const signals: SeedSignal[] = signalData.elements.map((el) => ({
    osmId: el.id,
    lat: el.lat!,
    lng: el.lon!,
    name: el.tags?.name ?? null,
  }));

  console.log(`[seed:fetch] Found ${signals.length} traffic signals`);
  fs.writeFileSync(
    path.join(SEED_DIR, "signals.json"),
    JSON.stringify(signals, null, 2)
  );

  console.log(`[seed:fetch] ✅ Saved to ${SEED_DIR}`);
}

main().catch((err) => {
  console.error("[seed:fetch] ❌ Failed:", err);
  process.exit(1);
});
