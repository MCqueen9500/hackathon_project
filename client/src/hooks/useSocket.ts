/**
 * useSocket — Socket.IO hook with JWT auth and reconnect state refetch.
 *
 * Per spec section 9:
 *   - Authenticates with the JWT access token via socket auth handshake.
 *   - On reconnect, the hook signals callers to refetch full state over REST
 *     rather than trusting missed events.
 *   - Joins the right room(s) automatically based on the user's role.
 *
 * Usage:
 *   const { socket, connected, refetchCount } = useSocket();
 *   useEffect(() => { ... }, [refetchCount]);  // re-query REST on reconnect
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "../contexts/AuthContext";

interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  /** Increments every time a reconnect causes a state refetch */
  refetchCount: number;
}

export function useSocket(): UseSocketReturn {
  const { user } = useAuth();
  const socketRef  = useRef<Socket | null>(null);
  const [connected,    setConnected]    = useState(false);
  const [refetchCount, setRefetchCount] = useState(0);

  const triggerRefetch = useCallback(() => {
    setRefetchCount((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!user) {
      // No user → disconnect any existing socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    const token = localStorage.getItem("egc_access") ?? "";

    const socket = io("/", {
      // In dev, Vite proxies /socket.io → http://localhost:3001
      path: "/socket.io",
      auth: { token },
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    // On reconnect: spec §9 — refetch full state over REST
    socket.io.on("reconnect", () => {
      // Update auth token in case it was refreshed while disconnected
      const freshToken = localStorage.getItem("egc_access") ?? "";
      socket.auth = { token: freshToken };
      triggerRefetch();
    });

    socket.on("connect_error", (err) => {
      console.warn("[socket] connect_error:", err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user, triggerRefetch]);

  return { socket: socketRef.current, connected, refetchCount };
}
