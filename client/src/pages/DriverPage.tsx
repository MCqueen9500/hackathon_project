/**
 * /driver — Mobile-first driver dashboard shell.
 * Feature screens are added in later phases.
 */

import { AppShell } from "../components/AppShell";
import { useSocket } from "../hooks/useSocket";
import { useEffect } from "react";

export default function DriverPage() {
  const { connected, refetchCount } = useSocket();

  // On reconnect: refetch state over REST (spec §9)
  useEffect(() => {
    if (refetchCount > 0) {
      // TODO Phase 4: refetch active emergency state
      console.log("[driver] Socket reconnected — refetching state");
    }
  }, [refetchCount]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">

        {/* ── Status bar ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-egc-green-500 animate-pulse" : "bg-gray-600"}`}
          />
          <span className="text-xs text-gray-500">
            {connected ? "Live updates active" : "Connecting…"}
          </span>
        </div>

        {/* ── Hero card ──────────────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center shadow-xl">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-egc-green-900/50 border-2 border-egc-green-700 mb-4">
            <span className="text-4xl" aria-hidden>🚑</span>
          </div>
          <h1 className="text-xl font-bold text-white mb-1">Driver Dashboard</h1>
          <p className="text-gray-400 text-sm">No active emergency</p>
        </div>

        {/* ── Report accident CTA ─────────────────────────────────────── */}
        <button
          id="driver-report-btn"
          disabled
          className="w-full bg-egc-green-600 opacity-60 cursor-not-allowed text-white font-bold py-4 rounded-2xl text-lg flex items-center justify-center gap-3 shadow-lg shadow-egc-green-900/30"
        >
          <span aria-hidden>📸</span>
          Report Accident
        </button>
        <p className="text-center text-xs text-gray-600">
          Feature screens coming in Phase 4
        </p>

        {/* ── Quick stats ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Status",    value: "Available",    icon: "✅" },
            { label: "Emergency", value: "None active",  icon: "🔕" },
          ].map(({ label, value, icon }) => (
            <div
              key={label}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-1"
            >
              <span className="text-lg">{icon}</span>
              <span className="text-xs text-gray-500">{label}</span>
              <span className="text-sm font-semibold text-white">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
