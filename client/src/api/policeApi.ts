import { api } from "../lib/api";
import type { PoliceQueueItem, Emergency } from "../types/emergency";

export async function getPoliceQueue(): Promise<{ queue: PoliceQueueItem[]; live: PoliceQueueItem[] }> {
  const { data } = await api.get<{ queue: PoliceQueueItem[]; live?: PoliceQueueItem[] }>("/police/queue");
  return { queue: data.queue, live: data.live ?? [] };
}

export async function policeVerify(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(
    `/police/emergencies/${emergencyId}/verify`
  );
  return data.emergency;
}

export async function policeReject(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(
    `/police/emergencies/${emergencyId}/reject`
  );
  return data.emergency;
}

export interface ClosureRecord {
  id: string;
  polygonGeoJson: string;
  createdAt: string;
  active: boolean;
}

export async function getClosures(): Promise<ClosureRecord[]> {
  const { data } = await api.get<{ closures: ClosureRecord[] }>("/police/closures");
  return data.closures;
}

export async function createClosure(polygonGeoJson: string): Promise<ClosureRecord> {
  const { data } = await api.post<{ closure: ClosureRecord }>("/police/closures", { polygonGeoJson });
  return data.closure;
}

export async function deleteClosure(id: string): Promise<void> {
  await api.delete(`/police/closures/${id}`);
}
