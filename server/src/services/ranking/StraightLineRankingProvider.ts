import type {
  HospitalForRanking,
  RankedHospital,
  RankingProvider,
} from "./RankingProvider";

const EARTH_RADIUS_M = 6_371_000;
/**
 * Assumed average city ambulance speed: 36 km/h ≈ 10 m/s.
 * Phase 3 replaces this with real ORS routing ETAs.
 */
const AVG_SPEED_MS = 10;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Returns straight-line (haversine) distance in metres between two lat/lng points.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Phase-1 ranking: sort by haversine distance, exclude hospitals with no beds.
 * Implements the RankingProvider interface — used in tests and as ultimate fallback.
 */
export class StraightLineRankingProvider implements RankingProvider {
  async rank(
    originLat: number,
    originLng: number,
    hospitals: HospitalForRanking[]
  ): Promise<RankedHospital[]> {
    return hospitals
      .filter((h) => h.availableBeds > 0)
      .map((h) => {
        const distanceMeters = Math.round(
          haversineMeters(originLat, originLng, h.lat, h.lng)
        );
        return {
          hospitalId: h.id,
          distanceMeters,
          etaSeconds: Math.round(distanceMeters / AVG_SPEED_MS),
        };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  async fetchRoute(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<{ distanceMeters: number; etaSeconds: number; routeGeoJson: unknown }> {
    const distanceMeters = Math.round(
      haversineMeters(originLat, originLng, destLat, destLng)
    );
    return {
      distanceMeters,
      etaSeconds: Math.round(distanceMeters / AVG_SPEED_MS),
      routeGeoJson: {
        type: "LineString",
        coordinates: [
          [originLng, originLat],
          [destLng, destLat],
        ],
      },
    };
  }
}
