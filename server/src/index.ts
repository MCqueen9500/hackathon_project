import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { initSocketIO } from "./lib/socket";
import { Scheduler } from "./services/Scheduler";
import { emergencyService } from "./services/instances";
import { signalController } from "./services/signals/SimulatedSignalController";

async function main() {
  const app = createApp();
  const httpServer = createServer(app);

  // ─── Socket.IO (JWT-authenticated, room-based) ────────────────────────────
  const io = initSocketIO(httpServer, env.CORS_ORIGIN);

  // ─── Signal controller init ───────────────────────────────────────────────
  // Load signals from DB and wire the socket broadcast emitter.
  const signals = await prisma.signal.findMany({
    select: { id: true, name: true, lat: true, lng: true },
  });
  signalController.init(signals);
  signalController.setEmitter((snapshots) => {
    try {
      io.emit("signals:updated", { signals: snapshots });
    } catch { /* ignore */ }
  });
  console.log(`[server] Loaded ${signals.length} signals into SignalController`);

  // ─── DB-polling scheduler ─────────────────────────────────────────────────
  const scheduler = new Scheduler(emergencyService);
  scheduler.start();

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[server] Received ${signal}. Shutting down gracefully…`);
    scheduler.stop();
    signalController.destroy();
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
