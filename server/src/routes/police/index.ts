/**
 * routes/police/index.ts
 *
 * Police endpoints (spec section 8):
 *   GET  /police/queue
 *   POST /police/emergencies/:id/verify
 *   POST /police/emergencies/:id/reject
 *   POST /closures          (stub — skipped per prompt)
 *   DELETE /closures/:id    (stub)
 *   GET  /closures          (stub)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { emergencyService } from "../../services/instances";
import { EmergencyError } from "../../errors/EmergencyError";
import { closureService } from "../../services/ClosureService";
import { photoUrl } from "../../lib/photoToken";
import type { AuthenticatedRequest } from "../../types";

export const policeRouter = Router();

const guardPolice = [authenticate, requireRole("POLICE")];

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

// ── GET /police/queue ─────────────────────────────────────────────────────────
// Returns all PENDING_APPROVALS emergencies, escalated first, then oldest-first
policeRouter.get(
  "/queue",
  ...guardPolice,
  async (_req: Request, res: Response): Promise<void> => {
    const emergencies = await prisma.emergency.findMany({
      where: { status: "PENDING_APPROVALS", policeStatus: "PENDING" },
      orderBy: [
        { policeEscalated: "desc" },   // escalated to the top
        { createdAt: "asc" },          // oldest first within tier
      ],
      include: {
        driver: {
          select: { id: true, name: true, username: true, ambulanceNo: true },
        },
      },
    });

    // Inject fresh signed photoUrl for each emergency that has a photo
    const queue = emergencies.map((em) => ({
      ...em,
      photoUrl: em.photoPath ? photoUrl(em.id) : null,
    }));

    res.json({ queue });
  }
);

// ── POST /police/emergencies/:id/verify ───────────────────────────────────────
policeRouter.post(
  "/emergencies/:id/verify",
  ...guardPolice,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
      const emergency = await emergencyService.policeApprove(p(req.params.id), authReq.user.sub);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404 : 409;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── POST /police/emergencies/:id/reject ───────────────────────────────────────
policeRouter.post(
  "/emergencies/:id/reject",
  ...guardPolice,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
      const emergency = await emergencyService.policeReject(p(req.params.id), authReq.user.sub);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404 : 409;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── Road closures (stubs — routing/closures are Phase 3) ─────────────────────
const closureBodySchema = z.object({
  polygonGeoJson: z.string().min(1),
});

policeRouter.post(
  "/closures",
  ...guardPolice,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const parsed = closureBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }
    const closure = await prisma.roadClosure.create({
      data: {
        polygonGeoJson: parsed.data.polygonGeoJson,
        createdById:    authReq.user.sub,
        active:         true,
      },
    });
    // Re-route any ACTIVE emergencies whose route crosses the new closure
    void closureService.onClosureCreated(closure.id);
    res.status(201).json({ closure });
  }
);

policeRouter.delete(
  "/closures/:id",
  ...guardPolice,
  async (req: Request, res: Response): Promise<void> => {
    const closure = await prisma.roadClosure.findUnique({ where: { id: p(req.params.id) } });
    if (!closure) { res.status(404).json({ error: "Closure not found" }); return; }

    await prisma.roadClosure.update({ where: { id: p(req.params.id) }, data: { active: false } });
    // Re-route active emergencies that were avoiding this polygon (now cleared)
    void closureService.onClosureCleared();
    res.json({ ok: true });
  }
);


policeRouter.get(
  "/closures",
  ...guardPolice,
  async (_req: Request, res: Response): Promise<void> => {
    const closures = await prisma.roadClosure.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ closures });
  }
);
