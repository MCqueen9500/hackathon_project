/**
 * routes/photos/index.ts
 *
 * Spec §17.4 — Signed photo serving
 *
 * GET /photos/:emergencyId?token=<HMAC-signed, 5-minute expiry>
 *
 * Authorization (checked after token validity):
 *   ✅ Any POLICE officer
 *   ✅ The owning driver (driverId === sub)
 *   ✅ The selected hospital's HOSPITAL_ADMIN
 *   ✅ ADMIN role
 *   ❌ A different hospital's admin → 403
 *   ❌ Expired token            → 403
 *   ❌ Invalid/missing token    → 403
 *
 * Security headers:
 *   Cross-Origin-Resource-Policy: cross-origin   (allows cross-origin <img> loads)
 */

import { Router, Request, Response } from "express";
import { resolve } from "path";
import { existsSync } from "fs";
import { prisma } from "../../lib/prisma";
import { verifyPhotoToken } from "../../lib/photoToken";
import { authenticate } from "../../middleware/authenticate";
import { UPLOAD_DIR } from "../../lib/upload";
import type { AuthenticatedRequest } from "../../types";

export const photosRouter = Router();

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

photosRouter.get(
  "/:emergencyId",
  // 1. Verify bearer JWT (must be a logged-in user)
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq      = req as AuthenticatedRequest;
    const emergencyId  = p(req.params.emergencyId);
    const token        = typeof req.query.token === "string" ? req.query.token : "";

    // ── 2. Verify HMAC token ──────────────────────────────────────────────────
    const result = verifyPhotoToken(token, emergencyId);
    if (!result.ok) {
      res.status(403).json({
        error: result.reason === "EXPIRED" ? "Photo token expired" : "Invalid photo token",
        code:  result.reason,
      });
      return;
    }

    // ── 3. Fetch emergency to authorise the viewer and find the file ──────────
    const emergency = await prisma.emergency.findUnique({
      where:  { id: emergencyId },
      select: { driverId: true, selectedHospitalId: true, photoPath: true },
    });

    if (!emergency) {
      res.status(404).json({ error: "Emergency not found" });
      return;
    }

    if (!emergency.photoPath) {
      res.status(404).json({ error: "No photo for this emergency" });
      return;
    }

    // ── 4. Role-based access check ────────────────────────────────────────────
    const { role, sub, hospitalId } = authReq.user;

    const allowed =
      role === "POLICE" ||
      (role === "DRIVER"         && sub        === emergency.driverId)          ||
      (role === "HOSPITAL_ADMIN" && hospitalId === emergency.selectedHospitalId);

    if (!allowed) {
      res.status(403).json({ error: "Forbidden: you are not authorised to view this photo" });
      return;
    }

    // ── 5. Resolve & serve the file ───────────────────────────────────────────
    // photoPath is stored as "/uploads/<uuid>.ext"
    const filename = emergency.photoPath.replace(/^\/uploads\//, "").replace(/^uploads\//, "");

    // Path traversal guard
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      res.status(400).json({ error: "Invalid photo path" });
      return;
    }

    const filePath = resolve(UPLOAD_DIR, filename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: "Photo file not found on disk" });
      return;
    }

    // Spec §17.4: Cross-Origin-Resource-Policy: cross-origin so browsers allow
    // cross-origin <img> tags to render the response
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    // Prevent caching of access-controlled files
    res.setHeader("Cache-Control", "private, no-store");

    res.sendFile(filePath);
  }
);
