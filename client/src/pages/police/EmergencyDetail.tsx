/**
 * EmergencyDetail — police detail view with photo, driver info, Verify/Reject.
 */

import type { PoliceQueueItem } from "../../types/emergency";
import { MapLibreMap } from "../../components/MapLibreMap";


interface Props {
  emergency: PoliceQueueItem;
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
  onBack: () => void;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "bg-egc-red-500",
  SERIOUS:  "bg-amber-500",
  STABLE:   "bg-egc-green-500",
};

export function EmergencyDetail({ emergency: em, busy, onVerify, onReject, onBack }: Props) {
  const photoUrl = em.photoPath
    ? `/api/uploads/${em.photoPath.split("/").pop()}`
    : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-1 transition-colors">
          ← Queue
        </button>
        <h1 className="text-lg font-bold text-white">Emergency Detail</h1>
        {em.policeEscalated && (
          <span className="ml-auto text-xs bg-red-950 border border-egc-red-800 text-egc-red-400 px-2 py-1 rounded-full">
            ⚠️ ESCALATED
          </span>
        )}
      </div>

      {/* Severity + time */}
      <div className={`rounded-2xl p-4 border-2 ${
        em.severity === "CRITICAL" ? "border-egc-red-600 bg-red-950/30" :
        em.severity === "SERIOUS"  ? "border-amber-600 bg-amber-950/20" :
                                     "border-egc-green-700 bg-egc-green-900/20"
      }`}>
        <div className="flex items-center gap-3">
          <span className={`w-4 h-4 rounded-full flex-shrink-0 ${SEV_COLOR[em.severity]}`} />
          <div>
            <p className="text-white font-bold text-lg">{em.severity}</p>
            <p className="text-xs text-gray-400">
              Reported {new Date(em.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
        </div>
      </div>

      {/* Scene photo */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <p className="text-xs text-gray-500 px-4 pt-4 pb-2 font-semibold">SCENE PHOTO</p>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt="Scene photo"
            className="w-full max-h-64 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-40 flex items-center justify-center text-gray-600">
            <p className="text-sm">No photo available</p>
          </div>
        )}
      </div>

      {/* Driver info */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <p className="text-xs text-gray-500 font-semibold mb-3">DRIVER INFO</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"       value={em.driver?.name ?? "—"} />
          <Field label="Ambulance"  value={em.driver?.ambulanceNo ?? "—"} />
          <Field label="Lat"        value={em.originLat.toFixed(5)} />
          <Field label="Lng"        value={em.originLng.toFixed(5)} />
        </div>
      </div>

      {/* Location map */}
      <MapLibreMap
        originLat={em.originLat}
        originLng={em.originLng}
        className="h-40 w-full border border-gray-800"
      />

      {/* Note */}
      {em.note && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-xs text-gray-500 font-semibold mb-2">NOTE</p>
          <p className="text-sm text-gray-300">{em.note}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          id="police-verify-btn"
          onClick={onVerify}
          disabled={busy}
          className="flex-1 bg-egc-green-600 hover:bg-egc-green-700 disabled:opacity-50 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors"
        >
          {busy ? <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> : "✓"} Verify
        </button>
        <button
          id="police-reject-btn"
          onClick={onReject}
          disabled={busy}
          className="flex-1 bg-red-950 hover:bg-red-900 border border-egc-red-700 disabled:opacity-50 text-egc-red-400 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors"
        >
          ✕ Reject
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-white font-semibold truncate">{value}</p>
    </div>
  );
}
