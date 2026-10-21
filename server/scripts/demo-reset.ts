#!/usr/bin/env node
/**
 * demo-reset.ts
 *
 * Resets the database to a clean seed state and clears uploaded photos.
 * Safe for repeated use during demos.
 *
 * Steps:
 *   1. Drop and recreate all data via Prisma migrate reset (non-interactive)
 *   2. Run seed to repopulate hospitals, users, signals
 *   3. Clear the uploads directory
 *
 * Usage (from repo root): npm run demo:reset
 */

import "dotenv/config";
import { execSync } from "child_process";
import { existsSync, readdirSync, rmSync, mkdirSync } from "fs";
import { resolve } from "path";

const UPLOADS_DIR = resolve(__dirname, "../../uploads");

function run(cmd: string, cwd?: string) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: cwd ?? resolve(__dirname, "../..") });
}

async function main() {
  console.log("\n🔄  demo:reset — wiping and re-seeding...\n");

  // 1. Reset DB via Prisma (drops all tables, re-runs migrations)
  run("npx prisma migrate reset --force --skip-seed", resolve(__dirname, "../.."));

  // 2. Re-run seed
  run("npm run seed", resolve(__dirname, "../.."));

  // 3. Clear uploads
  if (existsSync(UPLOADS_DIR)) {
    const files = readdirSync(UPLOADS_DIR).filter((f) => f !== ".gitkeep");
    for (const f of files) {
      rmSync(resolve(UPLOADS_DIR, f), { force: true });
    }
    console.log(`\n🗑️  Cleared ${files.length} file(s) from uploads/`);
  } else {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`\n📁  Created uploads/ directory`);
  }

  console.log("\n✅  demo:reset complete. Ready for a fresh demo run.\n");
}

main().catch((err) => {
  console.error("❌  demo:reset failed:", err);
  process.exit(1);
});
