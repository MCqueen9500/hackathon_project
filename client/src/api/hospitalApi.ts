import { api } from "../lib/api";
import type { Emergency, DriverUser } from "../types/emergency";

// ── Incoming emergencies ──────────────────────────────────────────────────────

export async function getIncoming(): Promise<Emergency[]> {
  const { data } = await api.get<{ incoming: Emergency[] }>("/hospital/incoming");
  return data.incoming;          // ← unwrap { incoming: [...] }
}

export async function hospitalApprove(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(
    `/hospital/emergencies/${emergencyId}/approve`
  );
  return data.emergency;         // ← unwrap { emergency: {...} }
}

export async function hospitalReject(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(
    `/hospital/emergencies/${emergencyId}/reject`
  );
  return data.emergency;
}

export async function confirmHandover(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(
    `/hospital/emergencies/${emergencyId}/confirm-handover`
  );
  return data.emergency;
}

// ── Beds ──────────────────────────────────────────────────────────────────────

export async function updateBeds(availableBeds: number): Promise<void> {
  await api.patch("/hospital/beds", { availableBeds });
}

// ── Drivers ───────────────────────────────────────────────────────────────────

export async function getDrivers(): Promise<DriverUser[]> {
  const { data } = await api.get<DriverUser[]>("/hospital/drivers");
  return data;                   // bare array (no wrapper key)
}

export async function registerDriver(opts: {
  name: string;
  username: string;
  password: string;
  ambulanceNo: string;
}): Promise<DriverUser> {
  const { data } = await api.post<DriverUser>("/hospital/drivers", opts);
  return data;                   // bare object (no wrapper key)
}

export async function deactivateDriver(driverId: string): Promise<void> {
  await api.patch(`/hospital/drivers/${driverId}`, { active: false });
}

export async function reactivateDriver(driverId: string): Promise<void> {
  await api.patch(`/hospital/drivers/${driverId}`, { active: true });
}
