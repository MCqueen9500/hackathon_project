/**
 * EmergencyError — typed domain errors for the EmergencyService state machine.
 * All invalid transitions, ownership violations, and concurrency failures throw this.
 */
export class EmergencyError extends Error {
  constructor(
    public readonly code: EmergencyErrorCode,
    message: string,
    public readonly meta?: unknown
  ) {
    super(message);
    this.name = "EmergencyError";
  }
}

export type EmergencyErrorCode =
  | "EMERGENCY_NOT_FOUND"
  | "DUPLICATE_IDEMPOTENCY_KEY"
  | "INVALID_TRANSITION"      // wrong status / approval state for requested action
  | "WRONG_HOSPITAL"          // approving hospital !== selectedHospitalId
  | "NO_BEDS_AVAILABLE"       // concurrent last-bed contention lost
  | "NO_HOSPITALS_FOUND";     // create: no hospitals with available beds near origin
