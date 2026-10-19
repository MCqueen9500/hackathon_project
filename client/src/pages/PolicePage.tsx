/**
 * Police dashboard — live queue + detail view.
 * Socket drives real-time queue updates.
 */

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "../components/AppShell";
import { useSocket } from "../hooks/useSocket";
import { getPoliceQueue, policeVerify, policeReject } from "../api/policeApi";
import type { PoliceQueueItem } from "../types/emergency";
import { QueueList } from "./police/QueueList";
import { EmergencyDetail } from "./police/EmergencyDetail";

export default function PolicePage() {
  const { socket, refetchCount } = useSocket();

  const [queue,    setQueue]    = useState<PoliceQueueItem[]>([]);
  const [selected, setSelected] = useState<PoliceQueueItem | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [loading,  setLoading]  = useState(true);

  const fetchQueue = useCallback(async () => {
    try {
      const q = await getPoliceQueue();
      setQueue(q);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);
  useEffect(() => { if (refetchCount > 0) fetchQueue(); }, [refetchCount, fetchQueue]);

  // Socket: refresh queue on any emergency event
  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchQueue();
    socket.on("emergency:created",  refresh);
    socket.on("emergency:updated",  refresh);
    socket.on("approval:timeout",   refresh);
    return () => {
      socket.off("emergency:created",  refresh);
      socket.off("emergency:updated",  refresh);
      socket.off("approval:timeout",   refresh);
    };
  }, [socket, fetchQueue]);

  const handleVerify = async (id: string) => {
    setBusy(true);
    try {
      await policeVerify(id);
      await fetchQueue();
      setSelected(null);
    } finally { setBusy(false); }
  };

  const handleReject = async (id: string) => {
    setBusy(true);
    try {
      await policeReject(id);
      await fetchQueue();
      setSelected(null);
    } finally { setBusy(false); }
  };

  return (
    <AppShell>
      {selected ? (
        <EmergencyDetail
          emergency={selected}
          busy={busy}
          onVerify={() => handleVerify(selected.id)}
          onReject={() => handleReject(selected.id)}
          onBack={() => setSelected(null)}
        />
      ) : (
        <QueueList
          queue={queue}
          loading={loading}
          onSelect={setSelected}
        />
      )}
    </AppShell>
  );
}
