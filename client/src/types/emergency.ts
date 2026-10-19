// ── Enums ─────────────────────────────────────────────────────────────────────

export type EmergencyStatus =
  | "PENDING_APPROVALS"
  | "ACTIVE"
  | "ARRIVED"
  | "CLOSED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "TIMED_OUT";
export type Severity = "CRITICAL" | "SERIOUS" | "STABLE";

// ── Core entities ─────────────────────────────────────────────────────────────

export interface Hospital {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  specialties: string[];
  totalEmergencyBeds: number;
  availableBeds: number;
}

export interface HospitalCandidate extends Hospital {
  etaSeconds: number;
  distanceMeters: number;
}

export interface Emergency {
  id: string;
  driverId: string;
  status: EmergencyStatus;
  severity: Severity;
  originLat: number;
  originLng: number;
  photoPath: string | null;
  note: string | null;
  selectedHospitalId: string | null;
  selectedHospital?: Hospital | null;
  hospitalAttempt: number;
  policeStatus: ApprovalStatus;
  hospitalStatus: ApprovalStatus;
  policeDeadline: string | null;
  hospitalDeadline: string | null;
  policeEscalated: boolean;
  routeGeoJson: unknown | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  idempotencyKey: string;
  createdAt: string;
  closedAt: string | null;
  driver?: {
    id: string;
    name: string;
    ambulanceNo: string | null;
  };
}

export interface PoliceQueueItem extends Emergency {
  driver: {
    id: string;
    name: string;
    ambulanceNo: string | null;
  };
}

export interface DriverUser {
  id: string;
  name: string;
  username: string;
  ambulanceNo: string | null;
  active: boolean;
  createdAt: string;
}

// ── Socket event payloads ─────────────────────────────────────────────────────

export interface EmergencyUpdatedPayload {
  emergencyId: string;
  status?: EmergencyStatus;
  policeStatus?: ApprovalStatus;
  hospitalStatus?: ApprovalStatus;
  selectedHospitalId?: string;
  etaSeconds?: number | null;
}
