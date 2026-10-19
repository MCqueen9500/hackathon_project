/**
 * /police — Police dashboard shell.
 * Feature screens (queue, closures) are added in later phases.
 */

import { AppShell } from "../components/AppShell";
import { useSocket } from "../hooks/useSocket";
import { useEffect } from "react";

export default function PolicePage() {
  const { connected, refetchCount } = useSocket();

  useEffect(() => {
    if (refetchCount > 0) {
      console.log("[police] Socket reconnected — refetching queue");
    }
  }, [refetchCount]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">

        {/* ── Header row ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Police Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">Emergency verification queue</p>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-egc-green-500 animate-pulse" : "bg-gray-600"}`}
            title={connected ? "Live" : "Offline"}
          />
        </div>

        {/* ── Queue placeholder ───────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <span className="text-4xl mb-4 block" aria-hidden>🚔</span>
          <p className="text-white font-semibold">Verification Queue</p>
          <p className="text-gray-500 text-sm mt-1">No pending verifications</p>
        </div>

        {/* ── Stats ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Pending",   value: "0", color: "text-amber-400"      },
            { label: "Escalated", value: "0", color: "text-egc-red-500"    },
            { label: "Closures",  value: "0", color: "text-blue-400"       },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center"
            >
              <span className={`text-2xl font-bold ${color}`}>{value}</span>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Road closures placeholder ───────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <span className="text-4xl mb-4 block" aria-hidden>🚧</span>
          <p className="text-white font-semibold">Road Closures</p>
          <p className="text-gray-500 text-sm mt-1">No active closures — map tool coming in Phase 5</p>
        </div>
      </div>
    </AppShell>
  );
}
