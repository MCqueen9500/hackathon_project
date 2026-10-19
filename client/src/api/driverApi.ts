import { api } from "../lib/api";
import type { Emergency, HospitalCandidate, Severity } from "../types/emergency";

// ── Candidates ────────────────────────────────────────────────────────────────

export async function getCandidates(
  lat: number,
  lng: number,
  severity: Severity
): Promise<HospitalCandidate[]> {
  const { data } = await api.get<{ candidates: HospitalCandidate[] }>(
    "/hospitals/candidates",
    { params: { lat, lng, severity } }
  );
  return data.candidates;        // ← unwrap { candidates: [...] }
}

// ── Create emergency (multipart) ──────────────────────────────────────────────

export async function createEmergency(opts: {
  photo: File;
  severity: Severity;
  lat: number;
  lng: number;
  note: string;
  selectedHospitalId: string;
  idempotencyKey: string;
}): Promise<Emergency> {
  const fd = new FormData();
  fd.append("photo",             opts.photo);
  fd.append("severity",          opts.severity);
  fd.append("originLat",         String(opts.lat));
  fd.append("originLng",         String(opts.lng));
  fd.append("note",              opts.note);
  fd.append("selectedHospitalId", opts.selectedHospitalId);

  const { data } = await api.post<{ emergency: Emergency }>("/emergencies", fd, {
    headers: {
      "Content-Type":    "multipart/form-data",
      "Idempotency-Key": opts.idempotencyKey,
    },
  });
  return data.emergency;         // ← unwrap { emergency: {...} }
}

// ── Get active emergency ──────────────────────────────────────────────────────

export async function getActiveEmergency(): Promise<Emergency | null> {
  try {
    const { data } = await api.get<{ emergency: Emergency }>("/emergencies/active");
    return data.emergency;       // ← unwrap { emergency: {...} }
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}

// ── Get single emergency ──────────────────────────────────────────────────────

export async function getEmergency(id: string): Promise<Emergency> {
  const { data } = await api.get<{ emergency: Emergency }>(`/emergencies/${id}`);
  return data.emergency;         // ← unwrap { emergency: {...} }
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function cancelEmergency(id: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(`/emergencies/${id}/cancel`);
  return data.emergency;         // ← unwrap { emergency: {...} }
}

export async function markArrived(id: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(`/emergencies/${id}/arrived`);
  return data.emergency;         // ← unwrap { emergency: {...} }
}

export async function sendLocation(
  id: string,
  lat: number,
  lng: number
): Promise<void> {
  await api.post(`/emergencies/${id}/location`, { lat, lng, source: "GPS" });
}
