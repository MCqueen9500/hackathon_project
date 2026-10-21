/**
 * Driver UI — manages view state across the four screens:
 *   HOME → REPORT → PICK_HOSPITAL → ACTIVE
 *
 * Socket events drive live updates on the ACTIVE screen.
 */

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "../components/AppShell";
import { useSocket } from "../hooks/useSocket";
import {
  getActiveEmergency,
  cancelEmergency,
  markArrived,
} from "../api/driverApi";
import type { Emergency, HospitalCandidate } from "../types/emergency";
import { ReportForm } from "./driver/ReportForm";
import { HospitalPicker } from "./driver/HospitalPicker";
import { ActiveEmergency } from "./driver/ActiveEmergency";

type View = "HOME" | "REPORT" | "PICK_HOSPITAL" | "ACTIVE";

export default function DriverPage() {
  const { socket, refetchCount } = useSocket();

  const [view,        setView]        = useState<View>("HOME");
  const [emergency,   setEmergency]   = useState<Emergency | null>(null);
  const [candidates,  setCandidates]  = useState<HospitalCandidate[]>([]);
  const [reportData,  setReportData]  = useState<{
    photo: File; severity: "CRITICAL"|"SERIOUS"|"STABLE"; note: string;
    lat: number; lng: number;
  } | null>(null);
  const [busy,        setBusy]        = useState(false);
  const [banner,      setBanner]      = useState<string | null>(null);

  // ── On mount / reconnect: check for an active emergency ───────────────────
  const fetchActive = useCallback(async () => {
    try {
      const em = await getActiveEmergency();
      if (em) { setEmergency(em); setView("ACTIVE"); }
    } catch { /* no active */ }
  }, []);

  useEffect(() => { fetchActive(); }, [fetchActive]);
  useEffect(() => { if (refetchCount > 0) fetchActive(); }, [refetchCount, fetchActive]);

  // ── Socket: live emergency updates ────────────────────────────────────────
  useEffect(() => {
    if (!socket || !emergency) return;
    socket.emit("join", { room: `emergency:${emergency.id}` });

    const onUpdate = (payload: Partial<Emergency> & { emergencyId?: string; action?: string }) => {
      if (payload.emergencyId && payload.emergencyId !== emergency.id) return;
      setEmergency((prev) => prev ? { ...prev, ...payload } as Emergency : prev);

      // Show banner if hospital was switched
      if (payload.selectedHospitalId && payload.selectedHospitalId !== emergency.selectedHospitalId) {
        setBanner("⚠️ Hospital auto-switched — a new hospital has been assigned.");
        setTimeout(() => setBanner(null), 8000);
      }
    };

    // Route updated due to closure or deviation
    const onRouteUpdated = (payload: { emergencyId: string; routeGeoJson: unknown; etaSeconds: number; distanceMeters: number }) => {
      if (payload.emergencyId !== emergency.id) return;
      setEmergency((prev) => prev ? {
        ...prev,
        routeGeoJson: payload.routeGeoJson,
        etaSeconds: payload.etaSeconds,
        distanceMeters: payload.distanceMeters,
      } as Emergency : prev);
      setBanner("🔄 Route updated — re-routed around road closure or deviation.");
      setTimeout(() => setBanner(null), 8000);
    };

    socket.on("emergency:updated", onUpdate);
    socket.on("route:updated", onRouteUpdated);
    return () => {
      socket.off("emergency:updated", onUpdate);
      socket.off("route:updated", onRouteUpdated);
    };
  }, [socket, emergency]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!emergency || busy) return;
    setBusy(true);
    try {
      const updated = await cancelEmergency(emergency.id);
      setEmergency(updated);
      setView("HOME");
      setEmergency(null);
    } finally { setBusy(false); }
  };

  const handleArrived = async () => {
    if (!emergency || busy) return;
    setBusy(true);
    try {
      const updated = await markArrived(emergency.id);
      setEmergency(updated);
    } finally { setBusy(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      {/* Hospital auto-switch banner */}
      {banner && (
        <div className="mb-4 bg-amber-900/60 border border-amber-700 text-amber-200 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
          <span className="flex-shrink-0">⚠️</span>
          <span>{banner}</span>
        </div>
      )}

      {view === "HOME" && (
        <HomeScreen onReport={() => setView("REPORT")} />
      )}

      {view === "REPORT" && (
        <ReportForm
          onBack={() => setView("HOME")}
          onNext={(data, cands) => {
            setReportData(data);
            setCandidates(cands);
            setView("PICK_HOSPITAL");
          }}
        />
      )}

      {view === "PICK_HOSPITAL" && reportData && (
        <HospitalPicker
          candidates={candidates}
          reportData={reportData}
          onBack={() => setView("REPORT")}
          onCreated={(em) => { setEmergency(em); setView("ACTIVE"); }}
        />
      )}

      {view === "ACTIVE" && emergency && (
        <ActiveEmergency
          emergency={emergency}
          onCancel={handleCancel}
          onArrived={handleArrived}
          busy={busy}
        />
      )}
    </AppShell>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────

function HomeScreen({ onReport }: { onReport: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center shadow-xl">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-egc-green-900/50 border-2 border-egc-green-700 mb-4">
          <span className="text-4xl" aria-hidden>🚑</span>
        </div>
        <h1 className="text-xl font-bold text-white mb-1">Driver Dashboard</h1>
        <p className="text-gray-400 text-sm">No active emergency</p>
      </div>

      <button
        id="driver-report-btn"
        onClick={onReport}
        className="w-full bg-egc-green-600 hover:bg-egc-green-700 active:scale-95 text-white font-bold py-5 rounded-2xl text-lg flex items-center justify-center gap-3 shadow-lg shadow-egc-green-900/30 transition-all"
      >
        <span aria-hidden>📸</span>
        Report Accident
      </button>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Status",    value: "Available",   icon: "✅" },
          { label: "Emergency", value: "None active", icon: "🔕" },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-1">
            <span className="text-lg">{icon}</span>
            <span className="text-xs text-gray-500">{label}</span>
            <span className="text-sm font-semibold text-white">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
