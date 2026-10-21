/**
 * rbac.test.ts
 *
 * Proves:
 *   (a) A driver cannot call police or hospital endpoints → 403
 *   (b) A hospital admin cannot see / modify another hospital's drivers → 403
 *
 * Uses jest.mock for Prisma so no real DB connection is required.
 */

import request from "supertest";

// ── Mock Prisma before any imports that touch it ──────────────────────────────
jest.mock("../lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}), // requireRole writes here on 403
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

// ── Now import app & helpers (Prisma is already mocked) ───────────────────────
import { createApp } from "../app";
import { signAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

const app = createApp();

// Typed shorthand for the mock
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockFindMany   = prisma.user.findMany   as jest.Mock;

// Pre-signed tokens
const DRIVER_TOKEN =
  signAccessToken({ sub: "user-driver-1", role: "DRIVER" });

const ADMIN_H1_TOKEN =
  signAccessToken({ sub: "user-admin-1", role: "HOSPITAL_ADMIN", hospitalId: "hospital-1" });

const ADMIN_H2_TOKEN =
  signAccessToken({ sub: "user-admin-2", role: "HOSPITAL_ADMIN", hospitalId: "hospital-2" });

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Driver cannot call police or hospital admin endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe("(a) Driver is blocked from police and hospital endpoints", () => {
  beforeEach(() => {
    // authenticate middleware: active DRIVER
    mockFindUnique.mockResolvedValue({ active: true });
  });

  test.each([
    ["GET",  "/police/queue"],
    ["POST", "/police/emergencies/e1/verify"],
    ["GET",  "/police/closures"],
    ["POST", "/police/closures"],
  ])("%s %s → 403", async (method, path) => {
    const res = await (request(app) as any)[method.toLowerCase()](path)
      .set("Authorization", `Bearer ${DRIVER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test.each([
    ["GET",  "/hospital/drivers"],
    ["POST", "/hospital/drivers"],
    ["GET",  "/hospital/incoming"],
    ["POST", "/hospital/emergencies/e1/approve"],
    ["PATCH", "/hospital/beds"],
  ])("%s %s → 403", async (method, path) => {
    const res = await (request(app) as any)[method.toLowerCase()](path)
      .set("Authorization", `Bearer ${DRIVER_TOKEN}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Hospital admin cannot see or modify another hospital's drivers
// ─────────────────────────────────────────────────────────────────────────────
describe("(b) Hospital admin ownership is enforced", () => {
  test("GET /hospital/drivers queries only OWN hospitalId", async () => {
    // authenticate call
    mockFindUnique.mockResolvedValue({ active: true });
    mockFindMany.mockResolvedValue([
      { id: "d1", name: "Driver One", hospitalId: "hospital-1" },
    ]);

    const res = await request(app)
      .get("/hospital/drivers")
      .set("Authorization", `Bearer ${ADMIN_H1_TOKEN}`);

    expect(res.status).toBe(200);
    // findMany MUST be called with hospital-1's id (taken from token, never from body)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hospitalId: "hospital-1" }),
      })
    );
  });

  test("PATCH /hospital/drivers/:id on driver from different hospital → 403", async () => {
    // Call 1: authenticate middleware (admin-1 is active)
    mockFindUnique
      .mockResolvedValueOnce({ active: true })
      // Call 2: ownership check — driver belongs to hospital-2
      .mockResolvedValueOnce({ hospitalId: "hospital-2", role: "DRIVER" });

    const res = await request(app)
      .patch("/hospital/drivers/driver-h2-id")
      .set("Authorization", `Bearer ${ADMIN_H1_TOKEN}`)
      .send({ active: false });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/different hospital/i);
  });

  test("Admin from hospital-2 cannot deactivate hospital-1 driver → 403", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ active: true }) // authenticate
      .mockResolvedValueOnce({ hospitalId: "hospital-1", role: "DRIVER" }); // ownership

    const res = await request(app)
      .patch("/hospital/drivers/driver-h1-id")
      .set("Authorization", `Bearer ${ADMIN_H2_TOKEN}`)
      .send({ active: false });

    expect(res.status).toBe(403);
  });

  test("Admin CAN deactivate their OWN hospital driver → 200", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ active: true })                              // authenticate
      .mockResolvedValueOnce({ hospitalId: "hospital-1", role: "DRIVER" }); // ownership ✓

    (prisma.user.update as jest.Mock).mockResolvedValue({
      id: "driver-h1-id", name: "Driver One", active: false,
    });
    (prisma.refreshToken.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

    const res = await request(app)
      .patch("/hospital/drivers/driver-h1-id")
      .set("Authorization", `Bearer ${ADMIN_H1_TOKEN}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge: unauthenticated requests
// ─────────────────────────────────────────────────────────────────────────────
describe("Unauthenticated requests", () => {
  test("Missing Authorization header → 401", async () => {
    const res = await request(app).get("/hospital/drivers");
    expect(res.status).toBe(401);
  });

  test("Malformed token → 401", async () => {
    const res = await request(app)
      .get("/hospital/drivers")
      .set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });
});
