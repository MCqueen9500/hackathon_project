import { api } from "../lib/api";
import type { Emergency, DriverUser } from "../types/emergency";

// ── Incoming emergencies ──────────────────────────────────────────────────────

export async function getIncoming(): Promise<Emergency[]> {
  const { data } = await api.get<Emergency[]>("/hospital/incoming");
  return data;
}

export async function hospitalApprove(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<Emergency>(`/hospital/emergencies/${emergencyId}/approve`);
  return data;
}

export async function hospitalReject(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<Emergency>(`/hospital/emergencies/${emergencyId}/reject`);
  return data;
}

export async function confirmHandover(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<Emergency>(`/hospital/emergencies/${emergencyId}/confirm-handover`);
  return data;
}

// ── Beds ──────────────────────────────────────────────────────────────────────

export async function updateBeds(availableBeds: number): Promise<void> {
  await api.patch("/hospital/beds", { availableBeds });
}

// ── Drivers ───────────────────────────────────────────────────────────────────

export async function getDrivers(): Promise<DriverUser[]> {
  const { data } = await api.get<DriverUser[]>("/hospital/drivers");
  return data;
}

export async function registerDriver(opts: {
  name: string;
  username: string;
  password: string;
  ambulanceNo: string;
}): Promise<DriverUser> {
  const { data } = await api.post<DriverUser>("/hospital/drivers", opts);
  return data;
}

export async function deactivateDriver(driverId: string): Promise<void> {
  await api.patch(`/hospital/drivers/${driverId}`, { active: false });
}

export async function reactivateDriver(driverId: string): Promise<void> {
  await api.patch(`/hospital/drivers/${driverId}`, { active: true });
}
