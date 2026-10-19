/**
 * /hospital — Hospital admin dashboard shell.
 * Feature screens (incoming, bed management, drivers) are added in later phases.
 */

import { AppShell } from "../components/AppShell";
import { useSocket } from "../hooks/useSocket";
import { useAuth } from "../contexts/AuthContext";
import { useEffect } from "react";

export default function HospitalPage() {
  const { user }                    = useAuth();
  const { connected, refetchCount } = useSocket();

  useEffect(() => {
    if (refetchCount > 0) {
      console.log("[hospital] Socket reconnected — refetching incoming");
    }
  }, [refetchCount]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">

        {/* ── Header row ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Hospital Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {user?.hospitalId ? `Hospital ID: ${user.hospitalId}` : "Incoming emergency requests"}
            </p>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-egc-green-500 animate-pulse" : "bg-gray-600"}`}
            title={connected ? "Live" : "Offline"}
          />
        </div>

        {/* ── Stats ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Incoming",  value: "0", icon: "🚨", color: "text-egc-red-500"   },
            { label: "Available beds", value: "—", icon: "🛏️", color: "text-egc-green-500" },
            { label: "Arrivals",  value: "0", icon: "✅", color: "text-blue-400"      },
          ].map(({ label, value, icon, color }) => (
            <div
              key={label}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center"
            >
              <span className="text-xl block mb-1" aria-hidden>{icon}</span>
              <span className={`text-2xl font-bold ${color}`}>{value}</span>
              <p className="text-xs text-gray-500 mt-1 leading-tight">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Incoming queue placeholder ──────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <span className="text-4xl mb-4 block" aria-hidden>🏥</span>
          <p className="text-white font-semibold">Incoming Emergency Requests</p>
          <p className="text-gray-500 text-sm mt-1">No pending approvals</p>
        </div>

        {/* ── Driver management placeholder ───────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Driver Management</h2>
            <button
              id="hospital-add-driver-btn"
              disabled
              className="text-sm bg-egc-green-700 opacity-50 cursor-not-allowed text-white px-4 py-1.5 rounded-lg font-medium"
            >
              + Add Driver
            </button>
          </div>
          <p className="text-gray-500 text-sm">Driver management coming in Phase 4</p>
        </div>
      </div>
    </AppShell>
  );
}
