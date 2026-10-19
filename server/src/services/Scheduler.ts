/**
 * DB-polling scheduler — STUB for Phase 0
 *
 * In Phase 1 this will poll deadline columns every SCHEDULER_POLL_INTERVAL_MS
 * and trigger EmergencyService transitions for timed-out approvals and expired
 * bed holds. Uses DB deadlines, not in-memory setTimeout, so restarts are safe.
 */
export class Scheduler {
  start() {
    // no-op stub — wired in Phase 1
  }

  stop() {
    // no-op stub
  }
}
