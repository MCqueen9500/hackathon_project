import { haversineMeters } from "../ranking/StraightLineRankingProvider";

/**
 * Drop points every `spacingMin`–`spacingMax` metres along a GeoJSON LineString
 * of [lng, lat] coordinates.
 */
export function placeAlongRoute(
  coords: [number, number][],
  spacingMin = 300,
  spacingMax = 400
): { lat: number; lng: number }[] {
  if (coords.length < 2) return [];
  const out: { lat: number; lng: number }[] = [];
  let nextAt = spacingMin + Math.random() * (spacingMax - spacingMin);
  let travelled = 0;

  for (let i = 1; i < coords.length; i++) {
    const [lngA, latA] = coords[i - 1];
    const [lngB, latB] = coords[i];
    const seg = haversineMeters(latA, lngA, latB, lngB);
    if (seg <= 0) continue;

    while (travelled + seg >= nextAt) {
      const t = (nextAt - travelled) / seg;
      out.push({
        lat: latA + t * (latB - latA),
        lng: lngA + t * (lngB - lngA),
      });
      nextAt += spacingMin + Math.random() * (spacingMax - spacingMin);
    }
    travelled += seg;
  }
  return out;
}
