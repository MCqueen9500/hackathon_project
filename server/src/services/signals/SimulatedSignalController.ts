/**
 * SimulatedSignalController (spec section 10)
 *
 * - Keeps signal state entirely in memory (backed by DB at boot for initial load).
 * - Normal cycle: RED 30s → GREEN 25s → YELLOW 5s → RED (env configurable).
 * - Corridor override: FORCED_GREEN wins over normal cycle.
 * - Conflict rule: higher severity wins; equal severity → earlier createdAt wins.
 * - Broadcasts `signals:updated` via Socket.IO when state changes.
 *
 * Seeded from the `Signal` table on `init()`.
 */

import type { SignalController, SignalClaim, SignalSnapshot, SignalState } from "./SignalController";
import { haversineMeters } from "../ranking/StraightLineRankingProvider";
import { env } from "../../config/env";

const CYCLE_RED_MS    = env.SIGNAL_RED_MS;
const CYCLE_GREEN_MS  = env.SIGNAL_GREEN_MS;
const CYCLE_YELLOW_MS = env.SIGNAL_YELLOW_MS;

interface SignalRecord {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  // Normal-cycle phase tracking
  cycleOffset: number;   // ms offset into current cycle at boot
  cycleTotal:  number;   // RED+GREEN+YELLOW = 60 s
  // Active corridor overrides: map of emergencyId → claim
  claims: Map<string, SignalClaim>;
}

// Severity ordering (lower = higher priority)
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  SERIOUS:  1,
  STABLE:   2,
};

function winnerClaim(
  a: SignalClaim,
  b: SignalClaim
): SignalClaim {
  const ra = SEVERITY_RANK[a.severity] ?? 99;
  const rb = SEVERITY_RANK[b.severity] ?? 99;
  if (ra !== rb) return ra < rb ? a : b;
  // Equal severity → earlier createdAt wins
  return a.createdAt <= b.createdAt ? a : b;
}

export class SimulatedSignalController implements SignalController {
  private signals: Map<string, SignalRecord> = new Map();
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private emitFn: ((snapshots: SignalSnapshot[]) => void) | null = null;

  /** Call after instantiation with a snapshot-broadcast function. */
  setEmitter(fn: (snapshots: SignalSnapshot[]) => void) {
    this.emitFn = fn;
  }

  /** Seed signal records from the DB rows. */
  init(rows: { id: string; name: string | null; lat: number; lng: number }[]) {
    const now = Date.now();
    const total = CYCLE_RED_MS + CYCLE_GREEN_MS + CYCLE_YELLOW_MS;

    for (const row of rows) {
      // Stagger offsets so not all signals change at once
      const offset = Math.floor(Math.random() * total);
      this.signals.set(row.id, {
        id:          row.id,
        name:        row.name,
        lat:         row.lat,
        lng:         row.lng,
        cycleOffset: (now % total + offset) % total,
        cycleTotal:  total,
        claims:      new Map(),
      });
    }

    // Start normal cycle tick every 500 ms
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this._tick(), 500);

    console.log(`[signals] Initialised ${rows.length} signals`);
  }

  private _cycleState(record: SignalRecord): SignalState {
    const phase = (Date.now() - record.cycleOffset) % record.cycleTotal;
    if (phase < CYCLE_RED_MS)                                   return "RED";
    if (phase < CYCLE_RED_MS + CYCLE_GREEN_MS)                  return "GREEN";
    return "YELLOW";
  }

  private _effectiveState(record: SignalRecord): SignalState {
    if (record.claims.size === 0) return this._cycleState(record);

    // Find winning claim
    let winner: SignalClaim | null = null;
    for (const claim of record.claims.values()) {
      winner = winner ? winnerClaim(winner, claim) : claim;
    }
    return winner ? "FORCED_GREEN" : this._cycleState(record);
  }

  private _tick() {
    const snapshots = this.getAll();
    this.emitFn?.(snapshots);
  }

  // ── SignalController ──────────────────────────────────────────────────────────

  forceGreen(signalId: string, claim: SignalClaim) {
    const rec = this.signals.get(signalId);
    if (!rec) return;
    rec.claims.set(claim.emergencyId, claim);
    this.emitFn?.(this.getAll());
  }

  release(signalId: string, emergencyId: string) {
    const rec = this.signals.get(signalId);
    if (!rec) return;
    rec.claims.delete(emergencyId);
    this.emitFn?.(this.getAll());
  }

  releaseAll(emergencyId: string) {
    let changed = false;
    for (const rec of this.signals.values()) {
      if (rec.claims.has(emergencyId)) {
        rec.claims.delete(emergencyId);
        changed = true;
      }
    }
    if (changed) this.emitFn?.(this.getAll());
  }

  getAll(): SignalSnapshot[] {
    const out: SignalSnapshot[] = [];
    for (const rec of this.signals.values()) {
      out.push({
        id:    rec.id,
        name:  rec.name,
        lat:   rec.lat,
        lng:   rec.lng,
        state: this._effectiveState(rec),
      });
    }
    return out;
  }

  getForEmergency(emergencyId: string): string[] {
    const ids: string[] = [];
    for (const rec of this.signals.values()) {
      if (rec.claims.has(emergencyId)) ids.push(rec.id);
    }
    return ids;
  }

  /**
   * Green-wave update: called on every location ping for ACTIVE emergencies.
   *
   * @param lat          Current ambulance lat
   * @param lng          Current ambulance lng
   * @param routeCoords  [lng, lat][] GeoJSON route coordinates
   * @param emergencyId  ID of the emergency
   * @param severity     Severity for conflict resolution
   * @param createdAt    CreatedAt for conflict resolution
   */
  applyGreenWave(
    lat: number,
    lng: number,
    routeCoords: [number, number][],
    emergencyId: string,
    severity: "CRITICAL" | "SERIOUS" | "STABLE",
    createdAt: Date
  ) {
    const AHEAD_M  = Number(process.env.SIGNAL_AHEAD_M   ?? 400);
    const PASSED_M = Number(process.env.SIGNAL_PASSED_M  ?? 100);

    const claim: SignalClaim = { emergencyId, severity, createdAt };

    for (const [id, rec] of this.signals.entries()) {
      // Distance from ambulance to signal
      const dToAmb = haversineMeters(lat, lng, rec.lat, rec.lng);

      // Project signal onto route to determine if it is "ahead" or "passed"
      const projDist = this._projectOnRoute(rec.lat, rec.lng, routeCoords);
      const ambDist  = this._projectOnRoute(lat, lng, routeCoords);

      const isAhead  = projDist > ambDist && projDist - ambDist <= AHEAD_M;
      const isPassed = ambDist - projDist > PASSED_M;

      if (isAhead && dToAmb < AHEAD_M * 1.5) {
        this.forceGreen(id, claim);
      } else if (isPassed) {
        this.release(id, emergencyId);
      }
    }
  }

  /**
   * Returns the cumulative distance (metres) of the closest point on `routeCoords`
   * to the given lat/lng. Used to determine "ahead" vs "passed".
   */
  private _projectOnRoute(
    lat: number,
    lng: number,
    routeCoords: [number, number][]
  ): number {
    if (routeCoords.length === 0) return 0;

    let minDist   = Infinity;
    let minI      = 0;
    let cumBefore = 0;
    let segCums: number[] = [0];

    for (let i = 1; i < routeCoords.length; i++) {
      const [lngA, latA] = routeCoords[i - 1];
      const [lngB, latB] = routeCoords[i];
      segCums.push(segCums[i - 1] + haversineMeters(latA, lngA, latB, lngB));
    }

    for (let i = 0; i < routeCoords.length; i++) {
      const [lngC, latC] = routeCoords[i];
      const d = haversineMeters(lat, lng, latC, lngC);
      if (d < minDist) {
        minDist = d;
        minI    = i;
        cumBefore = segCums[i];
      }
    }

    return cumBefore;
  }

  destroy() {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }
}

export const signalController = new SimulatedSignalController();
