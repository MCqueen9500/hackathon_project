/**
 * Subscribe to Socket.IO `location:update` pings for ambulance markers
 * on police / hospital / driver maps. Never reads navigator.geolocation.
 */

import { useEffect, useRef, useState } from "react";
import { useSocket } from "./useSocket";

export type LocationSource = "GPS" | "SIMULATOR";

export interface LivePing {
  emergencyId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  source: LocationSource;
  recordedAt: string;
  stale: boolean;
  staleSeconds: number;
}

const STALE_THRESHOLD_MS = 4_000;

interface PingPayload {
  emergencyId?: string;
  lat?: number;
  lng?: number;
  accuracy?: number | null;
  source?: LocationSource;
  recordedAt?: string;
}

export function useLiveAmbulances() {
  const { socket } = useSocket();
  const [byId, setById] = useState<Record<string, LivePing>>({});
  const lastAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!socket) return;

    const onPing = (raw: PingPayload) => {
      if (!raw || typeof raw.lat !== "number" || typeof raw.lng !== "number") return;
      const emergencyId = raw.emergencyId;
      if (!emergencyId) return;
      const recordedAt = raw.recordedAt ?? new Date().toISOString();
      lastAtRef.current[emergencyId] = Date.now();
      setById((prev) => ({
        ...prev,
        [emergencyId]: {
          emergencyId,
          lat: raw.lat!,
          lng: raw.lng!,
          accuracy: raw.accuracy ?? null,
          source: raw.source === "SIMULATOR" ? "SIMULATOR" : "GPS",
          recordedAt,
          stale: false,
          staleSeconds: 0,
        },
      }));
    };

    socket.on("location:update", onPing);
    return () => {
      socket.off("location:update", onPing);
    };
  }, [socket]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setById((prev) => {
        let changed = false;
        const next: Record<string, LivePing> = { ...prev };
        for (const [eid, ping] of Object.entries(prev)) {
          const last = lastAtRef.current[eid] ?? 0;
          const age = last ? Math.floor((now - last) / 1000) : ping.staleSeconds;
          const stale = last ? now - last > STALE_THRESHOLD_MS : ping.stale;
          if (age !== ping.staleSeconds || stale !== ping.stale) {
            next[eid] = { ...ping, stale, staleSeconds: age };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return byId;
}

export function useLiveAmbulance(emergencyId: string | null | undefined): LivePing | null {
  const all = useLiveAmbulances();
  if (!emergencyId) return null;
  return all[emergencyId] ?? null;
}
