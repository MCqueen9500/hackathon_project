import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/password";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";

export const driversRouter = Router();

// All routes on this router require HOSPITAL_ADMIN (spec section 4)
driversRouter.use(authenticate, requireRole("HOSPITAL_ADMIN"));

// ─── Zod schemas ─────────────────────────────────────────────────────────────
const createDriverSchema = z.object({
  name: z.string().min(1, "name required"),
  username: z
    .string()
    .min(3)
    .regex(/^[a-z0-9_]+$/, "username: lowercase letters, numbers, underscores only"),
  password: z.string().min(8, "password must be at least 8 characters"),
  ambulanceNo: z.string().min(1, "ambulanceNo required"),
});

const patchDriverSchema = z
  .object({
    active: z.boolean().optional(),
    name: z.string().min(1).optional(),
    ambulanceNo: z.string().min(1).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

// ─── POST /hospital/drivers — register a new driver for own hospital ──────────
driversRouter.post("/", async (req, res) => {
  const hospitalId = req.user!.hospitalId;
  if (!hospitalId) {
    res.status(403).json({ error: "No hospital associated with this admin" });
    return;
  }

  const parsed = createDriverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  const { name, username, password, ambulanceNo } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await hashPassword(password);

  const driver = await prisma.user.create({
    data: { name, username, passwordHash, role: "DRIVER", hospitalId, ambulanceNo },
    select: { id: true, name: true, username: true, ambulanceNo: true, active: true, createdAt: true },
  });

  res.status(201).json(driver);
});

// ─── GET /hospital/drivers — list own hospital's drivers ──────────────────────
driversRouter.get("/", async (req, res) => {
  const hospitalId = req.user!.hospitalId;
  if (!hospitalId) {
    res.status(403).json({ error: "No hospital associated with this admin" });
    return;
  }

  const drivers = await prisma.user.findMany({
    where: { hospitalId, role: "DRIVER" },
    select: { id: true, name: true, username: true, ambulanceNo: true, active: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  res.json(drivers);
});

// ─── PATCH /hospital/drivers/:id — deactivate / update (own hospital only) ───
driversRouter.patch("/:id", async (req, res) => {
  const hospitalId = req.user!.hospitalId;
  if (!hospitalId) {
    res.status(403).json({ error: "No hospital associated with this admin" });
    return;
  }

  const parsed = patchDriverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  // Ownership check: driver must belong to THIS hospital
  // Per spec section 4: "Return 403, not 404, for forbidden resources."
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { hospitalId: true, role: true },
  });

  if (!target) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }

  if (target.role !== "DRIVER") {
    res.status(400).json({ error: "User is not a driver" });
    return;
  }

  if (target.hospitalId !== hospitalId) {
    res.status(403).json({ error: "Forbidden: driver belongs to a different hospital" });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: parsed.data,
    select: { id: true, name: true, username: true, ambulanceNo: true, active: true, createdAt: true },
  });

  // Deactivation is immediate: wipe all refresh tokens so existing sessions die
  if (parsed.data.active === false) {
    await prisma.refreshToken.deleteMany({ where: { userId: req.params.id } });
  }

  res.json(updated);
});
