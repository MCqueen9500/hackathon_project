/** A hospital candidate ready for ranking */
export interface HospitalForRanking {
  id: string;
  lat: number;
  lng: number;
  availableBeds: number;
}

/** One entry in the ranked output stored on Emergency.rankedHospitals */
export interface RankedHospital {
  hospitalId: string;
  distanceMeters: number;
  etaSeconds: number;
}

/**
 * RankingProvider interface.
 *
 * Returns hospitals sorted nearest-first, EXCLUDING hospitals with 0 available beds.
 * Swap the implementation via DI without touching EmergencyService.
 * Phase 1: StraightLineRankingProvider (haversine distance).
 * Phase 3: OrsRankingProvider (real routing via OpenRouteService).
 */
export interface RankingProvider {
  rank(
    originLat: number,
    originLng: number,
    hospitals: HospitalForRanking[]
  ): Promise<RankedHospital[]>;
}
