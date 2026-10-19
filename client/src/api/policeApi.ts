import { api } from "../lib/api";
import type { PoliceQueueItem, Emergency } from "../types/emergency";

export async function getPoliceQueue(): Promise<PoliceQueueItem[]> {
  const { data } = await api.get<{ queue: PoliceQueueItem[] }>("/police/queue");
  return data.queue;             // ← unwrap { queue: [...] }
}

export async function policeVerify(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(
    `/police/emergencies/${emergencyId}/verify`
  );
  return data.emergency;         // ← unwrap { emergency: {...} }
}

export async function policeReject(emergencyId: string): Promise<Emergency> {
  const { data } = await api.post<{ emergency: Emergency }>(
    `/police/emergencies/${emergencyId}/reject`
  );
  return data.emergency;
}
