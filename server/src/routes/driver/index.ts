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
import { photoUrl as signedPhotoUrl } from "../../lib/photoToken";
import { emergencyService } from "../../services/instances";
import { EmergencyError } from "../../errors/EmergencyError";
import { getIO } from "../../lib/socket";
import { signalController } from "../../services/signals/SimulatedSignalController";
import { haversineMeters } from "../../services/ranking/StraightLineRankingProvider";
import { getAvoidPolygons, rerouteEmergency } from "../../services/ClosureService";
import type { AuthenticatedRequest } from "../../types";
import { resolve } from "path";
import { existsSync } from "fs";
import { env } from "../../config/env";

export const driverRouter = Router();

const guardDriver = [authenticate, requireRole("DRIVER")];

/** Express params can technically be string[], but Express always gives string for named params */
const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

/**
 * Deviation tracker: counts consecutive pings that are >60 m from the route.
 * Keyed by emergencyId. Resets to 0 when ping is within route.
 */
const deviationCounter = new Map<string, number>();

/**
 * Returns the minimum distance (metres) from point to any segment of the route polyline.
 */
function distToPolyline(lat: number, lng: number, coords: [number, number][]): number {
  if (coords.length === 0) return Infinity;
  let minDist = Infinity;
  for (const [cLng, cLat] of coords) {
    const d = haversineMeters(lat, lng, cLat, cLng);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

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

/** Drop NaN / non-finite GPS extras so a bad heading doesn't reject the ping. */
const optionalFinite = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}, z.number().optional());

const locationSchema = z.object({
  lat:        z.coerce.number().min(-90).max(90),
  lng:        z.coerce.number().min(-180).max(180),
  speed:      optionalFinite,
  heading:    optionalFinite,
  accuracy:   optionalFinite,
  source:     z.enum(["GPS", "SIMULATOR"]).default("GPS"),
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

    // Eligible: onboarded + active + beds > 0 + (DEMO_AUTO or active HOSPITAL_ADMIN)
    const hospitals = await prisma.hospital.findMany({
      where: {
        onboarded: true,
        active: true,
        availableBeds: { gt: 0 },
        OR: [
          { mode: "DEMO_AUTO" },
          { users: { some: { role: "HOSPITAL_ADMIN", active: true } } },
        ],
      },
      select: { id: true, name: true, lat: true, lng: true, availableBeds: true, specialties: true, city: true, mode: true },
    });

    // Use OrsRankingProvider (routed ETA, with OSRM fallback) for candidate listing
    const { OrsRankingProvider } = await import("../../services/ranking/OrsRankingProvider");
    const ranking = new OrsRankingProvider();
    const ranked = await ranking.rank(lat, lng, hospitals);

    // Return top 5 enriched with hospital details, sorted by routed ETA
    const results = ranked.slice(0, 5).map((r) => {
      const h = hospitals.find((h) => h.id === r.hospitalId)!;
      return {
        id:             r.hospitalId,
        hospitalId:     r.hospitalId,
        name:           h.name,
        city:           h.city,
        lat:            h.lat,
        lng:            h.lng,
        availableBeds:  h.availableBeds,
        specialties:    h.specialties,
        mode:           h.mode,       // "LIVE" | "DEMO_AUTO"
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
    res.json({
      emergency: {
        ...emergency,
        photoUrl: emergency.photoPath ? signedPhotoUrl(emergency.id) : null,
      },
    });
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

    res.json({
      emergency: {
        ...emergency,
        photoUrl: emergency.photoPath ? signedPhotoUrl(emergency.id) : null,
      },
    });
  }
);

// ── POST /emergencies/:id/arrived ─────────────────────────────────────────────
driverRouter.post(
  "/emergencies/:id/arrived",
  ...guardDriver,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const emergencyId = p(req.params.id);
    try {
      const emergency = await emergencyService.arrived(emergencyId, authReq.user.sub);
      signalController.releaseAll(emergencyId); // restore normal signal cycle
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
    const emergencyId = p(req.params.id);
    try {
      const emergency = await emergencyService.cancel(emergencyId, authReq.user.sub);
      signalController.releaseAll(emergencyId); // restore normal signal cycle
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

    const emergencyId = p(req.params.id);

    // Verify ownership and status
    const emergency = await prisma.emergency.findUnique({
      where: { id: emergencyId },
      select: {
        driverId: true, status: true, severity: true, createdAt: true,
        selectedHospitalId: true, routeGeoJson: true,
        selectedHospital: { select: { lat: true, lng: true } },
      },
    });
    if (!emergency) { res.status(404).json({ error: "Emergency not found" }); return; }
    if (emergency.driverId !== authReq.user.sub) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!["PENDING_APPROVALS", "ACTIVE", "ARRIVED"].includes(emergency.status)) {
      res.status(409).json({ error: "Emergency is not active" }); return;
    }

    // Drop GPS readings worse than GPS_MAX_ACCURACY_M (simulator pings are exempt)
    const accuracy = parsed.data.accuracy;
    if (
      parsed.data.source === "GPS" &&
      accuracy !== undefined &&
      accuracy > env.GPS_MAX_ACCURACY_M
    ) {
      res.status(200).json({ ok: true, reason: "low-accuracy" });
      return;
    }

    // ── Out-of-order rejection ─────────────────────────────────────────────
    const recordedAt = parsed.data.recordedAt ?? new Date();
    const latestPing = await prisma.locationPing.findFirst({
      where: { emergencyId },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true },
    });
    if (latestPing && recordedAt < latestPing.recordedAt) {
      // Silently accept but don't store (idempotent for duplicate pings)
      res.status(200).json({ ok: true, reason: "out-of-order" });
      return;
    }

    const ping = await prisma.locationPing.create({
      data: {
        emergencyId,
        lat:         parsed.data.lat,
        lng:         parsed.data.lng,
        speed:       parsed.data.speed,
        heading:     parsed.data.heading,
        accuracy:    parsed.data.accuracy,
        source:      parsed.data.source,
        recordedAt,
      },
    });

    // ── Green-wave signal update (ACTIVE emergencies only) ─────────────────
    if (emergency.status === "ACTIVE") {
      const route = emergency.routeGeoJson as { type: string; coordinates: [number, number][] } | null;
      const coords = route?.coordinates ?? [];
      signalController.applyGreenWave(
        parsed.data.lat,
        parsed.data.lng,
        coords,
        emergencyId,
        emergency.severity as "CRITICAL" | "SERIOUS" | "STABLE",
        emergency.createdAt
      );

      // ── Deviation detection (spec section 10): N consecutive >Xm → reroute ─
      const distFromRoute = distToPolyline(parsed.data.lat, parsed.data.lng, coords);
      if (distFromRoute > env.DEVIATION_THRESHOLD_M) {
        const consecutive = (deviationCounter.get(emergencyId) ?? 0) + 1;
        deviationCounter.set(emergencyId, consecutive);
        if (consecutive >= env.DEVIATION_CONSECUTIVE_N) {
          deviationCounter.set(emergencyId, 0); // reset
          console.info(`[Driver] Deviation detected (${distFromRoute.toFixed(0)}m) on emergency ${emergencyId} — rerouting`);
          const emFull = await prisma.emergency.findUnique({
            where: { id: emergencyId },
            select: {
              id: true, driverId: true, selectedHospitalId: true,
              originLat: true, originLng: true,
              selectedHospital: { select: { lat: true, lng: true } },
            },
          });
          if (emFull?.selectedHospital) {
            const avoidPolygons = await getAvoidPolygons();
            void rerouteEmergency(
              { ...emFull, originLat: parsed.data.lat, originLng: parsed.data.lng },
              avoidPolygons
            );
          }
        }
      } else {
        deviationCounter.set(emergencyId, 0); // on-route: reset counter
      }
    }

    // ── 50 m geofence → auto-mark ARRIVED ─────────────────────────────────
    if (emergency.status === "ACTIVE" && emergency.selectedHospital) {
      const dist = haversineMeters(
        parsed.data.lat, parsed.data.lng,
        emergency.selectedHospital.lat, emergency.selectedHospital.lng
      );
      if (dist <= 50) {
        try {
          await emergencyService.arrived(emergencyId, authReq.user.sub);
          signalController.releaseAll(emergencyId);
        } catch {
          // Already arrived or wrong state — ignore
        }
      }
    }

    // ── Broadcast location update ──────────────────────────────────────────
    try {
      const io = getIO();
      io.to(`emergency:${emergencyId}`).emit("location:update", ping);
      io.to(`driver:${emergency.driverId}`).emit("location:update", ping);
      io.to("role:POLICE").emit("location:update", ping);
      if (emergency.selectedHospitalId) {
        io.to(`hospital:${emergency.selectedHospitalId}`).emit("location:update", ping);
      }
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

// ── DEV ONLY: server-side simulator ──────────────────────────────────────────
// POST /dev/simulate/:id        { speedKmh: number }  — start
// POST /dev/simulate/:id/stop                         — stop
// Guarded by NODE_ENV !== "production"
if (env.NODE_ENV !== "production") {
  const simTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  const devSimSchema = z.object({ speedKmh: z.coerce.number().min(1).max(200).default(40) });

  driverRouter.post(
    "/dev/simulate/:id",
    authenticate,
    async (req: Request, res: Response): Promise<void> => {
      const emergencyId = p(req.params.id);
      const parsed = devSimSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
        return;
      }

      const em = await prisma.emergency.findUnique({
        where: { id: emergencyId },
        select: {
          status: true, driverId: true, severity: true, createdAt: true,
          routeGeoJson: true,
          selectedHospital: { select: { lat: true, lng: true } },
          selectedHospitalId: true,
        },
      });
      if (!em) { res.status(404).json({ error: "Emergency not found" }); return; }
      if (!["ACTIVE"].includes(em.status)) {
        res.status(409).json({ error: "Emergency must be ACTIVE to simulate" }); return;
      }

      const route = em.routeGeoJson as { type: string; coordinates: [number, number][] } | null;
      const coords = route?.coordinates ?? [];
      if (coords.length < 2) { res.status(400).json({ error: "No route coordinates" }); return; }

      // Stop any existing simulation
      if (simTimers.has(emergencyId)) {
        clearInterval(simTimers.get(emergencyId)!);
        simTimers.delete(emergencyId);
      }

      const speedMs = (parsed.data.speedKmh * 1000) / 3600; // m/s
      const TICK_MS = 1000;
      const stepM   = speedMs * (TICK_MS / 1000);

      let segIdx = 0;
      let segProgress = 0; // metres along current segment

      const tick = async () => {
        if (segIdx >= coords.length - 1) {
          clearInterval(simTimers.get(emergencyId)!);
          simTimers.delete(emergencyId);
          return;
        }

        const [lngA, latA] = coords[segIdx];
        const [lngB, latB] = coords[segIdx + 1];
        const segLen = haversineMeters(latA, lngA, latB, lngB);

        segProgress += stepM;
        while (segProgress >= segLen && segIdx < coords.length - 1) {
          segProgress -= segLen;
          segIdx++;
          if (segIdx >= coords.length - 1) break;
        }

        // Interpolate position along current segment
        const t = segLen > 0 ? Math.min(segProgress / segLen, 1) : 0;
        const [lngC, latC] = coords[segIdx];
        const [lngD, latD] = coords[Math.min(segIdx + 1, coords.length - 1)];
        const lat = latC + t * (latD - latC);
        const lng = lngC + t * (lngD - lngC);

        // Apply green-wave
        signalController.applyGreenWave(
          lat, lng, coords,
          emergencyId,
          em.severity as "CRITICAL" | "SERIOUS" | "STABLE",
          em.createdAt
        );

        // Create ping
        const ping = await prisma.locationPing.create({
          data: {
            emergencyId, lat, lng,
            speed: parsed.data.speedKmh,
            source: "SIMULATOR",
            recordedAt: new Date(),
          },
        }).catch(() => null);

        if (!ping) return;

        // Broadcast
        try {
          const io = getIO();
          io.to(`emergency:${emergencyId}`).emit("location:update", ping);
          io.to(`driver:${em.driverId}`).emit("location:update", ping);
          io.to("role:POLICE").emit("location:update", ping);
          if (em.selectedHospitalId) {
            io.to(`hospital:${em.selectedHospitalId}`).emit("location:update", ping);
          }
        } catch { /* ignore */ }

        // Geofence check
        if (em.selectedHospital) {
          const dist = haversineMeters(lat, lng, em.selectedHospital.lat, em.selectedHospital.lng);
          if (dist <= 50) {
            clearInterval(simTimers.get(emergencyId)!);
            simTimers.delete(emergencyId);
            try {
              await emergencyService.arrived(emergencyId, em.driverId);
              signalController.releaseAll(emergencyId);
            } catch { /* ignore */ }
          }
        }
      };

      const timer = setInterval(tick, TICK_MS);
      simTimers.set(emergencyId, timer);

      res.json({ ok: true, speedKmh: parsed.data.speedKmh, steps: coords.length });
    }
  );

  driverRouter.post(
    "/dev/simulate/:id/stop",
    authenticate,
    async (req: Request, res: Response): Promise<void> => {
      const emergencyId = p(req.params.id);
      if (simTimers.has(emergencyId)) {
        clearInterval(simTimers.get(emergencyId)!);
        simTimers.delete(emergencyId);
      }
      res.json({ ok: true });
    }
  );
}
