/**
 * ActiveEmergency — live status timeline + map placeholder.
 * Shows police/hospital approval status, ETA, cancel and arrived buttons.
 */

import type { Emergency } from "../../types/emergency";
import { MapLibreMap } from "../../components/MapLibreMap";


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
  const isFinal = ["CLOSED","CANCELLED","REJECTED","EXPIRED"].includes(em.status);
  const canArrive = em.status === "ACTIVE";
  const canCancel = !isFinal && em.status !== "ARRIVED";

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

      {/* Map — route + ambulance marker */}
      {em.originLat && em.originLng ? (
        <MapLibreMap
          key={`${em.id}-${em.selectedHospitalId}`}
          originLat={em.originLat}
          originLng={em.originLng}
          destLat={em.selectedHospital?.lat}
          destLng={em.selectedHospital?.lng}
          routeGeoJson={em.routeGeoJson}
          ambulanceMarker
          className="h-52 w-full border border-gray-800"
        />
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl h-52 flex items-center justify-center">
          <div className="text-center text-gray-600">
            <p className="text-3xl mb-2">🗺️</p>
            <p className="text-sm">Waiting for location…</p>
          </div>
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
              em.status === "ACTIVE" || em.status === "ARRIVED" || em.status === "CLOSED" ? "🟢" : "⚫"
            }</span>
            <div>
              <p className="text-sm font-semibold text-white">Green Corridor</p>
              <p className="text-xs text-gray-400">{
                em.status === "ACTIVE" ? "Active — signals ahead are green" :
                em.status === "ARRIVED" || em.status === "CLOSED" ? "Completed" :
                "Inactive"
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
