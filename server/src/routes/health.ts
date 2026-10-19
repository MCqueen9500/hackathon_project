import { Router } from "express";
import { prisma } from "../lib/prisma";

export const healthRouter = Router();

/**
 * GET /health
 * Returns server status and DB connectivity.
 * Used by CI, load balancers, and the acceptance test for Phase 0.
 */
healthRouter.get("/", async (_req, res) => {
  try {
    // Lightweight DB ping — no table scan needed
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      db: "connected",
      version: process.env.npm_package_version ?? "unknown",
    });
  } catch (err) {
    // DB is down but the server itself is healthy — return 503, not 500
    res.status(503).json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      db: "disconnected",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
