/**
 * Live traffic-signal snapshots from REST + Socket.IO `signals:updated`.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useSocket } from "./useSocket";
import type { SignalSnapshot } from "../components/MapLibreMap";

export function useSignals(): SignalSnapshot[] {
  const { socket, refetchCount } = useSocket();
  const [signals, setSignals] = useState<SignalSnapshot[]>([]);

  useEffect(() => {
    api.get<{ signals: SignalSnapshot[] }>("/signals")
      .then((r) => setSignals(r.data.signals ?? []))
      .catch(() => {});
  }, [refetchCount]);

  useEffect(() => {
    const apply = (payload: unknown) => {
      const detail = payload as { signals?: SignalSnapshot[] };
      if (detail?.signals) setSignals(detail.signals);
    };
    const onDom = (e: Event) => apply((e as CustomEvent).detail);
    window.addEventListener("signals:updated", onDom);
    if (socket) socket.on("signals:updated", apply);
    return () => {
      window.removeEventListener("signals:updated", onDom);
      socket?.off("signals:updated", apply);
    };
  }, [socket]);

  return signals;
}
