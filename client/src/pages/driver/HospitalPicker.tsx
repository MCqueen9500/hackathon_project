/**
 * HospitalPicker — shows ranked candidate hospitals with ETA, distance, beds.
 * Creates the emergency on selection.
 */

import { useState } from "react";
import { createEmergency } from "../../api/driverApi";
import type { HospitalCandidate, Emergency, Severity } from "../../types/emergency";

interface ReportData {
  photo: File;
  severity: Severity;
  note: string;
  lat: number;
  lng: number;
}

interface Props {
  candidates: HospitalCandidate[];
  reportData: ReportData;
  onBack: () => void;
  onCreated: (em: Emergency) => void;
}

function formatEta(seconds: number) {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatDist(metres: number) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

export function HospitalPicker({ candidates, reportData, onBack, onCreated }: Props) {
  const [selected, setSelected]   = useState<string | null>(
    candidates.length > 0 ? candidates[0].id : null
  );
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());

  const handleSubmit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const em = await createEmergency({
        photo: reportData.photo,
        severity: reportData.severity,
        lat: reportData.lat,
        lng: reportData.lng,
        note: reportData.note,
        selectedHospitalId: selected,
        idempotencyKey: idemKey,
      });
      onCreated(em);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "Failed to create emergency. Please try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-1 transition-colors">
          ← Back
        </button>
        <h1 className="text-lg font-bold text-white">Choose Hospital</h1>
      </div>

      {error && (
        <div role="alert" className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <p className="text-4xl mb-3">🏥</p>
          <p className="text-white font-semibold">No hospitals with available beds</p>
          <p className="text-gray-500 text-sm mt-1">Try again in a moment or change severity</p>
        </div>
      ) : (
        <>
          {/* Nearest suitable shortcut */}
          <button
            onClick={() => setSelected(candidates[0].id)}
            className={`flex items-center gap-3 bg-egc-green-900/30 border-2 rounded-xl px-4 py-3 transition-all ${
              selected === candidates[0].id ? "border-egc-green-500" : "border-egc-green-800 hover:border-egc-green-600"
            }`}
          >
            <span className="text-xl">⚡</span>
            <div className="text-left">
              <p className="text-sm font-bold text-egc-green-400">Nearest Suitable</p>
              <p className="text-xs text-gray-400">{candidates[0].name}</p>
            </div>
            <span className="ml-auto text-egc-green-400 font-bold text-sm">{formatEta(candidates[0].etaSeconds)}</span>
          </button>

          {/* Hospital cards */}
          <div className="flex flex-col gap-3">
            {candidates.map((h, i) => (
              <button
                key={h.id}
                onClick={() => setSelected(h.id)}
                className={`text-left bg-gray-900 border-2 rounded-2xl p-4 transition-all ${
                  selected === h.id
                    ? "border-egc-green-500 shadow-lg shadow-egc-green-900/20"
                    : "border-gray-700 hover:border-gray-600"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className="text-xs text-gray-500 font-mono">#{i + 1}</span>
                    <h3 className="text-white font-semibold text-sm">{h.name}</h3>
                  </div>
                  {selected === h.id && (
                    <span className="text-egc-green-500 text-lg">✓</span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-800 rounded-lg px-2 py-1.5">
                    <p className="text-xs text-gray-500">ETA</p>
                    <p className="text-sm font-bold text-white">{formatEta(h.etaSeconds)}</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg px-2 py-1.5">
                    <p className="text-xs text-gray-500">Distance</p>
                    <p className="text-sm font-bold text-white">{formatDist(h.distanceMeters)}</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg px-2 py-1.5">
                    <p className="text-xs text-gray-500">Beds</p>
                    <p className={`text-sm font-bold ${h.availableBeds > 2 ? "text-egc-green-400" : "text-amber-400"}`}>
                      {h.availableBeds}
                    </p>
                  </div>
                </div>

                {h.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {h.specialties.map((s) => (
                      <span key={s} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{s}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Confirm */}
          <button
            onClick={handleSubmit}
            disabled={busy || !selected}
            className="w-full bg-egc-red-600 hover:bg-egc-red-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-base flex items-center justify-center gap-2 transition-colors shadow-lg shadow-red-900/30"
          >
            {busy
              ? <><span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> Submitting…</>
              : "🚨 Submit Emergency Report"}
          </button>
        </>
      )}
    </div>
  );
}
