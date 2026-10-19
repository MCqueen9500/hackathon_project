/**
 * useLocationTracker — GPS + Simulator location hook for driver.
 *
 * Modes:
 *   "GPS"       — navigator.geolocation.watchPosition (high accuracy).
 *                 Throttle: 1 send per 1-2 s. Drop readings with accuracy > 50 m.
 *                 Wake Lock API kept active while tracking.
 *   "SIMULATOR" — steps along route GeoJSON at speedKmh (default 40).
 *                 Calls /dev/simulate/:id on server (server emits pings).
 *                 Also sends one initial ping immediately.
 *
 * "stale" state: true when last successful ping > STALE_THRESHOLD_MS ago.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";

export type TrackingMode = "GPS" | "SIMULATOR" | "OFF";

interface LocationTrackerOptions {
  emergencyId: string;
  speedKmh?: number;
}


interface TrackerState {
  mode: TrackingMode;
  lat: number | null;
  lng: number | null;
  stale: boolean;
  staleSeconds: number;
  error: string | null;
}

const STALE_THRESHOLD_MS = 8_000;
const GPS_THROTTLE_MS    = 1_500;
const GPS_MAX_ACCURACY_M = 50;

export function useLocationTracker({
  emergencyId,
  speedKmh = 40,
}: LocationTrackerOptions) {
  const [state, setState] = useState<TrackerState>({
    mode:         "OFF",
    lat:          null,
    lng:          null,
    stale:        false,
    staleSeconds: 0,
    error:        null,
  });

  const wakeLockRef     = useRef<WakeLockSentinel | null>(null);
  const lastSentRef     = useRef<number>(0);
  const lastPingAtRef   = useRef<number>(0);
  const simRunningRef   = useRef(false);
  const staleTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Stale-location ticker ────────────────────────────────────────────────
  const startStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearInterval(staleTimerRef.current);
    staleTimerRef.current = setInterval(() => {
      const age = Date.now() - lastPingAtRef.current;
      const staleSeconds = Math.floor(age / 1000);
      setState((prev) => ({
        ...prev,
        stale: age > STALE_THRESHOLD_MS && prev.mode !== "OFF",
        staleSeconds,
      }));
    }, 1000);
  }, []);

  const stopStaleTimer = useCallback(() => {
    if (staleTimerRef.current) {
      clearInterval(staleTimerRef.current);
      staleTimerRef.current = null;
    }
  }, []);

  // ── Wake Lock ────────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch { /* not supported / denied */ }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  // ── Send ping to server ──────────────────────────────────────────────────
  const sendPing = useCallback(async (
    lat: number, lng: number, source: "GPS" | "SIMULATOR",
    opts?: { speed?: number; heading?: number; accuracy?: number }
  ) => {
    try {
      await api.post(`/emergencies/${emergencyId}/location`, {
        lat, lng, source,
        speed:      opts?.speed,
        heading:    opts?.heading,
        accuracy:   opts?.accuracy,
        recordedAt: new Date().toISOString(),
      });
      lastPingAtRef.current = Date.now();
      setState((prev) => ({ ...prev, lat, lng, stale: false, error: null }));
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to send location" }));
    }
  }, [emergencyId]);

  // ── GPS mode ─────────────────────────────────────────────────────────────
  const watchIdRef = useRef<number | null>(null);

  const startGPS = useCallback(async () => {
    if (!navigator.geolocation) {
      setState((prev) => ({ ...prev, error: "Geolocation not available", mode: "OFF" }));
      return;
    }
    await acquireWakeLock();
    lastPingAtRef.current = Date.now();
    startStaleTimer();

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;
        // Drop low-accuracy readings
        if (accuracy !== null && accuracy > GPS_MAX_ACCURACY_M) return;
        // Throttle
        const now = Date.now();
        if (now - lastSentRef.current < GPS_THROTTLE_MS) return;
        lastSentRef.current = now;
        void sendPing(latitude, longitude, "GPS", { accuracy, speed: speed ?? undefined, heading: heading ?? undefined });
      },
      (err) => {
        setState((prev) => ({ ...prev, error: `GPS error: ${err.message}` }));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );

    setState((prev) => ({ ...prev, mode: "GPS", error: null }));
  }, [acquireWakeLock, startStaleTimer, sendPing]);

  const stopGPS = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    releaseWakeLock();
    stopStaleTimer();
    setState((prev) => ({ ...prev, mode: "OFF" }));
  }, [releaseWakeLock, stopStaleTimer]);

  // ── Simulator mode ───────────────────────────────────────────────────────
  const startSimulator = useCallback(async () => {
    simRunningRef.current = true;
    await acquireWakeLock();
    lastPingAtRef.current = Date.now();
    startStaleTimer();
    setState((prev) => ({ ...prev, mode: "SIMULATOR", error: null }));

    // Start server-side simulator (server will emit pings via socket)
    try {
      await api.post(`/dev/simulate/${emergencyId}`, { speedKmh });
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to start simulator" }));
    }
  }, [emergencyId, speedKmh, acquireWakeLock, startStaleTimer]);

  const stopSimulator = useCallback(async () => {
    simRunningRef.current = false;
    await api.post(`/dev/simulate/${emergencyId}/stop`, {}).catch(() => {});
    releaseWakeLock();
    stopStaleTimer();
    setState((prev) => ({ ...prev, mode: "OFF" }));
  }, [emergencyId, releaseWakeLock, stopStaleTimer]);

  // ── Public actions ───────────────────────────────────────────────────────
  const startTracking = useCallback(async (mode: "GPS" | "SIMULATOR") => {
    if (mode === "GPS") await startGPS();
    else await startSimulator();
  }, [startGPS, startSimulator]);

  const stopTracking = useCallback(async () => {
    if (state.mode === "GPS") stopGPS();
    else if (state.mode === "SIMULATOR") await stopSimulator();
  }, [state.mode, stopGPS, stopSimulator]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      releaseWakeLock();
      stopStaleTimer();
      if (simRunningRef.current) {
        api.post(`/dev/simulate/${emergencyId}/stop`, {}).catch(() => {});
      }
    };
  }, [emergencyId, releaseWakeLock, stopStaleTimer]);

  return { ...state, startTracking, stopTracking };
}
