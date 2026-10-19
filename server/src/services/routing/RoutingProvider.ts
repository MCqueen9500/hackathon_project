/**
 * RoutingProvider interface + implementations.
 *
 * Phase 3 / 10: real turn-by-turn routing replaces straight-line haversine.
 *
 *  - OrsRoutingProvider  — calls OpenRouteService Matrix API (preferred).
 *  - OsrmRoutingProvider — falls back to public OSRM demo server.
 *
 * Both return ETAs in seconds and distances in metres.
 * GeoJSON is fetched only for the *single* route actually selected (to avoid
 * hitting ORS quotas for every candidate).
 */

// ── Result types ──────────────────────────────────────────────────────────────

/** Distance + ETA for one origin→destination pair. */
export interface RouteResult {
  distanceMeters: number;
  etaSeconds: number;
}

/** RouteResult + the full GeoJSON LineString for map rendering. */
export interface DetailedRouteResult extends RouteResult {
  geoJson: GeoJsonLineString;
}

export interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][]; // [lng, lat]
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface RoutingProvider {
  /**
   * Get distances and ETAs from one origin to many destinations.
   * Used for ranking candidate hospitals.
   */
  matrix(
    originLat: number,
    originLng: number,
    destinations: Array<{ id: string; lat: number; lng: number }>
  ): Promise<Array<{ id: string } & RouteResult>>;

  /**
   * Fetch the full route GeoJSON for a single origin→destination pair.
   * Called once on emergency create / hospital re-assignment.
   */
  route(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<DetailedRouteResult>;
}
