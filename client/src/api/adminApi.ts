/**
 * /api/adminApi.ts — ADMIN-only API calls for hospital management.
 */

import { api } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HospitalAdminUser {
  id: string;
  name: string;
  username: string;
  active: boolean;
  createdAt?: string;
}

export interface AdminHospital {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  specialties: string[];
  totalEmergencyBeds: number;
  availableBeds: number;
  onboarded: boolean;
  active: boolean;
  mode: string;          // "LIVE" | "DEMO_AUTO"
  osmId: string | null;
  createdAt: string;
  users: HospitalAdminUser[];
}

export interface OsmCandidate {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  alreadyImported: boolean;
  onboarded: boolean;
  hospitalId: string | null;
}

export interface OnboardPayload {
  name: string;
  lat: number;
  lng: number;
  totalEmergencyBeds: number;
  specialties: string[];
  mode: "LIVE" | "DEMO_AUTO";
  osmId?: string;
  adminUsername?: string;
  adminName?: string;
  adminPassword?: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function listHospitals(): Promise<AdminHospital[]> {
  const { data } = await api.get<{ hospitals: AdminHospital[] }>("/admin/hospitals");
  return data.hospitals;
}

export async function fetchOsmHospitals(): Promise<{
  candidates: OsmCandidate[];
  center: { lat: number; lng: number };
  radiusKm: number;
}> {
  const { data } = await api.get("/admin/hospitals/osm");
  return data as { candidates: OsmCandidate[]; center: { lat: number; lng: number }; radiusKm: number };
}

export async function onboardHospital(payload: OnboardPayload): Promise<{
  hospital: AdminHospital;
  admin: { username: string; password: string } | null;
}> {
  const { data } = await api.post("/admin/hospitals", payload);
  return data as { hospital: AdminHospital; admin: { username: string; password: string } | null };
}

export async function updateHospital(id: string, data: Partial<Pick<AdminHospital, "active" | "mode" | "totalEmergencyBeds" | "specialties">>): Promise<AdminHospital> {
  const res = await api.patch<{ hospital: AdminHospital }>(`/admin/hospitals/${id}`, data);
  return res.data.hospital;
}

export async function addHospitalAccount(hospitalId: string, payload: {
  name: string; username: string; password: string;
}): Promise<{ user: HospitalAdminUser; password: string }> {
  const { data } = await api.post(`/admin/hospitals/${hospitalId}/accounts`, payload);
  return data as { user: HospitalAdminUser; password: string };
}

export async function resetHospitalPassword(hospitalId: string, userId: string, password: string): Promise<{ ok: boolean; password: string }> {
  const { data } = await api.post(`/admin/hospitals/${hospitalId}/accounts/${userId}/reset-password`, { password });
  return data as { ok: boolean; password: string };
}

export async function toggleHospitalAccount(hospitalId: string, userId: string, active: boolean): Promise<HospitalAdminUser> {
  const { data } = await api.patch<{ user: HospitalAdminUser }>(`/admin/hospitals/${hospitalId}/accounts/${userId}`, { active });
  return data.user;
}
