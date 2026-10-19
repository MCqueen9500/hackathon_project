import { api } from "../lib/api";
import type { PoliceQueueItem, Emergency } from "../types/emergency";

export async function getPoliceQueue(): Promise<PoliceQueueItem[]> {
  const { data } = await api.get<PoliceQueueItem[]>("/police/queue");
  return data;
}

export async function policeVerify(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<Emergency>(`/police/emergencies/${emergencyId}/verify`);
  return data;
}

export async function policeReject(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<Emergency>(`/police/emergencies/${emergencyId}/reject`);
  return data;
}
