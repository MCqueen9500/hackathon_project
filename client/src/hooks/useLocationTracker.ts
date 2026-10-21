/**
 * useLocationTracker — GPS + Simulator location hook for driver.
 *
 * Modes:
 *   "GPS"       — navigator.geolocation.watchPosition (high accuracy).
 *                 Throttle: 1 send per 1-2 s. Drop readings with accuracy
 *                 worse than GPS_MAX_ACCURACY_M. Wake Lock while tracking.
 *   "SIMULATOR" — server walks the route polyline at speedKmh.
 *
 * "stale" state: true when last successful ping > STALE_THRESHOLD_MS ago.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { GPS_MAX_ACCURACY_M } from "../lib/config";

export type TrackingMode = "GPS" | "SIMULATOR" | "OFF";

interface LocationTrackerOptions {
  emergencyId: string;
  speedKmh?: number;
  /** Keep the screen awake while this is true (active emergency). */
  holdWakeLock?: boolean;
}

interface TrackerState {
  mode: TrackingMode;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  stale: boolean;
  staleSeconds: number;
  error: string | null;
  permissionDenied: boolean;
}

const STALE_THRESHOLD_MS = 4_000;
const GPS_THROTTLE_MS    = 1_500;

function finiteOrUndef(n: number | null): number | undefined {
  return n !== null && Number.isFinite(n) ? n : undefined;
}

export function useLocationTracker({
  emergencyId,
  speedKmh = 40,
  holdWakeLock = false,
}: LocationTrackerOptions) {
  const [state, setState] = useState<TrackerState>({
    mode:             "OFF",
    lat:              null,
    lng:              null,
    accuracy:         null,
    stale:            false,
    staleSeconds:     0,
    error:            null,
    permissionDenied: false,
  });

  const wakeLockRef     = useRef<WakeLockSentinel | null>(null);
  const lastSentRef     = useRef<number>(0);
  const lastPingAtRef   = useRef<number>(0);
  const simRunningRef   = useRef(false);
  const staleTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchIdRef      = useRef<number | null>(null);
  const modeRef         = useRef<TrackingMode>("OFF");

  // ── Stale-location ticker ────────────────────────────────────────────────
  const startStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearInterval(staleTimerRef.current);
    staleTimerRef.current = setInterval(() => {
      const last = lastPingAtRef.current;
      if (!last) return;
      const age = Date.now() - last;
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

  useEffect(() => {
    if (holdWakeLock) void acquireWakeLock();
    else if (modeRef.current === "OFF") releaseWakeLock();

    const onVis = () => {
      if (document.visibilityState === "visible" && (holdWakeLock || modeRef.current !== "OFF")) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [holdWakeLock, acquireWakeLock, releaseWakeLock]);

  // ── Send ping to server ──────────────────────────────────────────────────
  const sendPing = useCallback(async (
    lat: number, lng: number, source: "GPS" | "SIMULATOR",
    opts?: { speed?: number; heading?: number; accuracy?: number; recordedAt?: string }
  ) => {
    try {
      await api.post(`/emergencies/${emergencyId}/location`, {
        lat, lng, source,
        speed:      opts?.speed,
        heading:    opts?.heading,
        accuracy:   opts?.accuracy,
        recordedAt: opts?.recordedAt ?? new Date().toISOString(),
      });
      lastPingAtRef.current = Date.now();
      setState((prev) => ({
        ...prev,
        lat,
        lng,
        accuracy: opts?.accuracy ?? prev.accuracy,
        stale: false,
        staleSeconds: 0,
        error: null,
        permissionDenied: false,
      }));
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to send location" }));
    }
  }, [emergencyId]);

  // ── GPS mode ─────────────────────────────────────────────────────────────
  const startGPS = useCallback(async () => {
    if (!navigator.geolocation) {
      setState((prev) => ({ ...prev, error: "Geolocation not available", mode: "OFF" }));
      return;
    }
    await acquireWakeLock();
    lastPingAtRef.current = Date.now();
    startStaleTimer();
    modeRef.current = "GPS";

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;
        if (accuracy !== null && Number.isFinite(accuracy) && accuracy > GPS_MAX_ACCURACY_M) {
          return;
        }
        const now = Date.now();
        if (now - lastSentRef.current < GPS_THROTTLE_MS) return;
        lastSentRef.current = now;
        void sendPing(latitude, longitude, "GPS", {
          accuracy: finiteOrUndef(accuracy),
          speed:    finiteOrUndef(speed),
          heading:  finiteOrUndef(heading),
          recordedAt: new Date(pos.timestamp).toISOString(),
        });
      },
      (err) => {
        const permissionDenied = err.code === err.PERMISSION_DENIED;
        setState((prev) => ({
          ...prev,
          permissionDenied,
          error: permissionDenied
            ? "Location permission denied — enable GPS on this phone."
            : `GPS error: ${err.message}`,
        }));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );

    setState((prev) => ({ ...prev, mode: "GPS", error: null, permissionDenied: false }));
  }, [acquireWakeLock, startStaleTimer, sendPing]);

  const stopGPS = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (!holdWakeLock) releaseWakeLock();
    stopStaleTimer();
    modeRef.current = "OFF";
    setState((prev) => ({ ...prev, mode: "OFF" }));
  }, [releaseWakeLock, stopStaleTimer, holdWakeLock]);

  // ── Simulator mode ───────────────────────────────────────────────────────
  const startSimulator = useCallback(async () => {
    simRunningRef.current = true;
    await acquireWakeLock();
    lastPingAtRef.current = Date.now();
    startStaleTimer();
    modeRef.current = "SIMULATOR";
    setState((prev) => ({ ...prev, mode: "SIMULATOR", error: null, permissionDenied: false }));

    try {
      await api.post(`/dev/simulate/${emergencyId}`, { speedKmh });
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to start simulator" }));
    }
  }, [emergencyId, speedKmh, acquireWakeLock, startStaleTimer]);

  const stopSimulator = useCallback(async () => {
    simRunningRef.current = false;
    await api.post(`/dev/simulate/${emergencyId}/stop`, {}).catch(() => {});
    if (!holdWakeLock) releaseWakeLock();
    stopStaleTimer();
    modeRef.current = "OFF";
    setState((prev) => ({ ...prev, mode: "OFF" }));
  }, [emergencyId, releaseWakeLock, stopStaleTimer, holdWakeLock]);

  const startTracking = useCallback(async (mode: "GPS" | "SIMULATOR") => {
    if (modeRef.current === "GPS") stopGPS();
    else if (modeRef.current === "SIMULATOR") await stopSimulator();
    if (mode === "GPS") await startGPS();
    else await startSimulator();
  }, [startGPS, startSimulator, stopGPS, stopSimulator]);

  const stopTracking = useCallback(async () => {
    if (modeRef.current === "GPS") stopGPS();
    else if (modeRef.current === "SIMULATOR") await stopSimulator();
  }, [stopGPS, stopSimulator]);

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
