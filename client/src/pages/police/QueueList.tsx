/**
 * QueueList — police emergency queue with deadline countdowns.
 * Escalated items appear at top with a red badge.
 */

import { useState, useEffect } from "react";
import type { PoliceQueueItem } from "../../types/emergency";

interface Props {
  queue: PoliceQueueItem[];
  loading: boolean;
  onSelect: (em: PoliceQueueItem) => void;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "text-egc-red-500 bg-red-950/40 border-egc-red-800",
  SERIOUS:  "text-amber-400 bg-amber-950/40 border-amber-800",
  STABLE:   "text-egc-green-400 bg-egc-green-900/20 border-egc-green-900",
};

function Countdown({ deadline }: { deadline: string | null }) {
  const [secs, setSecs] = useState<number | null>(() =>
    deadline ? Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)) : null
  );

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => {
      const rem = Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000));
      setSecs(rem);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (secs === null) return null;
  const mins = Math.floor(secs / 60);
  const s    = secs % 60;
  return (
    <span className={`text-xs font-mono font-bold tabular-nums ${secs < 30 ? "text-egc-red-500 animate-pulse" : "text-amber-400"}`}>
      {mins}:{String(s).padStart(2, "0")}
    </span>
  );
}

export function QueueList({ queue, loading, onSelect }: Props) {
  const escalated = queue.filter((e) => e.policeEscalated);
  const normal    = queue.filter((e) => !e.policeEscalated);
  const sorted    = [...escalated, ...normal];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Verification Queue</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {queue.length} pending · {escalated.length} escalated
          </p>
        </div>
        <div className="flex gap-2">
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-center">
            <p className="text-xl font-bold text-white">{queue.length}</p>
            <p className="text-xs text-gray-500">Pending</p>
          </div>
          <div className="bg-gray-900 border border-egc-red-800 rounded-xl px-3 py-1.5 text-center">
            <p className="text-xl font-bold text-egc-red-500">{escalated.length}</p>
            <p className="text-xs text-gray-500">Escalated</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="animate-spin text-4xl">🚔</span>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-white font-semibold">All clear — no pending verifications</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((em) => (
            <button
              key={em.id}
              onClick={() => onSelect(em)}
              className="text-left bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-2xl p-4 transition-all group"
            >
              <div className="flex items-start gap-3">
                {/* Severity badge */}
                <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${SEV_COLOR[em.severity]} flex-shrink-0`}>
                  {em.severity.slice(0, 4)}
                </span>

                <div className="flex-1 min-w-0">
                  {/* Escalation badge */}
                  {em.policeEscalated && (
                    <span className="inline-block text-xs bg-red-950 border border-egc-red-800 text-egc-red-400 px-2 py-0.5 rounded-full mb-1">
                      ⚠️ ESCALATED
                    </span>
                  )}
                  <p className="text-white font-semibold text-sm truncate">
                    {em.driver?.name ?? "Unknown driver"} · {em.driver?.ambulanceNo ?? "—"}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(em.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    &nbsp;·&nbsp;
                    {em.originLat.toFixed(4)}, {em.originLng.toFixed(4)}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <Countdown deadline={em.policeDeadline} />
                  <span className="text-gray-600 group-hover:text-gray-400 transition-colors text-sm">→</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
