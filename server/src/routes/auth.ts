import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { signAccessToken } from "../lib/jwt";
import { authenticate } from "../middleware/authenticate";
import { env } from "../config/env";

export const authRouter = Router();

// ─── Rate limiter: 5 login attempts / minute / IP (spec section 12) ──────────
const loginLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_RATE_LIMIT_MAX,
  message: { error: "Too many login attempts, please try again in a minute." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────
const loginSchema = z.object({
  username: z.string().min(1, "username required"),
  password: z.string().min(1, "password required"),
});

const refreshSchema = z.object({
  refreshToken: z.string().uuid("refreshToken must be a UUID"),
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });

  // Use constant-time comparison path even when user is not found
  // to avoid username enumeration via timing
  const hash = user?.passwordHash ?? "$2a$10$invalidhashpadding00000000000000000000";
  const valid = await verifyPassword(password, hash);

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!user.active) {
    res.status(403).json({ error: "Account has been deactivated" });
    return;
  }

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    hospitalId: user.hospitalId ?? undefined,
  });

  const refreshToken = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt },
  });

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      hospitalId: user.hospitalId,
    },
  });
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: parsed.data.refreshToken },
    include: { user: { select: { id: true, role: true, hospitalId: true, active: true } } },
  });

  if (!stored || stored.expiresAt < new Date()) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  if (!stored.user.active) {
    // Wipe the token on the way out
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    res.status(403).json({ error: "Account has been deactivated" });
    return;
  }

  // Rotate: delete old token, create new one atomically
  const newRefreshToken = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.delete({ where: { id: stored.id } }),
    prisma.refreshToken.create({
      data: { token: newRefreshToken, userId: stored.user.id, expiresAt },
    }),
  ]);

  const accessToken = signAccessToken({
    sub: stored.user.id,
    role: stored.user.role,
    hospitalId: stored.user.hospitalId ?? undefined,
  });

  res.json({ accessToken, refreshToken: newRefreshToken });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
authRouter.post("/logout", authenticate, async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };

  if (refreshToken) {
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken, userId: req.user!.sub },
    });
  }

  res.json({ ok: true });
});

// ─── GET /auth/me — current user info (used in tests and client bootstrap) ───
authRouter.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});
