#!/usr/bin/env npx ts-node
/**
 * scripts/smoke.ts — Happy-path smoke test
 *
 * Runs the full flow through the live API and asserts final status = CLOSED.
 * Uses Node 20's built-in fetch and FormData (no extra deps needed).
 *
 * Prerequisites:
 *   1. docker compose up -d        (Postgres running)
 *   2. cd server && npx prisma migrate deploy
 *   3. npm run seed                (from workspace root)
 *   4. npm run dev:server          (server on :3001)
 *
 * Run:
 *   npx ts-node --project server/tsconfig.scripts.json server/scripts/smoke.ts
 */

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE = process.env.SERVER_URL ?? "http://localhost:3001";

// ── helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(
  method: string,
  path: string,
  token: string | null,
  body?: Record<string, unknown> | FormData,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (!isFormData && body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function login(username: string, password: string): Promise<string> {
  const res = await apiFetch("POST", "/auth/login", null, { username, password }) as { accessToken: string };
  return res.accessToken;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🚑  Emergency Green Corridor — Happy-path smoke test");
  console.log(`    Server: ${BASE}\n`);

  // ── Step 1: Login as driver1 ──────────────────────────────────────────────
  console.log("1. Login (driver1)…");
  const driverToken = await login("driver1", "Driver@123");
  assert(!!driverToken, "driver1 received access token");

  // ── Step 2: Get hospital candidates ──────────────────────────────────────
  console.log("2. Get hospital candidates…");
  const candidatesRes = await apiFetch(
    "GET",
    "/hospitals/candidates?lat=12.97&lng=77.59&severity=CRITICAL",
    driverToken
  ) as { candidates: Array<{ hospitalId: string; name: string }> };

  assert(candidatesRes.candidates.length > 0, `Got ${candidatesRes.candidates.length} candidate(s)`);
  console.log(`   Top hospital: ${candidatesRes.candidates[0].name}`);

  // ── Step 3: Create emergency with photo ──────────────────────────────────
  console.log("3. Create emergency (multipart)…");

  // Minimal valid JPEG (12×1 px, 1-byte image)
  const testImagePath = resolve(__dirname, "_smoke_photo.jpg");
  const minimalJpeg = Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300" +
    "080606070605080707070909080a0c140d0c0b0b0c19121" +
    "30f141d1a1f1e1d1a1c1c20242e2720222c231c1c283729" +
    "2c30313434341f27393d38323c2e333432ffc0000b080001" +
    "000101011100ffc40014000100000000000000000000000000" +
    "000007ffc40014100100000000000000000000000000000000" +
    "ffda00080101000003f0007fffd9",
    "hex"
  );
  writeFileSync(testImagePath, minimalJpeg);

  const idempotencyKey = `smoke-happy-${Date.now()}`;

  const form1 = new FormData();
  form1.append("severity", "CRITICAL");
  form1.append("originLat", "12.97");
  form1.append("originLng", "77.59");
  form1.append("note", "Smoke test happy path");
  form1.append(
    "photo",
    new Blob([minimalJpeg], { type: "image/jpeg" }),
    "_smoke_photo.jpg"
  );

  const createRes = await fetch(`${BASE}/emergencies`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${driverToken}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: form1,
  });

  const createJson = await createRes.json() as { emergency: { id: string; status: string } };
  assert(createRes.ok, `Emergency created (HTTP ${createRes.status})`);
  assert(createJson.emergency.status === "PENDING_APPROVALS", "Status = PENDING_APPROVALS");
  const emergencyId = createJson.emergency.id;
  console.log(`   Emergency ID: ${emergencyId}`);

  // Idempotency: same key → same ID
  const form2 = new FormData();
  form2.append("severity", "CRITICAL");
  form2.append("originLat", "12.97");
  form2.append("originLng", "77.59");
  form2.append("photo", new Blob([minimalJpeg], { type: "image/jpeg" }), "_smoke_photo.jpg");
  const dupRes = await fetch(`${BASE}/emergencies`, {
    method: "POST",
    headers: { Authorization: `Bearer ${driverToken}`, "Idempotency-Key": idempotencyKey },
    body: form2,
  });
  const dupJson = await dupRes.json() as { emergency: { id: string } };
  assert(dupJson.emergency.id === emergencyId, "Duplicate Idempotency-Key returns same emergency");

  // ── Step 4: Police verify ─────────────────────────────────────────────────
  console.log("4. Police verify…");
  const policeToken = await login("police1", "Police@123");
  const queueRes = await apiFetch("GET", "/police/queue", policeToken) as {
    queue: Array<{ id: string }>
  };
  assert(queueRes.queue.some((e) => e.id === emergencyId), "Emergency in police queue");

  const verifyRes = await apiFetch(
    "POST", `/police/emergencies/${emergencyId}/verify`, policeToken
  ) as { emergency: { policeStatus: string; status: string } };
  assert(verifyRes.emergency.policeStatus === "APPROVED", "policeStatus = APPROVED");
  console.log(`   Status after police: ${verifyRes.emergency.status}`);

  // ── Step 5: Find the right hospital admin and approve ─────────────────────
  console.log("5. Hospital approve…");
  let hospitalAdminToken: string | null = null;

  for (let i = 1; i <= 5; i++) {
    const tok = await login(`admin_h${i}`, "Admin@123");
    const inc = await apiFetch("GET", "/hospital/incoming", tok) as {
      incoming: Array<{ id: string }>
    };
    if (inc.incoming.some((e) => e.id === emergencyId)) {
      hospitalAdminToken = tok;
      console.log(`   admin_h${i} owns this emergency`);
      break;
    }
  }
  assert(hospitalAdminToken !== null, "Found the hospital admin for this emergency");

  const approveRes = await apiFetch(
    "POST", `/hospital/emergencies/${emergencyId}/approve`, hospitalAdminToken!
  ) as { emergency: { hospitalStatus: string; status: string } };
  assert(approveRes.emergency.hospitalStatus === "APPROVED", "hospitalStatus = APPROVED");
  assert(approveRes.emergency.status === "ACTIVE", "Status = ACTIVE");

  // ── Step 6: Driver marks arrived ─────────────────────────────────────────
  console.log("6. Driver marks arrived…");
  const arrivedRes = await apiFetch(
    "POST", `/emergencies/${emergencyId}/arrived`, driverToken
  ) as { emergency: { status: string } };
  assert(arrivedRes.emergency.status === "ARRIVED", "Status = ARRIVED");

  // ── Step 7: Hospital confirms handover ────────────────────────────────────
  console.log("7. Hospital confirms handover…");
  const handoverRes = await apiFetch(
    "POST", `/hospital/emergencies/${emergencyId}/confirm-handover`, hospitalAdminToken!
  ) as { emergency: { status: string } };
  assert(handoverRes.emergency.status === "CLOSED", "Status = CLOSED ✅");

  console.log("\n🎉  Happy-path smoke test PASSED — final status: CLOSED\n");
}

main().catch((err: Error) => {
  console.error("\n💥  Smoke test FAILED:", err.message);
  process.exit(1);
});
