/**
 * ReportForm — camera capture, severity, note, current location.
 * Origin is always this phone's GPS at report time (never a default/typed location).
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { getCandidates } from "../../api/driverApi";
import { GPS_MAX_ACCURACY_M } from "../../lib/config";
import type { HospitalCandidate, Severity } from "../../types/emergency";

interface ReportData {
  photo: File;
  severity: Severity;
  note: string;
  lat: number;
  lng: number;
}

interface Props {
  onBack: () => void;
  onNext: (data: ReportData, candidates: HospitalCandidate[]) => void;
}

const SEVERITIES: { value: Severity; label: string; color: string; desc: string }[] = [
  { value: "CRITICAL", label: "Critical", color: "border-egc-red-500 bg-red-950/40 text-egc-red-500",    desc: "Life-threatening" },
  { value: "SERIOUS",  label: "Serious",  color: "border-amber-500 bg-amber-950/40 text-amber-400",      desc: "Urgent, stable" },
  { value: "STABLE",   label: "Stable",   color: "border-egc-green-500 bg-egc-green-900/30 text-egc-green-400", desc: "Non-critical" },
];

export function ReportForm({ onBack, onNext }: Props) {
  const fileRef  = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [photo,    setPhoto]    = useState<File | null>(null);
  const [preview,  setPreview]  = useState<string | null>(null);
  const [severity, setSeverity] = useState<Severity>("SERIOUS");
  const [note,     setNote]     = useState("");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [locating, setLocating] = useState(true);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
    setError(null);
  };

  const stopWatch = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      setLocError("Geolocation is not available on this device.");
      setLocating(false);
      return;
    }
    setLocating(true);
    setLocError(null);
    stopWatch();

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (accuracy !== null && Number.isFinite(accuracy) && accuracy > GPS_MAX_ACCURACY_M) {
          setLocError(`Waiting for GPS (accuracy ${Math.round(accuracy)} m, need ≤ ${GPS_MAX_ACCURACY_M} m)…`);
          return;
        }
        setLocation({ lat: latitude, lng: longitude, accuracy: accuracy ?? null });
        setLocating(false);
        setLocError(null);
        stopWatch();
      },
      (err) => {
        setLocating(false);
        setLocation(null);
        if (err.code === err.PERMISSION_DENIED) {
          setLocError("Location permission denied — enable GPS on this phone to report.");
        } else {
          setLocError(`Could not get GPS: ${err.message}`);
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    getLocation();
    return () => stopWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    if (!photo)    { setError("Please capture or upload a photo."); return; }
    if (!location) { setError("Waiting for this phone's GPS — cannot use a default location."); return; }
    setBusy(true);
    setError(null);
    try {
      const cands = await getCandidates(location.lat, location.lng, severity);
      onNext({ photo, severity, note, lat: location.lat, lng: location.lng }, cands);
    } catch {
      setError("Failed to fetch hospital candidates. Please try again.");
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
        <h1 className="text-lg font-bold text-white">Report Accident</h1>
      </div>

      {error && (
        <div role="alert" className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Photo capture */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-sm font-semibold text-gray-300 mb-3">📷 Scene Photo <span className="text-egc-red-500">*</span></p>
        {preview ? (
          <div className="relative">
            <img src={preview} alt="Captured scene" className="w-full h-48 object-cover rounded-xl" />
            <button
              onClick={() => { setPhoto(null); setPreview(null); }}
              className="absolute top-2 right-2 bg-gray-900/80 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm hover:bg-gray-800"
            >✕</button>
          </div>
        ) : (
          <div className="flex gap-3">
            {/* Camera capture (mobile) */}
            <button
              onClick={() => cameraRef.current?.click()}
              className="flex-1 border-2 border-dashed border-gray-700 hover:border-egc-green-600 rounded-xl py-8 flex flex-col items-center gap-2 text-gray-500 hover:text-egc-green-400 transition-colors"
            >
              <span className="text-3xl">📷</span>
              <span className="text-xs">Camera</span>
            </button>
            {/* File upload (desktop fallback) */}
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 border-2 border-dashed border-gray-700 hover:border-egc-green-600 rounded-xl py-8 flex flex-col items-center gap-2 text-gray-500 hover:text-egc-green-400 transition-colors"
            >
              <span className="text-3xl">🖼️</span>
              <span className="text-xs">Gallery</span>
            </button>
          </div>
        )}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        <input ref={fileRef}   type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>

      {/* Severity */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-sm font-semibold text-gray-300 mb-3">🚨 Severity</p>
        <div className="flex flex-col gap-2">
          {SEVERITIES.map(({ value, label, color, desc }) => (
            <button
              key={value}
              onClick={() => setSeverity(value)}
              className={`flex items-center gap-3 border-2 rounded-xl px-4 py-3 transition-all ${
                severity === value ? color : "border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                value === "CRITICAL" ? "bg-egc-red-500" : value === "SERIOUS" ? "bg-amber-500" : "bg-egc-green-500"
              }`} />
              <span className="font-semibold">{label}</span>
              <span className="text-xs opacity-70 ml-auto">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Location — phone GPS only */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-sm font-semibold text-gray-300 mb-3">📍 Phone GPS <span className="text-egc-red-500">*</span></p>
        {location ? (
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="text-egc-green-400">✓ Phone GPS</span>
            <span className="text-gray-500">{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</span>
            {location.accuracy != null && (
              <span className="text-gray-600">±{Math.round(location.accuracy)} m</span>
            )}
            <button onClick={getLocation} className="ml-auto text-xs text-gray-500 hover:text-gray-300">Refresh</button>
          </div>
        ) : (
          <button
            onClick={getLocation}
            disabled={locating}
            className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl py-3 text-sm text-gray-300 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {locating
              ? <><span className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full" /> Getting phone GPS…</>
              : "📍 Retry phone GPS"}
          </button>
        )}
        {locError && (
          <p className={`text-xs mt-2 ${location ? "text-amber-400" : "text-egc-red-400"}`}>{locError}</p>
        )}
      </div>

      {/* Note */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-sm font-semibold text-gray-300 mb-3">📝 Note (optional)</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any additional information for police or hospital…"
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-egc-green-500 resize-none"
        />
      </div>

      {/* Next */}
      <button
        onClick={handleSubmit}
        disabled={busy || !photo || !location}
        className="w-full bg-egc-green-600 hover:bg-egc-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-base flex items-center justify-center gap-2 transition-colors"
      >
        {busy
          ? <><span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> Finding hospitals…</>
          : "Next: Choose Hospital →"}
      </button>
    </div>
  );
}
