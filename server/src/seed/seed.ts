/**
 * seed.ts
 *
 * Populates the database with demo data per spec section 14:
 *   - 5 hospitals (from Overpass JSON, padded with hardcoded fallbacks)
 *   - 1 HOSPITAL_ADMIN per hospital
 *   - 1 POLICE user
 *   - 3 DRIVER users under hospital[0]
 *   - Traffic signals from Overpass JSON (fallback set if too few)
 *
 * Run: npm run seed  (from workspace root)
 * Idempotent: clears and re-creates all seed data each run.
 */

import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";

const SEED_DIR = resolve(__dirname, "../../seed");

// ── Specialty pool ────────────────────────────────────────────────────────────
const SPECIALTY_POOL = ["TRAUMA", "CARDIAC", "PEDIATRIC", "NEURO", "BURNS", "ORTHO"];

// ── Fallback hospitals (used if Overpass returned < 5) ────────────────────────
// Coordinates are near Bengaluru (default DEMO_CENTER in .env)
const FALLBACK_HOSPITALS = [
  { name: "City General Hospital",   lat: 12.9716, lng: 77.5946 },
  { name: "St. Mary Medical Center", lat: 12.9780, lng: 77.6040 },
  { name: "Apollo Emergency Care",   lat: 12.9650, lng: 77.5850 },
  { name: "National Trauma Centre",  lat: 12.9820, lng: 77.6100 },
  { name: "Metro Hospital",          lat: 12.9600, lng: 77.6000 },
];

// ── Fallback signals (along a typical demo route) ─────────────────────────────
const FALLBACK_SIGNALS = [
  { lat: 12.9716, lng: 77.5946, name: "Junction A" },
  { lat: 12.9730, lng: 77.5960, name: "Junction B" },
  { lat: 12.9745, lng: 77.5975, name: "Junction C" },
  { lat: 12.9760, lng: 77.5990, name: "Junction D" },
  { lat: 12.9775, lng: 77.6005, name: "Junction E" },
  { lat: 12.9790, lng: 77.6020, name: "Junction F" },
  { lat: 12.9805, lng: 77.6035, name: "Junction G" },
  { lat: 12.9820, lng: 77.6050, name: "Junction H" },
  { lat: 12.9835, lng: 77.6065, name: "Junction I" },
  { lat: 12.9850, lng: 77.6080, name: "Junction J" },
];

function loadJson<T>(filename: string): T[] {
  const file = resolve(SEED_DIR, filename);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T[];
  } catch {
    console.warn(`[seed] Warning: could not parse ${filename}`);
    return [];
  }
}

async function main() {
  console.log("[seed] Starting database seed…");

  // ── Load Overpass data ───────────────────────────────────────────────────────
  const rawHospitals = loadJson<{ osmId?: number | string; name: string; lat: number; lng: number }>("hospitals.json");
  const rawSignals   = loadJson<{ osmId?: number | string; lat: number; lng: number; name: string | null }>("signals.json");

  if (rawHospitals.length > 0) {
    console.log(`[seed] Loaded ${rawHospitals.length} hospitals from Overpass data`);
  } else {
    console.log("[seed] No Overpass hospital data — using fallback hospitals");
  }

  // ── Clear existing seed data (safe in dev; never use in production) ──────────
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.locationPing.deleteMany(),
    prisma.bedHold.deleteMany(),
    prisma.emergency.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.roadClosure.deleteMany(),
    prisma.signal.deleteMany(),
    prisma.user.deleteMany(),
    prisma.hospital.deleteMany(),
  ]);
  console.log("[seed] Cleared existing data");

  // ── Hash shared demo passwords up front ──────────────────────────────────────
  const [adminHash, policeHash, driverHash] = await Promise.all([
    hashPassword("Admin@123"),
    hashPassword("Police@123"),
    hashPassword("Driver@123"),
  ]);

  // ── Build hospital list: first 5 from Overpass, rest from fallback ────────────
  const hospitalsToCreate = Array.from({ length: 5 }, (_, i) => {
    const src = rawHospitals[i] ?? FALLBACK_HOSPITALS[i];
    const beds = Math.floor(Math.random() * 7) + 2; // 2–8 beds
    const osmId = "osmId" in src && src.osmId != null ? String(src.osmId) : null;
    return {
      name: src.name,
      lat: src.lat,
      lng: src.lng,
      city: "Demo City",
      specialties: [
        SPECIALTY_POOL[i % SPECIALTY_POOL.length],
        SPECIALTY_POOL[(i + 2) % SPECIALTY_POOL.length],
      ],
      totalEmergencyBeds: beds,
      availableBeds: beds,
      onboarded: true,         // seed hospitals are pre-onboarded
      mode: "DEMO_AUTO",       // auto-approve for demo convenience
      osmId,
    };
  });

  // ── Create hospitals ──────────────────────────────────────────────────────────
  const hospitals = await Promise.all(
    hospitalsToCreate.map((h) => prisma.hospital.create({ data: h }))
  );
  console.log(`[seed] Created ${hospitals.length} hospitals`);

  // ── Create 1 admin per hospital ───────────────────────────────────────────────
  for (let i = 0; i < hospitals.length; i++) {
    await prisma.user.create({
      data: {
        name: `${hospitals[i].name} Admin`,
        username: `admin_h${i + 1}`,
        passwordHash: adminHash,
        role: "HOSPITAL_ADMIN",
        hospitalId: hospitals[i].id,
      },
    });
  }
  console.log(`[seed] Created ${hospitals.length} hospital admins (admin_h1 … admin_h${hospitals.length})`);

  // ── Create 1 police user ──────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      name: "Officer Demo",
      username: "police1",
      passwordHash: policeHash,
      role: "POLICE",
    },
  });
  console.log("[seed] Created police user: police1");

  await prisma.user.create({
    data: {
      name: "Platform Admin",
      username: "admin",
      passwordHash: adminHash,
      role: "ADMIN",
    },
  });
  console.log("[seed] Created platform admin: admin / Admin@123");

  // ── Create 3 drivers under hospital[0] ───────────────────────────────────────
  for (let i = 1; i <= 3; i++) {
    await prisma.user.create({
      data: {
        name: `Driver ${i}`,
        username: `driver${i}`,
        passwordHash: driverHash,
        role: "DRIVER",
        hospitalId: hospitals[0].id,
        ambulanceNo: `KA01-AB-${1000 + i}`,
      },
    });
  }
  console.log("[seed] Created drivers: driver1, driver2, driver3 (under hospital 1)");

  // ── Seed signals: prefer Overpass data, pad with fallback if < 10 ────────────
  const signalRows = rawSignals.length >= 10
    ? rawSignals
    : [...rawSignals, ...FALLBACK_SIGNALS].slice(0, Math.max(rawSignals.length + FALLBACK_SIGNALS.length, 10));

  await prisma.signal.createMany({
    data: signalRows.map((s, i) => {
      const osmId = "osmId" in s && s.osmId != null ? String(s.osmId) : `fallback-${i}`;
      return {
        lat: s.lat,
        lng: s.lng,
        name: s.name ?? null,
        city: "Demo City",
        simulated: !("osmId" in s) || s.osmId == null,
        osmId,
      };
    }),
  });
  console.log(`[seed] Created ${signalRows.length} signals (${rawSignals.length} from Overpass JSON)`);

  console.log("\n[seed] ✅ Done!\n");
  console.log("  Demo credentials:");
  console.log("    Platform admin  : admin                 / Admin@123");
  console.log("    Hospital admins : admin_h1 … admin_h5  / Admin@123");
  console.log("    Police          : police1               / Police@123");
  console.log("    Drivers         : driver1 … driver3     / Driver@123");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[seed] ❌ Failed:", err);
  process.exit(1);
});
