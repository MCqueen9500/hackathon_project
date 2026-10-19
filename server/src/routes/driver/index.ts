/**
 * routes/driver/index.ts
 *
 * Driver endpoints (spec section 8):
 *   GET  /hospitals/candidates?lat&lng&severity
 *   POST /emergencies                  (multipart, Idempotency-Key header)
 *   GET  /emergencies/active
 *   GET  /emergencies/:id
 *   POST /emergencies/:id/arrived
 *   POST /emergencies/:id/cancel
 *   POST /emergencies/:id/location
 *   GET  /uploads/:filename            (served to authed police/hospital/owning driver)
 *
 * All status mutations go through EmergencyService (spec rule 1).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { photoUpload, UPLOAD_DIR } from "../../lib/upload";
import { emergencyService } from "../../services/instances";
import { EmergencyError } from "../../errors/EmergencyError";
import { getIO } from "../../lib/socket";
import type { AuthenticatedRequest } from "../../types";
import { resolve } from "path";
import { existsSync } from "fs";

export const driverRouter = Router();

const guardDriver = [authenticate, requireRole("DRIVER")];

/** Express params can technically be string[], but Express always gives string for named params */
const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const candidatesQuerySchema = z.object({
  lat:      z.coerce.number().min(-90).max(90),
  lng:      z.coerce.number().min(-180).max(180),
  severity: z.enum(["CRITICAL", "SERIOUS", "STABLE"]).optional(),
});

const createEmergencySchema = z.object({
  severity:    z.enum(["CRITICAL", "SERIOUS", "STABLE"]),
  originLat:   z.coerce.number().min(-90).max(90),
  originLng:   z.coerce.number().min(-180).max(180),
  note:        z.string().max(500).optional(),
  city:        z.string().max(100).optional(),
});

const locationSchema = z.object({
  lat:       z.coerce.number().min(-90).max(90),
  lng:       z.coerce.number().min(-180).max(180),
  speed:     z.coerce.number().optional(),
  heading:   z.coerce.number().min(0).max(360).optional(),
  accuracy:  z.coerce.number().optional(),
  source:    z.enum(["GPS", "SIMULATOR"]).default("GPS"),
  recordedAt: z.coerce.date().optional(),
});

// ── GET /hospitals/candidates ─────────────────────────────────────────────────
driverRouter.get(
  "/hospitals/candidates",
  ...guardDriver,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = candidatesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    const { lat, lng } = parsed.data;

    const hospitals = await prisma.hospital.findMany({
      where: { availableBeds: { gt: 0 } },
      select: { id: true, name: true, lat: true, lng: true, availableBeds: true, specialties: true, city: true },
    });

    // Use straight-line for candidates listing (routing happens on create)
    const { StraightLineRankingProvider } = await import("../../services/ranking/StraightLineRankingProvider");
    const ranking = new StraightLineRankingProvider();
    const ranked = await ranking.rank(lat, lng, hospitals);

    // Return top 5 enriched with hospital details
    const results = ranked.slice(0, 5).map((r) => {
      const h = hospitals.find((h) => h.id === r.hospitalId)!;
      return {
        hospitalId:     r.hospitalId,
        name:           h.name,
        city:           h.city,
        availableBeds:  h.availableBeds,
        specialties:    h.specialties,
        distanceMeters: r.distanceMeters,
        etaSeconds:     r.etaSeconds,
      };
    });

    res.json({ candidates: results });
  }
);

// ── POST /emergencies — create emergency with photo ───────────────────────────
driverRouter.post(
  "/emergencies",
  ...guardDriver,
  photoUpload.single("photo"),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

    if (!idempotencyKey) {
      res.status(400).json({ error: "Idempotency-Key header is required" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "Photo is required (image/* only, max 5 MB)" });
      return;
    }

    const parsed = createEmergencySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    try {
      const emergency = await emergencyService.create({
        driverId:       authReq.user.sub,
        severity:       parsed.data.severity,
        originLat:      parsed.data.originLat,
        originLng:      parsed.data.originLng,
        photoPath:      `/uploads/${req.file.filename}`,
        note:           parsed.data.note,
        city:           parsed.data.city,
        idempotencyKey,
      });

      res.status(201).json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        res.status(409).json({ error: err.message, code: err.code });
      } else {
        throw err;
      }
    }
  }
);

// ── GET /emergencies/active — driver's currently active emergency ─────────────
driverRouter.get(
  "/emergencies/active",
  ...guardDriver,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    const emergency = await prisma.emergency.findFirst({
      where: {
        driverId: authReq.user.sub,
        status: { in: ["PENDING_APPROVALS", "ACTIVE", "ARRIVED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!emergency) {
      res.status(404).json({ error: "No active emergency" });
      return;
    }
    res.json({ emergency });
  }
);

// ── GET /emergencies/:id ──────────────────────────────────────────────────────
driverRouter.get(
  "/emergencies/:id",
  ...guardDriver,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const emergency = await prisma.emergency.findUnique({ where: { id: p(req.params.id) } });

    if (!emergency) {
      res.status(404).json({ error: "Emergency not found" });
      return;
    }

    // Ownership check: driver can only see own emergencies
    if (emergency.driverId !== authReq.user.sub) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json({ emergency });
  }
);

// ── POST /emergencies/:id/arrived ─────────────────────────────────────────────
driverRouter.post(
  "/emergencies/:id/arrived",
  ...guardDriver,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
      const emergency = await emergencyService.arrived(p(req.params.id), authReq.user.sub);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404
          : err.code === "INVALID_TRANSITION" ? 409 : 403;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── POST /emergencies/:id/cancel ─────────────────────────────────────────────
driverRouter.post(
  "/emergencies/:id/cancel",
  ...guardDriver,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
      const emergency = await emergencyService.cancel(p(req.params.id), authReq.user.sub);
      res.json({ emergency });
    } catch (err) {
      if (err instanceof EmergencyError) {
        const status = err.code === "EMERGENCY_NOT_FOUND" ? 404 : 409;
        res.status(status).json({ error: err.message, code: err.code });
      } else { throw err; }
    }
  }
);

// ── POST /emergencies/:id/location ─────────────────────────────────────────────
driverRouter.post(
  "/emergencies/:id/location",
  ...guardDriver,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    // Verify ownership
    const emergency = await prisma.emergency.findUnique({
      where: { id: p(req.params.id) },
      select: { driverId: true, status: true },
    });
    if (!emergency) { res.status(404).json({ error: "Emergency not found" }); return; }
    if (emergency.driverId !== authReq.user.sub) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!["ACTIVE", "ARRIVED"].includes(emergency.status)) {
      res.status(409).json({ error: "Emergency is not active" }); return;
    }

    const ping = await prisma.locationPing.create({
      data: {
        emergencyId: p(req.params.id),
        lat:         parsed.data.lat,
        lng:         parsed.data.lng,
        speed:       parsed.data.speed,
        heading:     parsed.data.heading,
        accuracy:    parsed.data.accuracy,
        source:      parsed.data.source,
        recordedAt:  parsed.data.recordedAt ?? new Date(),
      },
    });

    // Broadcast location update to emergency room + police
    try {
      const io = getIO();
      io.to(`emergency:${p(req.params.id)}`).emit("location:update", ping);
      io.to("role:POLICE").emit("location:update", ping);
    } catch { /* Socket not init in tests */ }

    res.status(201).json({ ping });
  }
);

// ── GET /uploads/:filename — serve photos to authenticated users only ─────────
// Accessible by: owning driver, any POLICE, any HOSPITAL_ADMIN
driverRouter.get(
  "/uploads/:filename",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const { filename } = req.params;
    const safeFilename = p(filename);

    // Basic path traversal guard
    if (safeFilename.includes("..") || safeFilename.includes("/")) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const filePath = resolve(UPLOAD_DIR, safeFilename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    // Ownership: DRIVER can only see their own photos
    if (authReq.user.role === "DRIVER") {
      const emergency = await prisma.emergency.findFirst({
        where: { driverId: authReq.user.sub, photoPath: { contains: safeFilename } },
        select: { id: true },
      });
      if (!emergency) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    res.sendFile(filePath);
  }
);
