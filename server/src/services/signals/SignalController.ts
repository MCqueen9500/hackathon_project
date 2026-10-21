/**
 * SignalController interface (spec section 10).
 *
 * Abstracts "real hardware" vs simulated traffic signals.
 * Only SimulatedSignalController is implemented; real hardware is out of scope.
 *
 * Signal state machine: RED → GREEN → YELLOW → RED (normal cycle)
 * Corridor override: FORCED_GREEN (higher priority than normal cycle)
 */

export type SignalState = "RED" | "GREEN" | "YELLOW" | "FORCED_GREEN";

export interface SignalSnapshot {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  state: SignalState;
  simulated?: boolean;
}

/** Which active emergency is controlling a signal (for conflict resolution) */
export interface SignalClaim {
  emergencyId: string;
  severity: "CRITICAL" | "SERIOUS" | "STABLE";
  createdAt: Date;
}

export interface SignalController {
  /** Force a signal to FORCED_GREEN for a given emergency corridor. */
  forceGreen(signalId: string, claim: SignalClaim): void;

  /** Release a signal from an emergency's corridor (restore normal cycle). */
  release(signalId: string, emergencyId: string): void;

  /** Release ALL signals controlled by an emergency (on cancel/close/arrive). */
  releaseAll(emergencyId: string): void;

  /** Get the full current state of all known signals. */
  getAll(): SignalSnapshot[];

  /** Get signal IDs currently forced green for a given emergency. */
  getForEmergency(emergencyId: string): string[];
}
