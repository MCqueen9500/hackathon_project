/**
 * IncomingList — hospital incoming emergencies with Approve/Reject,
 * or arrivals awaiting handover with Confirm Handover.
 */

import { useState, useEffect } from "react";
import type { Emergency } from "../../types/emergency";
import { MapLibreMap } from "../../components/MapLibreMap";
import { useLiveAmbulances } from "../../hooks/useLiveAmbulances";
import { useSignals } from "../../hooks/useSignals";


interface Props {
  items: Emergency[];
  loading: boolean;
  busy: boolean;
  mode: "incoming" | "arrivals" | "enroute";
  onApprove?:  (id: string) => void;
  onReject?:   (id: string) => void;
  onHandover?: (id: string) => void;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "text-egc-red-500 border-egc-red-800 bg-red-950/40",
  SERIOUS:  "text-amber-400 border-amber-800 bg-amber-950/30",
  STABLE:   "text-egc-green-400 border-egc-green-800 bg-egc-green-900/20",
};

function EtaCountdown({ deadline }: { deadline: string | null }) {
  const [secs, setSecs] = useState<number | null>(() =>
    deadline ? Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)) : null
  );

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => {
      setSecs(Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (secs === null) return null;
  const m = Math.floor(secs / 60), s = secs % 60;
  return (
    <div className={`text-center ${secs < 30 ? "text-egc-red-500" : "text-amber-400"}`}>
      <p className="text-xs text-gray-500">Deadline</p>
      <p className={`text-lg font-mono font-bold tabular-nums ${secs < 30 ? "animate-pulse" : ""}`}>
        {m}:{String(s).padStart(2, "0")}
      </p>
    </div>
  );
}

export function IncomingList({
  items, loading, busy, mode, onApprove, onReject, onHandover,
}: Props) {
  const live = useLiveAmbulances();
  const signals = useSignals();
  const emptyMsg = mode === "incoming"
    ? { icon: "🏥", title: "No incoming requests", sub: "Emergency requests will appear here" }
    : mode === "enroute"
    ? { icon: "🚑", title: "No ambulances en route", sub: "Approved emergencies appear here with live GPS" }
    : { icon: "✅", title: "No pending handovers", sub: "Arrived ambulances will appear here" };

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="animate-spin text-4xl">🏥</span>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p className="text-4xl mb-3">{emptyMsg.icon}</p>
          <p className="text-white font-semibold">{emptyMsg.title}</p>
          <p className="text-gray-500 text-sm mt-1">{emptyMsg.sub}</p>
        </div>
      ) : (
        items.map((em) => (
          <div key={em.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            {/* Top row */}
            <div className="flex items-start gap-3 mb-4">
              <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${SEV_COLOR[em.severity]} flex-shrink-0`}>
                {em.severity}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm">
                  {em.driver?.name ?? "Driver"} · {em.driver?.ambulanceNo ?? "—"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(em.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  &nbsp;·&nbsp; {em.originLat.toFixed(4)}, {em.originLng.toFixed(4)}
                </p>
              </div>
              {mode === "incoming" && <EtaCountdown deadline={em.hospitalDeadline} />}
            </div>

            {/* Map: origin pin + live ambulance (phone GPS only) */}
            <div className="mb-4 rounded-xl overflow-hidden">
              <MapLibreMap
                key={`${em.id}-${em.selectedHospitalId}-${(em.routeGeoJson as { coordinates?: unknown[] } | null)?.coordinates?.length ?? 0}`}
                originLat={em.originLat}
                originLng={em.originLng}
                liveLat={live[em.id]?.lat ?? null}
                liveLng={live[em.id]?.lng ?? null}
                destLat={em.selectedHospital?.lat}
                destLng={em.selectedHospital?.lng}
                routeGeoJson={em.routeGeoJson}
                ambulanceMarker
                signals={signals}
                locationSource={live[em.id]?.source ?? null}
                stale={!!live[em.id]?.stale}
                staleSeconds={live[em.id]?.staleSeconds ?? 0}
                className="h-28 w-full"
              />
            </div>

            {/* Note */}
            {em.note && (
              <p className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2 mb-3">{em.note}</p>
            )}

            {/* Actions */}
            {mode === "incoming" && (
              <div className="flex gap-2">
                <button
                  id={`hospital-approve-${em.id}`}
                  onClick={() => onApprove?.(em.id)}
                  disabled={busy}
                  className="flex-1 bg-egc-green-600 hover:bg-egc-green-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  {busy ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : "✓"} Approve
                </button>
                <button
                  id={`hospital-reject-${em.id}`}
                  onClick={() => onReject?.(em.id)}
                  disabled={busy}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-50 text-gray-300 font-semibold py-3 rounded-xl transition-colors"
                >
                  ✕ Reject
                </button>
              </div>
            )}
            {mode === "arrivals" && (
              <button
                id={`hospital-handover-${em.id}`}
                onClick={() => onHandover?.(em.id)}
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                {busy ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : "🤝"} Confirm Handover
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
