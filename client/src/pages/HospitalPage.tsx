/**
 * Hospital dashboard — tabs: Incoming | Arrivals | Drivers
 * Socket drives live updates to incoming list.
 */

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "../components/AppShell";
import { useSocket } from "../hooks/useSocket";
import { useAuth } from "../contexts/AuthContext";
import {
  getIncoming, hospitalApprove, hospitalReject, confirmHandover,
  updateBeds, getDrivers, registerDriver, deactivateDriver, reactivateDriver,
} from "../api/hospitalApi";
import type { Emergency, DriverUser } from "../types/emergency";
import { IncomingList } from "./hospital/IncomingList";
import { DriverManager } from "./hospital/DriverManager";
import { BedCounter } from "./hospital/BedCounter";

type Tab = "INCOMING" | "ARRIVALS" | "DRIVERS";

export default function HospitalPage() {
  const { socket, refetchCount } = useSocket();
  const { user } = useAuth();

  const [tab,       setTab]       = useState<Tab>("INCOMING");
  const [incoming,  setIncoming]  = useState<Emergency[]>([]);
  const [arrivals,  setArrivals]  = useState<Emergency[]>([]);
  const [drivers,   setDrivers]   = useState<DriverUser[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [busy,      setBusy]      = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const all = await getIncoming();
      setIncoming(all.filter((e: Emergency) => ["PENDING_APPROVALS"].includes(e.status)));
      setArrivals(all.filter((e: Emergency) => e.status === "ARRIVED"));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchDrivers = useCallback(async () => {
    try { setDrivers(await getDrivers()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchAll(); fetchDrivers(); }, [fetchAll, fetchDrivers]);
  useEffect(() => { if (refetchCount > 0) { fetchAll(); fetchDrivers(); } }, [refetchCount, fetchAll, fetchDrivers]);

  // Socket: listen for emergency updates in hospital room
  useEffect(() => {
    if (!socket || !user?.hospitalId) return;
    socket.emit("join", { room: `hospital:${user.hospitalId}` });

    const refresh = () => fetchAll();
    socket.on("emergency:created", refresh);
    socket.on("emergency:updated", refresh);
    socket.on("approval:timeout",  refresh);
    return () => {
      socket.off("emergency:created", refresh);
      socket.off("emergency:updated", refresh);
      socket.off("approval:timeout",  refresh);
    };
  }, [socket, user?.hospitalId, fetchAll]);

  const handleApprove = async (id: string) => {
    setBusy(true);
    try { await hospitalApprove(id); await fetchAll(); } finally { setBusy(false); }
  };

  const handleReject = async (id: string) => {
    setBusy(true);
    try { await hospitalReject(id); await fetchAll(); } finally { setBusy(false); }
  };

  const handleHandover = async (id: string) => {
    setBusy(true);
    try { await confirmHandover(id); await fetchAll(); } finally { setBusy(false); }
  };

  const handleUpdateBeds = async (n: number) => {
    await updateBeds(n);
  };

  const handleRegisterDriver = async (opts: {
    name: string; username: string; password: string; ambulanceNo: string;
  }) => {
    await registerDriver(opts);
    await fetchDrivers();
  };

  const handleToggleDriver = async (id: string, active: boolean) => {
    if (active) await reactivateDriver(id);
    else        await deactivateDriver(id);
    await fetchDrivers();
  };

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: "INCOMING", label: "Incoming", count: incoming.length },
    { key: "ARRIVALS", label: "Arrivals", count: arrivals.length },
    { key: "DRIVERS",  label: "Drivers",  count: drivers.length  },
  ];

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                tab === key
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
              {count !== undefined && count > 0 && (
                <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                  tab === key ? "bg-egc-green-600 text-white" : "bg-gray-700 text-gray-400"
                }`}>{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Bed counter — always visible */}
        <BedCounter onUpdate={handleUpdateBeds} />

        {/* Tab content */}
        {tab === "INCOMING" && (
          <IncomingList
            items={incoming}
            loading={loading}
            busy={busy}
            mode="incoming"
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}
        {tab === "ARRIVALS" && (
          <IncomingList
            items={arrivals}
            loading={loading}
            busy={busy}
            mode="arrivals"
            onHandover={handleHandover}
          />
        )}
        {tab === "DRIVERS" && (
          <DriverManager
            drivers={drivers}
            onRegister={handleRegisterDriver}
            onToggle={handleToggleDriver}
          />
        )}
      </div>
    </AppShell>
  );
}
