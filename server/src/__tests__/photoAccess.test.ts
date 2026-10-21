/**
 * photoAccess.test.ts
 *
 * Acceptance tests for spec §17.4 — Signed photo URL access control.
 *
 * Four cases verified:
 *   1. Police officer can see the photo                 → 200
 *   2. Selected hospital's admin can see the photo      → 200
 *   3. A different hospital's admin is blocked          → 403
 *   4. An expired token is rejected                     → 403
 */

import request from "supertest";
import path from "path";
import fs from "fs";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
jest.mock("../lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      deleteMany:  jest.fn(),
      create:      jest.fn(),
    },
    emergency: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

import { createApp } from "../app";
import { signAccessToken } from "../lib/jwt";
import { signPhotoToken } from "../lib/photoToken";
import { prisma } from "../lib/prisma";

const app = createApp();

// ── Pre-signed tokens for each role ──────────────────────────────────────────
const POLICE_TOKEN = signAccessToken({ sub: "u-police", role: "POLICE" });
const HOSP1_TOKEN  = signAccessToken({ sub: "u-admin-h1", role: "HOSPITAL_ADMIN", hospitalId: "h1" });
const HOSP2_TOKEN  = signAccessToken({ sub: "u-admin-h2", role: "HOSPITAL_ADMIN", hospitalId: "h2" });

const EMERGENCY_ID     = "em-photo-test";
const SELECTED_HOSP_ID = "h1";

// ── Shared emergency stub ─────────────────────────────────────────────────────
const EMERGENCY_STUB = {
  driverId:           "u-driver",
  selectedHospitalId: SELECTED_HOSP_ID,
  photoPath:          `/uploads/test-scene.jpg`,
};

// ── Create a real temp photo file so sendFile doesn't 404 ────────────────────
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const TEST_PHOTO = path.join(UPLOAD_DIR, "test-scene.jpg");

beforeAll(() => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  // Write a minimal valid JPEG (1×1 pixel)
  const tinyJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
    "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
    "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
    "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA" +
    "AAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA" +
    "/9oADAMBAAIRAxEAPwCwABmX/9k=",
    "base64"
  );
  fs.writeFileSync(TEST_PHOTO, tinyJpeg);
});

afterAll(() => {
  if (fs.existsSync(TEST_PHOTO)) fs.unlinkSync(TEST_PHOTO);
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: user lookup succeeds (authenticate middleware)
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: "u-any", active: true, role: "POLICE", hospitalId: null,
  });
  // Default: emergency lookup for photo access
  (prisma.emergency.findUnique as jest.Mock).mockResolvedValue(EMERGENCY_STUB);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Police officer can see the photo
// ─────────────────────────────────────────────────────────────────────────────
describe("§17.4 Photo access", () => {
  test("1. POLICE → 200 OK with valid token", async () => {
    const token = signPhotoToken(EMERGENCY_ID);
    const res = await request(app)
      .get(`/photos/${EMERGENCY_ID}?token=${encodeURIComponent(token)}`)
      .set("Authorization", `Bearer ${POLICE_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  // ── 2. Selected hospital admin → 200 ─────────────────────────────────────
  test("2. Selected hospital admin → 200 OK", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "u-admin-h1", active: true, role: "HOSPITAL_ADMIN", hospitalId: "h1",
    });

    const token = signPhotoToken(EMERGENCY_ID);
    const res = await request(app)
      .get(`/photos/${EMERGENCY_ID}?token=${encodeURIComponent(token)}`)
      .set("Authorization", `Bearer ${HOSP1_TOKEN}`);

    expect(res.status).toBe(200);
  });

  // ── 3. Different hospital admin → 403 ────────────────────────────────────
  test("3. Different hospital admin → 403 Forbidden", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "u-admin-h2", active: true, role: "HOSPITAL_ADMIN", hospitalId: "h2",
    });

    const token = signPhotoToken(EMERGENCY_ID);
    const res = await request(app)
      .get(`/photos/${EMERGENCY_ID}?token=${encodeURIComponent(token)}`)
      .set("Authorization", `Bearer ${HOSP2_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  // ── 4. Expired token → 403 ───────────────────────────────────────────────
  test("4. Expired token → 403 with EXPIRED code", async () => {
    // Craft a token where expiresAt is 1 second in the past
    const { createHmac } = require("crypto");
    const { env } = require("../config/env");

    const expiredAt = Math.floor(Date.now() / 1000) - 1;
    const encodedId = Buffer.from(EMERGENCY_ID).toString("base64url");
    const payload   = `${expiredAt}.${encodedId}`;
    const hmac      = createHmac("sha256", env.PHOTO_HMAC_SECRET)
      .update(payload)
      .digest("base64url");
    const expiredToken = `${payload}.${hmac}`;

    const res = await request(app)
      .get(`/photos/${EMERGENCY_ID}?token=${encodeURIComponent(expiredToken)}`)
      .set("Authorization", `Bearer ${POLICE_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EXPIRED");
  });
});
