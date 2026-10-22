/**
 * routes/admin/hospitals.ts
 *
 * Platform ADMIN hospital management endpoints (SPEC §17.1, §17.2):
 *   GET  /admin/hospitals                  — list all hospitals (incl. non-onboarded)
 *   GET  /admin/hospitals/osm              — fetch OSM candidates from Overpass
 *   POST /admin/hospitals                  — onboard a hospital + create first HOSPITAL_ADMIN
 *   PATCH /admin/hospitals/:id             — update beds/specialties/active/mode
 *   POST /admin/hospitals/:id/accounts     — add another HOSPITAL_ADMIN account
 *   POST /admin/hospitals/:id/accounts/:uid/reset-password — reset password (returned once)
 *   PATCH /admin/hospitals/:id/accounts/:uid — deactivate/reactivate account
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { hashPassword } from "../../lib/password";
import type { AuthenticatedRequest } from "../../types";
import { env } from "../../config/env";

export const adminHospitalsRouter = Router();
const guard = [authenticate, requireRole("ADMIN")];
const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

// ── Specialty options ────────────────────────────────────────────────────────
const VALID_SPECIALTIES = ["TRAUMA", "CARDIAC", "PEDIATRIC", "NEURO", "BURNS", "ORTHO"];

// ── GET /admin/hospitals ──────────────────────────────────────────────────────
// Returns ALL hospitals with onboarding status and account count.
adminHospitalsRouter.get(
  "/",
  ...guard,
  async (_req: Request, res: Response): Promise<void> => {
    const hospitals = await prisma.hospital.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        users: {
          where: { role: "HOSPITAL_ADMIN" },
          select: { id: true, name: true, username: true, active: true, createdAt: true },
        },
      },
    });
    res.json({ hospitals });
  }
);

// ── GET /admin/hospitals/osm — query Overpass for nearby hospitals ────────────
adminHospitalsRouter.get(
  "/osm",
  ...guard,
  async (_req: Request, res: Response): Promise<void> => {
    const { DEMO_CENTER_LAT: lat, DEMO_CENTER_LNG: lng, DEMO_RADIUS_KM: radiusKm } = env;
    const radiusM = radiusKm * 1000;

    const query = `
[out:json][timeout:60];
(
  node["amenity"="hospital"](around:${radiusM},${lat},${lng});
  way["amenity"="hospital"](around:${radiusM},${lat},${lng});
  relation["amenity"="hospital"](around:${radiusM},${lat},${lng});
);
out center;
`;

    const OVERPASS = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];

    interface OsmEl {
      id: number; type: string;
      lat?: number; lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }

    let elements: OsmEl[] = [];
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json() as { elements: OsmEl[] };
        elements = json.elements;
        break;
      } catch { /* try next */ }
    }

    // Get osmIds already in DB so UI can mark them
    const existing = await prisma.hospital.findMany({
      where: { osmId: { not: null } },
      select: { osmId: true, onboarded: true, id: true },
    });
    const existingMap = new Map(existing.map((h) => [h.osmId!, h]));

    const candidates = elements
      .map((el) => {
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (!elLat || !elLng) return null;
        const osmId = String(el.id);
        const inDb = existingMap.get(osmId);
        return {
          osmId,
          name: el.tags?.name ?? el.tags?.["name:en"] ?? "Unnamed Hospital",
          lat: elLat,
          lng: elLng,
          alreadyImported: !!inDb,
          onboarded: inDb?.onboarded ?? false,
          hospitalId: inDb?.id ?? null,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    res.json({ candidates, center: { lat, lng }, radiusKm });
  }
);

// ── POST /admin/hospitals — onboard a hospital ────────────────────────────────
const onboardSchema = z.object({
  name:              z.string().min(1).max(200),
  lat:               z.coerce.number().min(-90).max(90),
  lng:               z.coerce.number().min(-180).max(180),
  totalEmergencyBeds: z.coerce.number().int().min(0).default(5),
  specialties:       z.array(z.string()).default([]),
  mode:              z.enum(["LIVE", "DEMO_AUTO"]).default("LIVE"),
  osmId:             z.string().optional(),
  // First admin account (optional for DEMO_AUTO)
  adminUsername:     z.string().min(2).max(50).optional(),
  adminName:         z.string().min(1).max(100).optional(),
  adminPassword:     z.string().min(6).max(100).optional(),
});

adminHospitalsRouter.post(
  "/",
  ...guard,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const parsed = onboardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;

    // Dedup by osmId
    if (d.osmId) {
      const exists = await prisma.hospital.findUnique({ where: { osmId: d.osmId } });
      if (exists) {
        // If already exists but not onboarded, onboard it now
        if (!exists.onboarded) {
          const updated = await prisma.hospital.update({
            where: { id: exists.id },
            data: {
              name: d.name,
              totalEmergencyBeds: d.totalEmergencyBeds,
              availableBeds: d.totalEmergencyBeds,
              specialties: d.specialties,
              mode: d.mode,
              onboarded: true,
            },
            include: { users: { where: { role: "HOSPITAL_ADMIN" } } },
          });
          let adminResult: { username: string; password: string } | null = null;
          if (d.adminUsername && d.adminPassword) {
            const hash = await hashPassword(d.adminPassword);
            const user = await prisma.user.create({
              data: {
                name: d.adminName ?? d.adminUsername,
                username: d.adminUsername,
                passwordHash: hash,
                role: "HOSPITAL_ADMIN",
                hospitalId: exists.id,
              },
            });
            adminResult = { username: user.username, password: d.adminPassword };
          }
          await prisma.auditLog.create({ data: {
            actorId: authReq.user.sub, action: "HOSPITAL_ONBOARDED",
            entityType: "Hospital", entityId: exists.id,
            payload: { mode: d.mode, osmId: d.osmId },
          }});
          res.status(201).json({ hospital: updated, admin: adminResult });
          return;
        }
        res.status(409).json({ error: "Hospital with this osmId is already onboarded" });
        return;
      }
    }

    // Check username uniqueness
    if (d.adminUsername) {
      const userExists = await prisma.user.findUnique({ where: { username: d.adminUsername } });
      if (userExists) {
        res.status(409).json({ error: `Username '${d.adminUsername}' is already taken` });
        return;
      }
    }

    // Create hospital
    const hospital = await prisma.hospital.create({
      data: {
        name: d.name,
        lat: d.lat,
        lng: d.lng,
        city: "Demo City",
        specialties: d.specialties,
        totalEmergencyBeds: d.totalEmergencyBeds,
        availableBeds: d.totalEmergencyBeds,
        mode: d.mode,
        onboarded: true,
        osmId: d.osmId ?? null,
      },
    });

    // Create first admin account if provided
    let adminResult: { username: string; password: string } | null = null;
    if (d.adminUsername && d.adminPassword) {
      const hash = await hashPassword(d.adminPassword);
      const user = await prisma.user.create({
        data: {
          name: d.adminName ?? d.adminUsername,
          username: d.adminUsername,
          passwordHash: hash,
          role: "HOSPITAL_ADMIN",
          hospitalId: hospital.id,
        },
      });
      adminResult = { username: user.username, password: d.adminPassword };
    }

    await prisma.auditLog.create({ data: {
      actorId: authReq.user.sub, action: "HOSPITAL_ONBOARDED",
      entityType: "Hospital", entityId: hospital.id,
      payload: { mode: d.mode, osmId: d.osmId ?? null },
    }});

    const full = await prisma.hospital.findUnique({
      where: { id: hospital.id },
      include: { users: { where: { role: "HOSPITAL_ADMIN" } } },
    });
    res.status(201).json({ hospital: full, admin: adminResult });
  }
);

// ── PATCH /admin/hospitals/:id — update hospital ──────────────────────────────
const updateHospitalSchema = z.object({
  name:               z.string().min(1).max(200).optional(),
  totalEmergencyBeds: z.coerce.number().int().min(0).optional(),
  availableBeds:      z.coerce.number().int().min(0).optional(),
  specialties:        z.array(z.string()).optional(),
  active:             z.boolean().optional(),
  mode:               z.enum(["LIVE", "DEMO_AUTO"]).optional(),
});

adminHospitalsRouter.patch(
  "/:id",
  ...guard,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const hospitalId = p(req.params.id);
    const parsed = updateHospitalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
    if (!hospital) { res.status(404).json({ error: "Hospital not found" }); return; }

    const updated = await prisma.hospital.update({
      where: { id: hospitalId },
      data: parsed.data,
      include: { users: { where: { role: "HOSPITAL_ADMIN" }, select: { id: true, name: true, username: true, active: true } } },
    });

    await prisma.auditLog.create({ data: {
      actorId: authReq.user.sub, action: "HOSPITAL_UPDATED",
      entityType: "Hospital", entityId: hospitalId,
      payload: parsed.data as Record<string, unknown>,
    }});

    res.json({ hospital: updated });
  }
);

// ── POST /admin/hospitals/:id/accounts — add admin account ───────────────────
const addAccountSchema = z.object({
  name:     z.string().min(1).max(100),
  username: z.string().min(2).max(50),
  password: z.string().min(6).max(100),
});

adminHospitalsRouter.post(
  "/:id/accounts",
  ...guard,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const hospitalId = p(req.params.id);
    const parsed = addAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
    if (!hospital) { res.status(404).json({ error: "Hospital not found" }); return; }

    const userExists = await prisma.user.findUnique({ where: { username: parsed.data.username } });
    if (userExists) {
      res.status(409).json({ error: `Username '${parsed.data.username}' is already taken` });
      return;
    }

    const hash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        username: parsed.data.username,
        passwordHash: hash,
        role: "HOSPITAL_ADMIN",
        hospitalId,
      },
    });

    await prisma.auditLog.create({ data: {
      actorId: authReq.user.sub, action: "HOSPITAL_ACCOUNT_ADDED",
      entityType: "User", entityId: user.id,
      payload: { hospitalId, username: user.username },
    }});

    res.status(201).json({
      user: { id: user.id, name: user.name, username: user.username, active: user.active },
      password: parsed.data.password, // shown once
    });
  }
);

// ── POST /admin/hospitals/:id/accounts/:uid/reset-password ───────────────────
const resetPwSchema = z.object({
  password: z.string().min(6).max(100),
});

adminHospitalsRouter.post(
  "/:id/accounts/:uid/reset-password",
  ...guard,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const hospitalId = p(req.params.id);
    const userId = p(req.params.uid);
    const parsed = resetPwSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, hospitalId, role: "HOSPITAL_ADMIN" },
    });
    if (!user) { res.status(404).json({ error: "Account not found" }); return; }

    const hash = await hashPassword(parsed.data.password);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    // Invalidate all refresh tokens
    await prisma.refreshToken.deleteMany({ where: { userId } });

    await prisma.auditLog.create({ data: {
      actorId: authReq.user.sub, action: "HOSPITAL_PASSWORD_RESET",
      entityType: "User", entityId: userId,
      payload: { hospitalId },
    }});

    res.json({ ok: true, password: parsed.data.password }); // shown once
  }
);

// ── PATCH /admin/hospitals/:id/accounts/:uid — activate/deactivate ───────────
adminHospitalsRouter.patch(
  "/:id/accounts/:uid",
  ...guard,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const hospitalId = p(req.params.id);
    const userId = p(req.params.uid);
    const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error" });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, hospitalId, role: "HOSPITAL_ADMIN" },
    });
    if (!user) { res.status(404).json({ error: "Account not found" }); return; }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { active: parsed.data.active },
      select: { id: true, name: true, username: true, active: true },
    });

    if (!parsed.data.active) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
    }

    await prisma.auditLog.create({ data: {
      actorId: authReq.user.sub,
      action: parsed.data.active ? "HOSPITAL_ACCOUNT_ACTIVATED" : "HOSPITAL_ACCOUNT_DEACTIVATED",
      entityType: "User", entityId: userId,
      payload: { hospitalId },
    }});

    res.json({ user: updated });
  }
);
