/**
 * ActiveEmergency — live status timeline + map with GPS/Simulator tracking.
 * Shows police/hospital approval status, ETA, cancel/arrived buttons,
 * Live GPS / Simulator toggle, Wake Lock, stale-location indicator, and
 * live signal colours on the map.
 */

import { useState, useEffect } from "react";
import type { Emergency } from "../../types/emergency";
import { MapLibreMap, type SignalSnapshot } from "../../components/MapLibreMap";
import { useLocationTracker } from "../../hooks/useLocationTracker";
import { api } from "../../lib/api";

interface Props {
  emergency: Emergency;
  onCancel: () => void;
  onArrived: () => void;
  busy: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVALS: "Awaiting Approvals",
  ACTIVE:            "Active — Route Confirmed",
  ARRIVED:           "Arrived at Hospital",
  CLOSED:            "Closed",
  CANCELLED:         "Cancelled",
  REJECTED:          "Rejected",
  EXPIRED:           "Expired — No hospital available",
};

const APPROVAL_ICON: Record<string, string> = {
  PENDING:   "⏳",
  APPROVED:  "✅",
  REJECTED:  "❌",
  TIMED_OUT: "⚠️",
};

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "bg-egc-red-500",
  SERIOUS:  "bg-amber-500",
  STABLE:   "bg-egc-green-500",
};

function formatEta(s: number | null) {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function ActiveEmergency({ emergency: em, onCancel, onArrived, busy }: Props) {
  const isFinal   = ["CLOSED","CANCELLED","REJECTED","EXPIRED"].includes(em.status);
  const canArrive = em.status === "ACTIVE";
  const canCancel = !isFinal && em.status !== "ARRIVED";
  const isActive  = em.status === "ACTIVE";

  // ── Signals state ────────────────────────────────────────────────────────
  const [signals, setSignals] = useState<SignalSnapshot[]>([]);

  // Fetch initial signal state
  useEffect(() => {
    api.get<{ signals: SignalSnapshot[] }>("/signals")
      .then((r) => setSignals(r.data.signals))
      .catch(() => {});
  }, []);

  // Listen for live signal updates via socket (socket events handled in parent
  // via useSocket hook; here we listen directly on the window)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ signals: SignalSnapshot[] }>).detail;
      if (detail?.signals) setSignals(detail.signals);
    };
    window.addEventListener("signals:updated", handler);
    return () => window.removeEventListener("signals:updated", handler);
  }, []);

  // ── Location tracker ─────────────────────────────────────────────────────
  const tracker = useLocationTracker({
    emergencyId: em.id,
    speedKmh: 40,
  });


  const handleTrackingToggle = async (mode: "GPS" | "SIMULATOR") => {
    if (tracker.mode === mode) {
      await tracker.stopTracking();
    } else {
      if (tracker.mode !== "OFF") await tracker.stopTracking();
      await tracker.startTracking(mode);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Status header */}
      <div className={`rounded-2xl p-5 border-2 ${
        em.status === "ACTIVE"  ? "border-egc-green-600 bg-egc-green-900/20" :
        em.status === "ARRIVED" ? "border-blue-600 bg-blue-900/20" :
        isFinal                 ? "border-gray-700 bg-gray-900" :
                                  "border-amber-700 bg-amber-900/10"
      }`}>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${SEV_COLOR[em.severity]}`} />
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider">{em.severity}</p>
            <p className="text-white font-bold">{STATUS_LABEL[em.status] ?? em.status}</p>
          </div>
          {em.etaSeconds && em.status === "ACTIVE" && (
            <div className="ml-auto text-right">
              <p className="text-xs text-gray-400">ETA</p>
              <p className="text-egc-green-400 font-bold text-lg">{formatEta(em.etaSeconds)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Map — route + ambulance + signals */}
      {em.originLat && em.originLng ? (
        <MapLibreMap
          key={`${em.id}-${em.selectedHospitalId}`}
          originLat={em.originLat}
          originLng={em.originLng}
          liveLat={tracker.lat}
          liveLng={tracker.lng}
          destLat={em.selectedHospital?.lat}
          destLng={em.selectedHospital?.lng}
          routeGeoJson={em.routeGeoJson}
          ambulanceMarker
          signals={signals}
          className="h-64 w-full border border-gray-800"
        />
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl h-52 flex items-center justify-center">
          <p className="text-gray-600 text-sm">🗺️ Waiting for location…</p>
        </div>
      )}

      {/* GPS / Simulator tracking controls */}
      {isActive && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Location Tracking</p>

          {/* Stale indicator */}
          {tracker.stale && (
            <div className="mb-3 flex items-center gap-2 bg-amber-950/60 border border-amber-800 rounded-xl px-3 py-2">
              <span className="text-amber-400 text-sm">⚠️</span>
              <p className="text-xs text-amber-300">
                Last location {tracker.staleSeconds}s ago — check signal
              </p>
            </div>
          )}

          {tracker.error && (
            <div className="mb-3 bg-red-950/60 border border-red-900 rounded-xl px-3 py-2">
              <p className="text-xs text-red-400">{tracker.error}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              id="driver-gps-btn"
              onClick={() => handleTrackingToggle("GPS")}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                tracker.mode === "GPS"
                  ? "bg-egc-green-700 border-2 border-egc-green-500 text-white"
                  : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <span>📡</span>
              {tracker.mode === "GPS" ? "GPS Live" : "Live GPS"}
            </button>
            <button
              id="driver-simulator-btn"
              onClick={() => handleTrackingToggle("SIMULATOR")}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                tracker.mode === "SIMULATOR"
                  ? "bg-blue-700 border-2 border-blue-500 text-white"
                  : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <span>🎮</span>
              {tracker.mode === "SIMULATOR" ? "Simulating…" : "Simulate"}
            </button>
          </div>

          {tracker.lat && (
            <p className="text-xs text-gray-600 mt-2 text-center">
              📍 {tracker.lat.toFixed(5)}, {tracker.lng?.toFixed(5)}
              {tracker.mode === "GPS" && " · GPS"}
              {tracker.mode === "SIMULATOR" && " · Simulated"}
            </p>
          )}
        </div>
      )}

      {/* Status timeline */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-sm font-semibold text-gray-300 mb-4">Approval Status</p>
        <div className="flex flex-col gap-3">

          <TimelineRow
            icon={APPROVAL_ICON[em.policeStatus]}
            label="Police Verification"
            status={em.policeStatus}
            escalated={em.policeEscalated}
            deadline={em.policeDeadline}
          />

          <TimelineRow
            icon={APPROVAL_ICON[em.hospitalStatus]}
            label="Hospital Approval"
            status={em.hospitalStatus}
            deadline={em.hospitalDeadline}
          />

          <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
            em.status === "ACTIVE" || em.status === "ARRIVED" || em.status === "CLOSED"
              ? "bg-egc-green-900/30 border border-egc-green-800"
              : "bg-gray-800"
          }`}>
            <span className="text-xl">{
              em.status === "ACTIVE" ? "🟢" :
              em.status === "ARRIVED" || em.status === "CLOSED" ? "✅" : "⚫"
            }</span>
            <div>
              <p className="text-sm font-semibold text-white">Green Corridor</p>
              <p className="text-xs text-gray-400">{
                em.status === "ACTIVE"
                  ? `Active — ${signals.filter(s => s.state === "FORCED_GREEN").length} signals forced green`
                  : em.status === "ARRIVED" || em.status === "CLOSED" ? "Completed"
                  : "Inactive"
              }</p>
            </div>
          </div>
        </div>
      </div>

      {/* Hospital info */}
      {em.selectedHospital && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Selected Hospital</p>
          <p className="text-white font-semibold">{em.selectedHospital.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{em.selectedHospital.city}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {canArrive && (
          <button
            id="driver-arrived-btn"
            onClick={onArrived}
            disabled={busy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors"
          >
            {busy ? <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> : "🏥"} Arrived
          </button>
        )}
        {canCancel && (
          <button
            id="driver-cancel-btn"
            onClick={onCancel}
            disabled={busy}
            className={`${canArrive ? "flex-1" : "w-full"} bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-50 text-gray-300 font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors`}
          >
            Cancel
          </button>
        )}
        {isFinal && (
          <div className="flex-1 bg-gray-900 border border-gray-700 rounded-2xl py-4 text-center text-gray-400 text-sm">
            Emergency {em.status.toLowerCase()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Timeline row ──────────────────────────────────────────────────────────────

function TimelineRow({
  icon, label, status, escalated, deadline,
}: {
  icon: string;
  label: string;
  status: string;
  escalated?: boolean;
  deadline?: string | null;
}) {
  const remaining = deadline ? Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)) : null;

  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
      status === "APPROVED" ? "bg-egc-green-900/30 border border-egc-green-800" :
      status === "REJECTED" ? "bg-red-950 border border-egc-red-800" :
      status === "TIMED_OUT" ? "bg-amber-950/50 border border-amber-800" :
      "bg-gray-800"
    }`}>
      <span className="text-xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{label}</p>
        <p className="text-xs text-gray-400 capitalize">{status.toLowerCase().replace("_", " ")}</p>
      </div>
      {escalated && (
        <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded-full">Escalated</span>
      )}
      {remaining !== null && status === "PENDING" && (
        <span className={`text-xs font-mono font-bold ${remaining < 30 ? "text-egc-red-500" : "text-gray-400"}`}>
          {remaining}s
        </span>
      )}
    </div>
  );
}
