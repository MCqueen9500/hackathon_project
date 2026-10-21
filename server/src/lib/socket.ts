/**
 * socket.ts — Socket.IO singleton
 *
 * The server creates this once (in index.ts) and routes/services import it to
 * emit events. Per spec section 9:
 *   - JWT-authenticated sockets
 *   - Rooms: role:POLICE, hospital:{id}, emergency:{id}, driver:{id}
 *   - Events: emergency:created, emergency:updated, location:update,
 *             route:updated, signals:updated, closure:updated, approval:timeout
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { verifyAccessToken } from "./jwt";
import { prisma } from "./prisma";
import type { JwtPayload } from "../types";

// ── Singleton ─────────────────────────────────────────────────────────────────
let _io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer, corsOrigin: string | string[]): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
  });

  // ── JWT authentication middleware ──────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    const token =
      (socket.handshake.auth as { token?: string }).token ??
      (socket.handshake.headers.authorization as string | undefined)?.replace("Bearer ", "");

    if (!token) {
      return next(new Error("Missing token"));
    }

    let payload: JwtPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return next(new Error("Invalid token"));
    }

    // Check the user is still active (spec section 12)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { active: true },
    });

    if (!user?.active) {
      return next(new Error("Account inactive"));
    }

    // Attach payload to socket data
    socket.data.user = payload;
    next();
  });

  // ── Room join on connect ───────────────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as JwtPayload;

    // Every user joins their role room and their personal driver room
    void socket.join(`role:${user.role}`);
    void socket.join(`driver:${user.sub}`);

    // Hospital admins join their hospital room
    if (user.hospitalId) {
      void socket.join(`hospital:${user.hospitalId}`);
    }

    // Client can join a specific emergency room (e.g. driver watching their own)
    socket.on("join:emergency", (emergencyId: string) => {
      void socket.join(`emergency:${emergencyId}`);
    });

    socket.on("join", (payload: { room?: string } | string) => {
      const room = typeof payload === "string" ? payload : payload?.room;
      if (room) void socket.join(room);
    });

    socket.on("leave:emergency", (emergencyId: string) => {
      void socket.leave(`emergency:${emergencyId}`);
    });
  });

  _io = io;
  return io;
}

/** Returns the Socket.IO server — throws if not yet initialised */
export function getIO(): SocketIOServer {
  if (!_io) {
    throw new Error("Socket.IO not initialised — call initSocketIO() first");
  }
  return _io;
}

// ── Typed emit helpers ────────────────────────────────────────────────────────

/** Emit to every room associated with an emergency (emergency room + police + hospital + driver). */
export function emitEmergencyEvent(
  event: "emergency:created" | "emergency:updated" | "approval:timeout",
  payload: {
    emergencyId: string;
    driverId: string;
    selectedHospitalId?: string | null;
    data: Record<string, unknown>;
  }
) {
  try {
    const io = getIO();
    // Specific emergency watchers
    io.to(`emergency:${payload.emergencyId}`).emit(event, payload.data);
    // Police always see every emergency
    io.to("role:POLICE").emit(event, payload.data);
    // The driver who owns this emergency
    io.to(`driver:${payload.driverId}`).emit(event, payload.data);
    // The selected hospital (if any)
    if (payload.selectedHospitalId) {
      io.to(`hospital:${payload.selectedHospitalId}`).emit(event, payload.data);
    }
  } catch {
    // Socket server may not be started in test environment — ignore silently
  }
}
