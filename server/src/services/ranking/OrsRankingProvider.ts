import type {
  HospitalForRanking,
  RankedHospital,
  RankingProvider,
} from "./RankingProvider";
import { OrsRoutingProvider } from "../routing/OrsRoutingProvider";

const routingProvider = new OrsRoutingProvider();

/**
 * Phase 3/10 ranking: sort by routed ETA using OpenRouteService (with OSRM fallback).
 * Hospitals with no available beds are excluded before routing to avoid wasted API calls.
 * Implements the RankingProvider interface so it can be used as a drop-in replacement
 * for StraightLineRankingProvider.
 */
export class OrsRankingProvider implements RankingProvider {
  async rank(
    originLat: number,
    originLng: number,
    hospitals: HospitalForRanking[]
  ): Promise<RankedHospital[]> {
    const eligible = hospitals.filter((h) => h.availableBeds > 0);
    if (eligible.length === 0) return [];

    const results = await routingProvider.matrix(originLat, originLng, eligible);

    return results
      .map((r) => ({
        hospitalId:     r.id,
        distanceMeters: r.distanceMeters,
        etaSeconds:     r.etaSeconds,
      }))
      .sort((a, b) => a.etaSeconds - b.etaSeconds);
  }

  async fetchRoute(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<{ distanceMeters: number; etaSeconds: number; routeGeoJson: unknown }> {
    const result = await routingProvider.route(originLat, originLng, destLat, destLng);
    return {
      distanceMeters: result.distanceMeters,
      etaSeconds:     result.etaSeconds,
      routeGeoJson:   result.geoJson,
    };
  }
}
