/**
 * Signal routes (spec §17.6)
 *
 * GET    /signals                 any authenticated role — live snapshots
 * POST   /signals                 ADMIN — create (click-to-add)
 * PATCH  /signals/:id             ADMIN — move / rename
 * DELETE /signals/:id             ADMIN
 * POST   /signals/auto-place      ADMIN — place simulated signals along a route
 * GET    /admin/routes            ADMIN — emergencies with a route to auto-place on
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { signalController } from "../../services/signals/SimulatedSignalController";
import { placeAlongRoute } from "../../services/signals/placeAlongRoute";
import type { AuthenticatedRequest } from "../../types";

export const signalsRouter = Router();

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

const createSchema = z.object({
  lat:        z.coerce.number().min(-90).max(90),
  lng:        z.coerce.number().min(-180).max(180),
  name:       z.string().max(120).optional(),
  simulated:  z.boolean().optional().default(true),
});

const patchSchema = z.object({
  lat:  z.coerce.number().min(-90).max(90).optional(),
  lng:  z.coerce.number().min(-180).max(180).optional(),
  name: z.string().max(120).nullable().optional(),
});

const autoPlaceSchema = z.object({
  emergencyId:  z.string().uuid().optional(),
  coordinates:  z.array(z.tuple([z.number(), z.number()])).min(2).optional(),
}).refine((b) => b.emergencyId || b.coordinates, {
  message: "Provide emergencyId or coordinates",
});

// ── GET /signals ──────────────────────────────────────────────────────────────
signalsRouter.get("/", authenticate, (_req: Request, res: Response) => {
  res.json({ signals: signalController.getAll() });
});

// ── GET /signals/routes (ADMIN) ───────────────────────────────────────────────
signalsRouter.get(
  "/routes",
  authenticate,
  requireRole("ADMIN"),
  async (_req: Request, res: Response) => {
    const rows = await prisma.emergency.findMany({
      where: { status: { in: ["PENDING_APPROVALS", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        severity: true,
        routeGeoJson: true,
        driver: { select: { name: true, ambulanceNo: true } },
        selectedHospital: { select: { name: true } },
      },
    });
    const routes = rows.filter((r) => {
      const g = r.routeGeoJson as { type?: string; coordinates?: unknown[] } | null;
      return g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length >= 2;
    });
    res.json({ routes });
  }
);

// ── POST /signals ─────────────────────────────────────────────────────────────
signalsRouter.post(
  "/",
  authenticate,
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }
    const row = await prisma.signal.create({
      data: {
        lat:        parsed.data.lat,
        lng:        parsed.data.lng,
        name:       parsed.data.name ?? "Signal",
        simulated:  parsed.data.simulated,
        city:       "Demo City",
      },
    });
    signalController.upsert(row);
    res.status(201).json({ signal: row });
  }
);

// ── PATCH /signals/:id ────────────────────────────────────────────────────────
signalsRouter.patch(
  "/:id",
  authenticate,
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }
    const id = p(req.params.id);
    try {
      const row = await prisma.signal.update({
        where: { id },
        data: {
          ...(parsed.data.lat !== undefined ? { lat: parsed.data.lat } : {}),
          ...(parsed.data.lng !== undefined ? { lng: parsed.data.lng } : {}),
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        },
      });
      signalController.upsert(row);
      res.json({ signal: row });
    } catch {
      res.status(404).json({ error: "Signal not found" });
    }
  }
);

// ── DELETE /signals/:id ───────────────────────────────────────────────────────
signalsRouter.delete(
  "/:id",
  authenticate,
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const id = p(req.params.id);
    try {
      await prisma.signal.delete({ where: { id } });
      signalController.remove(id);
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: "Signal not found" });
    }
  }
);

// ── POST /signals/auto-place ──────────────────────────────────────────────────
signalsRouter.post(
  "/auto-place",
  authenticate,
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = autoPlaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    let coords: [number, number][] | null = parsed.data.coordinates ?? null;
    if (!coords && parsed.data.emergencyId) {
      const em = await prisma.emergency.findUnique({
        where: { id: parsed.data.emergencyId },
        select: { routeGeoJson: true },
      });
      const g = em?.routeGeoJson as { type?: string; coordinates?: [number, number][] } | null;
      if (g?.type === "LineString" && Array.isArray(g.coordinates)) {
        coords = g.coordinates;
      }
    }
    if (!coords || coords.length < 2) {
      res.status(400).json({ error: "No route coordinates available" });
      return;
    }

    const points = placeAlongRoute(coords, 300, 400);
    const created = await prisma.$transaction(
      points.map((pt, i) =>
        prisma.signal.create({
          data: {
            lat: pt.lat,
            lng: pt.lng,
            name: `Demo signal ${i + 1}`,
            simulated: true,
            city: "Demo City",
          },
        })
      )
    );
    for (const row of created) signalController.upsert(row);

    void prisma.auditLog.create({
      data: {
        actorId:    authReq.user.sub,
        action:     "SIGNALS_AUTO_PLACE",
        entityType: "SIGNAL",
        entityId:   parsed.data.emergencyId ?? "manual-route",
        payload:    { count: created.length },
      },
    }).catch(() => {});

    res.status(201).json({ count: created.length, signals: created });
  }
);
