/** A hospital candidate ready for ranking */
export interface HospitalForRanking {
  id: string;
  lat: number;
  lng: number;
  availableBeds: number;
}

/** One entry in the ranked output stored on Emergency.rankedHospitals */
export interface RankedHospital {
  hospitalId:     string;
  distanceMeters: number;
  etaSeconds:     number;
  /** Stored when route is computed (on create/reassign). May be null for legacy rows. */
  routeGeoJson?:  unknown;
}

/**
 * RankingProvider interface.
 *
 * Returns hospitals sorted by routed ETA, EXCLUDING hospitals with 0 available beds.
 * Swap the implementation via DI without touching EmergencyService.
 * Phase 1:  StraightLineRankingProvider (haversine distance).
 * Phase 3/10: OrsRankingProvider (real routing via OpenRouteService + OSRM fallback).
 */
export interface RankingProvider {
  rank(
    originLat: number,
    originLng: number,
    hospitals: HospitalForRanking[]
  ): Promise<RankedHospital[]>;

  /**
   * Fetch the full route GeoJSON for a single origin→destination pair.
   * Called once on emergency create / hospital re-assignment.
   */
  fetchRoute(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<{ distanceMeters: number; etaSeconds: number; routeGeoJson: unknown }>;
}
