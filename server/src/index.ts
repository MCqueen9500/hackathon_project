import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { initSocketIO } from "./lib/socket";
import { Scheduler } from "./services/Scheduler";
import { emergencyService } from "./services/instances";

async function main() {
  const app = createApp();
  const httpServer = createServer(app);

  // ─── Socket.IO (JWT-authenticated, room-based) ────────────────────────────
  initSocketIO(httpServer, env.CORS_ORIGIN);

  // ─── DB-polling scheduler ─────────────────────────────────────────────────
  // Handles hospital/police timeouts and bed hold expiry.
  // runNow() fires immediately so deadlines missed during downtime are caught.
  const scheduler = new Scheduler(emergencyService);
  scheduler.start();

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[server] Received ${signal}. Shutting down gracefully…`);
    scheduler.stop();
    httpServer.close(async () => {
      await prisma.$disconnect();
      console.log("[server] DB disconnected. Bye.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  // ─── Start ────────────────────────────────────────────────────────────────
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
