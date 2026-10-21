/**
 * routes/hospital/index.ts
 *
 * Hospital admin endpoints (spec section 8):
 *   GET  /hospital/incoming
 *   POST /hospital/emergencies/:id/approve
 *   POST /hospital/emergencies/:id/reject
 *   POST /hospital/emergencies/:id/revoke
 *   POST /hospital/emergencies/:id/confirm-handover
 *   PATCH /hospital/beds
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { driversRouter } from "./drivers";
import { emergencyService } from "../../services/instances";
import { EmergencyError } from "../../errors/EmergencyError";
import { photoUrl } from "../../lib/photoToken";
import type { AuthenticatedRequest } from "../../types";

export const hospitalRouter = Router();

const guardHospitalAdmin = [authenticate, requireRole("HOSPITAL_ADMIN")];

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

// Driver management sub-router
hospitalRouter.use("/drivers", driversRouter);

// ── GET /hospital/incoming ────────────────────────────────────────────────────
// Emergencies routed to this admin's hospital, awaiting hospital approval
hospitalRouter.get(
  "/incoming",
  ...guardHospitalAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { hospitalId } = authReq.user;

    if (!hospitalId) { res.status(403).json({ error: "No hospital associated" }); return; }

    const emergencies = await prisma.emergency.findMany({
      where: {
        selectedHospitalId: hospitalId,
        status: { in: ["PENDING_APPROVALS", "ACTIVE", "ARRIVED"] },
      },
      orderBy: [
        { severity: "asc" },    // CRITICAL first (alphabetically C < S)
        { createdAt: "asc" },
      ],
      include: {
        driver: { select: { id: true, name: true, ambulanceNo: true } },
        selectedHospital: { select: { id: true, name: true, lat: true, lng: true, city: true } },
      },
    });

    // Inject fresh signed photoUrl (hospital admin is an authorised viewer)
    const incoming = emergencies.map((em) => ({
      ...em,
      photoUrl: em.photoPath ? photoUrl(em.id) : null,
    }));

    res.json({ incoming });
  }
);

// ── POST /hospital/emergencies/:id/approve ────────────────────────────────────
hospitalRouter.post(
  "/emergencies/:id/approve",
  ...guardHospitalAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { hospitalId } = authReq.user;
    if (!hospitalId) { res.status(403).json({ error: "No hospital associated" }); return; }

    try {
      const emergency = await emergencyService.hospitalApprove(p(req.params.id), authReq.user.sub, hospitalId);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404
          : err.code === "WRONG_HOSPITAL" ? 403
          : err.code === "NO_BEDS_AVAILABLE" ? 409 : 409;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── POST /hospital/emergencies/:id/reject ─────────────────────────────────────
hospitalRouter.post(
  "/emergencies/:id/reject",
  ...guardHospitalAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { hospitalId } = authReq.user;
    if (!hospitalId) { res.status(403).json({ error: "No hospital associated" }); return; }

    try {
      const emergency = await emergencyService.hospitalReject(p(req.params.id), authReq.user.sub, hospitalId);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404
          : err.code === "WRONG_HOSPITAL" ? 403 : 409;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── POST /hospital/emergencies/:id/revoke ────────────────────────────────────
hospitalRouter.post(
  "/emergencies/:id/revoke",
  ...guardHospitalAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { hospitalId } = authReq.user;
    if (!hospitalId) { res.status(403).json({ error: "No hospital associated" }); return; }

    try {
      const emergency = await emergencyService.hospitalRevoke(p(req.params.id), authReq.user.sub, hospitalId);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404
          : err.code === "WRONG_HOSPITAL" ? 403 : 409;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── POST /hospital/emergencies/:id/confirm-handover ──────────────────────────
hospitalRouter.post(
  "/emergencies/:id/confirm-handover",
  ...guardHospitalAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { hospitalId } = authReq.user;
    if (!hospitalId) { res.status(403).json({ error: "No hospital associated" }); return; }

    try {
      const emergency = await emergencyService.confirmHandover(p(req.params.id), authReq.user.sub, hospitalId);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404
          : err.code === "WRONG_HOSPITAL" ? 403 : 409;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── PATCH /hospital/beds ──────────────────────────────────────────────────────
const bedsSchema = z.object({
  availableBeds: z.number().int().min(0),
});

hospitalRouter.patch(
  "/beds",
  ...guardHospitalAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { hospitalId } = authReq.user;
    if (!hospitalId) { res.status(403).json({ error: "No hospital associated" }); return; }

    const parsed = bedsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    const hospital = await prisma.hospital.update({
      where: { id: hospitalId },
      data: { availableBeds: parsed.data.availableBeds },
    });

    res.json({ hospital });
  }
);

// ── GET /hospital/me ──────────────────────────────────────────────────────────
hospitalRouter.get(
  "/me",
  ...guardHospitalAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { hospitalId } = authReq.user;
    if (!hospitalId) { res.status(403).json({ error: "No hospital associated" }); return; }

    const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
    if (!hospital) { res.status(404).json({ error: "Hospital not found" }); return; }

    res.json({ hospital });
  }
);
