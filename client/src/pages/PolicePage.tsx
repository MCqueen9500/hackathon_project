/**
 * Police dashboard — live queue + detail view + road closures tab.
 * Socket drives real-time queue updates.
 */

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "../components/AppShell";
import { useSocket } from "../hooks/useSocket";
import { getPoliceQueue, policeVerify, policeReject } from "../api/policeApi";
import type { PoliceQueueItem } from "../types/emergency";
import { QueueList } from "./police/QueueList";
import { EmergencyDetail } from "./police/EmergencyDetail";
import { ClosureMap } from "./police/ClosureMap";
import { LiveAmbulanceList } from "../components/LiveAmbulanceList";

type Tab = "queue" | "live" | "closures";

export default function PolicePage() {
  const { socket, refetchCount } = useSocket();

  const [tab,      setTab]      = useState<Tab>("queue");
  const [queue,    setQueue]    = useState<PoliceQueueItem[]>([]);
  const [live,     setLive]     = useState<PoliceQueueItem[]>([]);
  const [selected, setSelected] = useState<PoliceQueueItem | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [loading,  setLoading]  = useState(true);

  const fetchQueue = useCallback(async () => {
    try {
      const data = await getPoliceQueue();
      setQueue(data.queue);
      setLive(data.live);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);
  useEffect(() => { if (refetchCount > 0) fetchQueue(); }, [refetchCount, fetchQueue]);

  // Socket: refresh queue on any emergency event or closure change
  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchQueue();
    socket.on("emergency:created",  refresh);
    socket.on("emergency:updated",  refresh);
    socket.on("approval:timeout",   refresh);
    socket.on("closure:updated",    refresh);
    return () => {
      socket.off("emergency:created",  refresh);
      socket.off("emergency:updated",  refresh);
      socket.off("approval:timeout",   refresh);
      socket.off("closure:updated",    refresh);
    };
  }, [socket, fetchQueue]);

  // Listen for route:updated so the selected emergency detail refreshes
  useEffect(() => {
    if (!socket) return;
    const onRouteUpdated = () => {
      // Refetch the queue so the updated emergency appears fresh
      void fetchQueue();
    };
    socket.on("route:updated", onRouteUpdated);
    return () => { socket.off("route:updated", onRouteUpdated); };
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
      {/* Tab bar */}
      {!selected && (
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-2xl p-1 mb-5">
          <TabBtn id="tab-queue"    active={tab === "queue"}    onClick={() => setTab("queue")}>
            🚔 Queue {queue.length > 0 && (
              <span className="ml-1.5 bg-egc-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {queue.length}
              </span>
            )}
          </TabBtn>
          <TabBtn id="tab-live" active={tab === "live"} onClick={() => setTab("live")}>
            🚑 Live {live.length > 0 && (
              <span className="ml-1.5 bg-egc-green-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {live.length}
              </span>
            )}
          </TabBtn>
          <TabBtn id="tab-closures" active={tab === "closures"} onClick={() => setTab("closures")}>
            🚧 Closures
          </TabBtn>
        </div>
      )}

      {tab === "queue" && (
        selected ? (
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
        )
      )}

      {tab === "live" && (
        <LiveAmbulanceList
          items={live}
          loading={loading}
          emptyTitle="No live ambulances"
        />
      )}

      {tab === "closures" && (
        <ClosureMap onClosureChange={fetchQueue} />
      )}
    </AppShell>
  );
}

function TabBtn({
  id, active, onClick, children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold py-2.5 rounded-xl transition-all ${
        active
          ? "bg-gray-700 text-white shadow-sm"
          : "text-gray-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
