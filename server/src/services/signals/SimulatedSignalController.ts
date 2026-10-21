/**
 * SimulatedSignalController (spec section 10)
 *
 * - Keeps signal state entirely in memory (backed by DB at boot for initial load).
 * - Normal cycle: RED → GREEN → YELLOW → RED (env configurable).
 * - Corridor override: FORCED_GREEN wins over normal cycle.
 * - Conflict rule: higher severity wins; equal severity → earlier createdAt wins.
 * - Broadcasts `signals:updated` via Socket.IO when state changes.
 */

import type { SignalController, SignalClaim, SignalSnapshot, SignalState } from "./SignalController";
import { haversineMeters } from "../ranking/StraightLineRankingProvider";
import { env } from "../../config/env";

const CYCLE_RED_MS    = env.SIGNAL_RED_MS;
const CYCLE_GREEN_MS  = env.SIGNAL_GREEN_MS;
const CYCLE_YELLOW_MS = env.SIGNAL_YELLOW_MS;
const AHEAD_M         = env.SIGNAL_AHEAD_M;
const PASSED_M        = env.SIGNAL_PASSED_M;
const ON_ROUTE_M      = 80;

interface SignalRecord {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  simulated: boolean;
  cycleOffset: number;
  cycleTotal:  number;
  claims: Map<string, SignalClaim>;
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  SERIOUS:  1,
  STABLE:   2,
};

function winnerClaim(a: SignalClaim, b: SignalClaim): SignalClaim {
  const ra = SEVERITY_RANK[a.severity] ?? 99;
  const rb = SEVERITY_RANK[b.severity] ?? 99;
  if (ra !== rb) return ra < rb ? a : b;
  return a.createdAt <= b.createdAt ? a : b;
}

export class SimulatedSignalController implements SignalController {
  private signals: Map<string, SignalRecord> = new Map();
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private emitFn: ((snapshots: SignalSnapshot[]) => void) | null = null;
  private lastFingerprint = "";

  setEmitter(fn: (snapshots: SignalSnapshot[]) => void) {
    this.emitFn = fn;
  }

  init(rows: { id: string; name: string | null; lat: number; lng: number; simulated?: boolean }[]) {
    this.signals.clear();
    const now = Date.now();
    const total = CYCLE_RED_MS + CYCLE_GREEN_MS + CYCLE_YELLOW_MS;

    for (const row of rows) {
      const offset = Math.floor(Math.random() * total);
      this.signals.set(row.id, {
        id:          row.id,
        name:        row.name,
        lat:         row.lat,
        lng:         row.lng,
        simulated:   row.simulated ?? false,
        cycleOffset: now - offset,
        cycleTotal:  total,
        claims:      new Map(),
      });
    }

    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this._tick(), 1_000);
    this.lastFingerprint = "";
    this._emit();
    console.log(`[signals] Initialised ${rows.length} signals`);
  }

  upsert(row: { id: string; name: string | null; lat: number; lng: number; simulated?: boolean }) {
    const existing = this.signals.get(row.id);
    const total = CYCLE_RED_MS + CYCLE_GREEN_MS + CYCLE_YELLOW_MS;
    if (existing) {
      existing.name = row.name;
      existing.lat = row.lat;
      existing.lng = row.lng;
      if (row.simulated !== undefined) existing.simulated = row.simulated;
    } else {
      this.signals.set(row.id, {
        id:          row.id,
        name:        row.name,
        lat:         row.lat,
        lng:         row.lng,
        simulated:   row.simulated ?? false,
        cycleOffset: Date.now() - Math.floor(Math.random() * total),
        cycleTotal:  total,
        claims:      new Map(),
      });
    }
    this._emit(true);
  }

  remove(id: string) {
    if (!this.signals.delete(id)) return;
    this._emit(true);
  }

  private _cycleState(record: SignalRecord): SignalState {
    const phase = (Date.now() - record.cycleOffset) % record.cycleTotal;
    if (phase < CYCLE_RED_MS)                  return "RED";
    if (phase < CYCLE_RED_MS + CYCLE_GREEN_MS) return "GREEN";
    return "YELLOW";
  }

  private _effectiveState(record: SignalRecord): SignalState {
    if (record.claims.size === 0) return this._cycleState(record);
    let winner: SignalClaim | null = null;
    for (const claim of record.claims.values()) {
      winner = winner ? winnerClaim(winner, claim) : claim;
    }
    return winner ? "FORCED_GREEN" : this._cycleState(record);
  }

  private _fingerprint(snapshots: SignalSnapshot[]): string {
    return snapshots.map((s) => `${s.id}:${s.state}:${s.lat.toFixed(5)}:${s.lng.toFixed(5)}`).join("|");
  }

  private _emit(force = false) {
    const snapshots = this.getAll();
    const fp = this._fingerprint(snapshots);
    if (!force && fp === this.lastFingerprint) return;
    this.lastFingerprint = fp;
    this.emitFn?.(snapshots);
  }

  private _tick() {
    this._emit();
  }

  forceGreen(signalId: string, claim: SignalClaim) {
    if (this._forceGreen(signalId, claim)) this._emit(true);
  }

  release(signalId: string, emergencyId: string) {
    if (this._release(signalId, emergencyId)) this._emit(true);
  }

  private _forceGreen(signalId: string, claim: SignalClaim): boolean {
    const rec = this.signals.get(signalId);
    if (!rec) return false;
    rec.claims.set(claim.emergencyId, claim);
    return true;
  }

  private _release(signalId: string, emergencyId: string): boolean {
    const rec = this.signals.get(signalId);
    if (!rec) return false;
    return rec.claims.delete(emergencyId);
  }

  releaseAll(emergencyId: string) {
    let changed = false;
    for (const rec of this.signals.values()) {
      if (rec.claims.has(emergencyId)) {
        rec.claims.delete(emergencyId);
        changed = true;
      }
    }
    if (changed) this._emit(true);
  }

  getAll(): SignalSnapshot[] {
    const out: SignalSnapshot[] = [];
    for (const rec of this.signals.values()) {
      out.push({
        id:         rec.id,
        name:       rec.name,
        lat:        rec.lat,
        lng:        rec.lng,
        state:      this._effectiveState(rec),
        simulated:  rec.simulated,
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

  applyGreenWave(
    lat: number,
    lng: number,
    routeCoords: [number, number][],
    emergencyId: string,
    severity: "CRITICAL" | "SERIOUS" | "STABLE",
    createdAt: Date
  ) {
    const claim: SignalClaim = { emergencyId, severity, createdAt };
    const amb = this._projectOnRoute(lat, lng, routeCoords);
    let changed = false;

    for (const [id, rec] of this.signals.entries()) {
      const proj = this._projectOnRoute(rec.lat, rec.lng, routeCoords);

      if (proj.distToRoute > ON_ROUTE_M) {
        if (this._release(id, emergencyId)) changed = true;
        continue;
      }

      const isAhead  = proj.alongM > amb.alongM && proj.alongM - amb.alongM <= AHEAD_M;
      const isPassed = amb.alongM - proj.alongM > PASSED_M;

      if (isAhead) {
        if (this._forceGreen(id, claim)) changed = true;
      } else if (isPassed) {
        if (this._release(id, emergencyId)) changed = true;
      }
    }
    if (changed) this._emit(true);
  }

  /**
   * Closest-point projection onto the polyline. `alongM` is distance from the
   * start of the route; `distToRoute` is perpendicular distance to the line.
   */
  private _projectOnRoute(
    lat: number,
    lng: number,
    routeCoords: [number, number][]
  ): { alongM: number; distToRoute: number } {
    if (routeCoords.length === 0) return { alongM: 0, distToRoute: Infinity };
    if (routeCoords.length === 1) {
      const [lng0, lat0] = routeCoords[0];
      return { alongM: 0, distToRoute: haversineMeters(lat, lng, lat0, lng0) };
    }

    let bestDist = Infinity;
    let bestAlong = 0;
    let cum = 0;

    for (let i = 1; i < routeCoords.length; i++) {
      const [lngA, latA] = routeCoords[i - 1];
      const [lngB, latB] = routeCoords[i];
      const segLen = haversineMeters(latA, lngA, latB, lngB);
      const { t, dist } = closestOnSegment(lat, lng, latA, lngA, latB, lngB);
      if (dist < bestDist) {
        bestDist = dist;
        bestAlong = cum + t * segLen;
      }
      cum += segLen;
    }

    return { alongM: bestAlong, distToRoute: bestDist };
  }

  destroy() {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }
}

/** Unit-interval t of the closest point on segment AB to P, plus distance in metres. */
function closestOnSegment(
  latP: number, lngP: number,
  latA: number, lngA: number,
  latB: number, lngB: number
): { t: number; dist: number } {
  const dLat = latB - latA;
  const dLng = lngB - lngA;
  const len2 = dLat * dLat + dLng * dLng;
  let t = 0;
  if (len2 > 0) {
    t = ((latP - latA) * dLat + (lngP - lngA) * dLng) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const latC = latA + t * dLat;
  const lngC = lngA + t * dLng;
  return { t, dist: haversineMeters(latP, lngP, latC, lngC) };
}

export const signalController = new SimulatedSignalController();
