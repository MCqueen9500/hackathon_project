/**
 * SocketContext — single Socket.IO connection shared across the whole app.
 *
 * Per spec §9:
 *   - Authenticates with JWT access token via socket auth handshake.
 *   - On reconnect, increments refetchCount so consumers know to re-query REST.
 *   - Automatically disconnects when the user logs out (user = null).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  /** Increments every time a reconnect signals a state refetch is needed */
  refetchCount: number;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  refetchCount: 0,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socketRef     = useRef<Socket | null>(null);
  const [connected,    setConnected]    = useState(false);
  const [refetchCount, setRefetchCount] = useState(0);

  const triggerRefetch = useCallback(() => setRefetchCount((n) => n + 1), []);

  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    const token = localStorage.getItem("egc_access") ?? "";

    const socket = io("/", {
      path: "/socket.io",
      auth: { token },
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect",    () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    // On reconnect: update token in case it was silently refreshed, then signal refetch
    socket.io.on("reconnect", () => {
      const fresh = localStorage.getItem("egc_access") ?? "";
      socket.auth = { token: fresh };
      triggerRefetch();
    });

    socket.on("connect_error", (err) =>
      console.warn("[socket] connect_error:", err.message)
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user, triggerRefetch]);

  return (
    <SocketContext.Provider
      value={{ socket: socketRef.current, connected, refetchCount }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
