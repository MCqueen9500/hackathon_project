import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);

  // ─── Socket.IO ───────────────────────────────────────────────────────────────
  // Full Socket.IO setup (auth, rooms, events) will be wired in Phase 1.
  // We create the server here so the instance is available for later middleware.
  const _io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  // ─── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[server] Received ${signal}. Shutting down gracefully…`);
    httpServer.close(async () => {
      await prisma.$disconnect();
      console.log("[server] DB disconnected. Bye.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ─── Start ───────────────────────────────────────────────────────────────────
  httpServer.listen(env.PORT, () => {
    console.log(
      `[server] 🚀 Emergency Green Corridor server running on http://localhost:${env.PORT}`
    );
    console.log(`[server] NODE_ENV=${env.NODE_ENV}`);
    console.log(`[server] GET http://localhost:${env.PORT}/health`);
  });
}

main().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
