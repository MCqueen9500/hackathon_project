/**
 * deactivatedDriver.test.ts
 *
 * Proves (spec acceptance criterion c):
 *   - A deactivated driver cannot log in → 403
 *   - A deactivated driver cannot use an existing (valid) access token → 403
 *
 * Also tests refresh token rejection for a deactivated driver.
 *
 * Uses jest.mock for Prisma — no real DB connection required.
 */

import request from "supertest";

jest.mock("../lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

// Make bcrypt always return true so the route reaches the active check
jest.mock("../lib/password", () => ({
  hashPassword: jest.fn().mockResolvedValue("hashed"),
  verifyPassword: jest.fn().mockResolvedValue(true),
}));

import { createApp } from "../app";
import { signAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

const app = createApp();

const mockUserFindUnique    = prisma.user.findUnique    as jest.Mock;
const mockTokenFindUnique   = prisma.refreshToken.findUnique as jest.Mock;

// A valid access token for driver-1 (signed with the real secret from .env)
const VALID_TOKEN = signAccessToken({ sub: "driver-1", role: "DRIVER" });

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// (c-1) Deactivated driver cannot log in
// ─────────────────────────────────────────────────────────────────────────────
describe("(c) Deactivated driver cannot log in", () => {
  test("POST /auth/login with deactivated account → 403", async () => {
    // verifyPassword is mocked to return true above, so the route reaches the active check
    mockUserFindUnique.mockResolvedValue({
      id: "driver-1",
      username: "driver1",
      passwordHash: "hashed",
      role: "DRIVER",
      hospitalId: "hospital-1",
      active: false, // ← DEACTIVATED
    });

    const res = await request(app)
      .post("/auth/login")
      .send({ username: "driver1", password: "Driver@123" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  test("Wrong password for deactivated account → 401 (password fails first)", async () => {
    // verifyPassword is globally mocked to return true, so to test wrong-password
    // we override it just for this call
    const { verifyPassword } = require("../lib/password") as { verifyPassword: jest.Mock };
    verifyPassword.mockResolvedValueOnce(false); // simulate wrong password

    mockUserFindUnique.mockResolvedValue({
      id: "driver-1",
      username: "driver1",
      passwordHash: "hashed",
      role: "DRIVER",
      active: false,
    });

    const res = await request(app)
      .post("/auth/login")
      .send({ username: "driver1", password: "wrong-password" });

    // Password fails → 401 (timing-safe: we don't reveal deactivated status)
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c-2) Deactivated driver cannot use an existing (still-valid) access token
// ─────────────────────────────────────────────────────────────────────────────
describe("(c) Deactivated driver cannot use existing token", () => {
  test("GET /auth/me with valid token for deactivated user → 403", async () => {
    // authenticate middleware checks user.active in DB — user is deactivated
    mockUserFindUnique.mockResolvedValue({ active: false });

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  test("GET /hospital/drivers with valid token for deactivated driver → 403", async () => {
    // Even if the token claims HOSPITAL_ADMIN, active=false blocks it
    const adminToken = signAccessToken({
      sub: "admin-deactivated",
      role: "HOSPITAL_ADMIN",
      hospitalId: "hospital-1",
    });
    mockUserFindUnique.mockResolvedValue({ active: false });

    const res = await request(app)
      .get("/hospital/drivers")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  test("Deactivated user's refresh token is rejected → 403", async () => {
    const fakeRefreshToken = "00000000-0000-0000-0000-000000000001";

    mockTokenFindUnique.mockResolvedValue({
      id: "rt-1",
      token: fakeRefreshToken,
      userId: "driver-1",
      expiresAt: new Date(Date.now() + 3600_000), // not expired
      user: {
        id: "driver-1",
        role: "DRIVER",
        hospitalId: null,
        active: false, // ← deactivated
      },
    });
    (prisma.refreshToken.delete as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: fakeRefreshToken });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/i);
    // Token should be deleted (cleaned up on the way out)
    expect(prisma.refreshToken.delete).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sanity: active driver CAN use GET /auth/me
// ─────────────────────────────────────────────────────────────────────────────
describe("Active driver can use their token", () => {
  test("GET /auth/me with active driver token → 200", async () => {
    mockUserFindUnique.mockResolvedValue({ active: true });

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("DRIVER");
  });
});
