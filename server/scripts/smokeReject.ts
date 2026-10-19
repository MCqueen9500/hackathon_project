#!/usr/bin/env npx ts-node
/**
 * scripts/smokeReject.ts — Hospital-reject fallback smoke test
 *
 * Proves that when a hospital rejects, the emergency auto-assigns to
 * the next ranked hospital (or expires if none remain).
 *
 * Uses Node 20 built-in fetch/FormData — no extra deps.
 *
 * Run:
 *   npx ts-node --project server/tsconfig.scripts.json server/scripts/smokeReject.ts
 */

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE = process.env.SERVER_URL ?? "http://localhost:3001";

async function apiFetch(
  method: string,
  path: string,
  token: string | null,
  body?: Record<string, unknown> | FormData
): Promise<unknown> {
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (!isFormData && body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function login(username: string, password: string): Promise<string> {
  const r = await apiFetch("POST", "/auth/login", null, { username, password }) as { accessToken: string };
  return r.accessToken;
}

function assert(condition: boolean, message: string): void {
  if (!condition) { console.error(`\n❌ ASSERTION FAILED: ${message}`); process.exit(1); }
  console.log(`  ✓ ${message}`);
}

async function main(): Promise<void> {
  console.log("\n🚑  Emergency Green Corridor — Hospital-reject fallback smoke test");
  console.log(`    Server: ${BASE}\n`);

  // Minimal JPEG bytes
  const jpeg = Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc40014000100000000000000000000000000000007ffc40014100100000000000000000000000000000000ffda00080101000003f0007fffd9",
    "hex"
  );
  const imagePath = resolve(__dirname, "_smoke_reject_photo.jpg");
  writeFileSync(imagePath, jpeg);

  // ── Login ─────────────────────────────────────────────────────────────────
  console.log("1. Login…");
  const driverToken = await login("driver1", "Driver@123");
  assert(!!driverToken, "driver1 logged in");

  // ── Create emergency ──────────────────────────────────────────────────────
  console.log("2. Create emergency…");
  const key = `smoke-reject-${Date.now()}`;
  const form = new FormData();
  form.append("severity", "CRITICAL");
  form.append("originLat", "12.97");
  form.append("originLng", "77.59");
  form.append("photo", new Blob([jpeg], { type: "image/jpeg" }), "photo.jpg");

  const cRes = await fetch(`${BASE}/emergencies`, {
    method: "POST",
    headers: { Authorization: `Bearer ${driverToken}`, "Idempotency-Key": key },
    body: form,
  });
  const cJson = await cRes.json() as {
    emergency: { id: string; status: string; selectedHospitalId: string; hospitalAttempt: number }
  };
  assert(cRes.ok, `Created (HTTP ${cRes.status})`);
  assert(cJson.emergency.status === "PENDING_APPROVALS", "Status = PENDING_APPROVALS");

  const { id: emId, selectedHospitalId: firstHospId, hospitalAttempt: firstAttempt } = cJson.emergency;
  console.log(`   ID: ${emId}, firstHospital: ${firstHospId}, attempt: ${firstAttempt}`);

  // ── Find the admin for first hospital and reject ──────────────────────────
  console.log("3. Reject from first hospital…");
  let rejectToken: string | null = null;

  for (let i = 1; i <= 5; i++) {
    const tok = await login(`admin_h${i}`, "Admin@123");
    const inc = await apiFetch("GET", "/hospital/incoming", tok) as { incoming: Array<{ id: string }> };
    if (inc.incoming.some((e) => e.id === emId)) {
      rejectToken = tok;
      console.log(`   admin_h${i} owns it → rejecting`);
      break;
    }
  }
  assert(rejectToken !== null, "Found admin for first hospital");

  const rejectRes = await apiFetch(
    "POST", `/hospital/emergencies/${emId}/reject`, rejectToken!
  ) as { emergency: { selectedHospitalId: string; hospitalAttempt: number; status: string } };

  const { selectedHospitalId: nextHosp, hospitalAttempt: nextAttempt, status } = rejectRes.emergency;
  console.log(`   After reject: status=${status}, nextHospital=${nextHosp}, attempt=${nextAttempt}`);

  const expired    = status === "EXPIRED";
  const reassigned = status === "PENDING_APPROVALS" && nextAttempt > firstAttempt;

  assert(expired || reassigned,
    expired
      ? "All hospitals exhausted → status=EXPIRED"
      : `Reassigned to next hospital (attempt ${nextAttempt})`
  );

  if (reassigned) {
    assert(nextHosp !== firstHospId, `Next hospital (${nextHosp}) ≠ first hospital (${firstHospId})`);

    // Verify next hospital's incoming queue contains the emergency
    console.log("4. Next hospital's incoming queue…");
    let found = false;
    for (let i = 1; i <= 5; i++) {
      const tok = await login(`admin_h${i}`, "Admin@123");
      const inc = await apiFetch("GET", "/hospital/incoming", tok) as { incoming: Array<{ id: string }> };
      if (inc.incoming.some((e) => e.id === emId)) { found = true; console.log(`   Appears in admin_h${i} queue`); break; }
    }
    assert(found, "Emergency appears in next hospital's incoming queue");
  }

  console.log("\n🎉  Hospital-reject fallback smoke test PASSED\n");
}

main().catch((e: Error) => {
  console.error("\n💥  Reject fallback test FAILED:", e.message);
  process.exit(1);
});
