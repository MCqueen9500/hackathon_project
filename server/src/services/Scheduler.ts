/**
 * Scheduler — DB-polling timer for emergency timeouts and bed hold expiry.
 *
 * Design (per spec section 6 + acceptance criteria):
 *   - Reads ALL pending deadlines from the DB on every tick, NOT from memory.
 *   - This means restarting the process mid-wait still fires all missed timeouts
 *     on the very first tick after startup.
 *   - Each tick fires independently; overlapping ticks are skipped.
 *
 * Three jobs per tick:
 *   1. Hospital approval timeout  → EmergencyService.hospitalTimeout()
 *      (moves to next ranked hospital; EXPIRED if none left)
 *   2. Police approval timeout    → set policeEscalated=true (emergency continues)
 *   3. Bed hold expiry            → release held bed atomically
 */

import { prisma } from "../lib/prisma";
import type { EmergencyService } from "./EmergencyService";
import { env } from "../config/env";

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly emergencyService: EmergencyService) {}

  /** Start the polling loop. Safe to call multiple times (idempotent). */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(
      () => void this.tick(),
      env.SCHEDULER_POLL_INTERVAL_MS
    );
    console.log(
      `[Scheduler] Started — poll interval ${env.SCHEDULER_POLL_INTERVAL_MS} ms`
    );
  }

  /** Stop the polling loop. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[Scheduler] Stopped");
    }
  }

  /**
   * Run one tick immediately.
   * Called on server startup so any timeouts that expired while the server
   * was down are handled before the first scheduled interval fires.
   */
  async runNow(): Promise<void> {
    await this.tick();
  }

  // ─── Private: one poll cycle ───────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.ticking) return; // Don't overlap ticks under slow DB
    this.ticking = true;
    try {
      await Promise.all([
        this.handleHospitalTimeouts(),
        this.handlePoliceTimeouts(),
        this.handleBedHoldExpiry(),
      ]);
    } catch (err) {
      console.error("[Scheduler] Unhandled tick error:", err);
    } finally {
      this.ticking = false;
    }
  }

  // ─── Job 1: hospital approval timeouts ────────────────────────────────────

  private async handleHospitalTimeouts(): Promise<void> {
    const now = new Date();

    const expired = await prisma.emergency.findMany({
      where: {
        status: "PENDING_APPROVALS",
        hospitalStatus: "PENDING",
        hospitalDeadline: { lt: now },
      },
      select: { id: true },
    });

    for (const { id } of expired) {
      try {
        await this.emergencyService.hospitalTimeout(id);
        console.log(`[Scheduler] Hospital timeout → emergency ${id}`);
      } catch (err) {
        // Log and continue — one failure must not block other timeouts
        console.error(`[Scheduler] Hospital timeout failed for ${id}:`, err);
      }
    }
  }

  // ─── Job 2: police approval timeouts ──────────────────────────────────────

  /**
   * Per spec: police timeout does NOT reject the emergency.
   * It sets policeEscalated=true and the emergency continues.
   * The hospital can still approve independently.
   */
  private async handlePoliceTimeouts(): Promise<void> {
    const now = new Date();

    const { count } = await prisma.emergency.updateMany({
      where: {
        status: "PENDING_APPROVALS",
        policeStatus: "PENDING",
        policeEscalated: false,
        policeDeadline: { lt: now },
      },
      data: { policeEscalated: true },
    });

    if (count > 0) {
      console.log(`[Scheduler] Police escalation set on ${count} emergenc${count === 1 ? "y" : "ies"}`);
    }
  }

  // ─── Job 3: bed hold expiry ────────────────────────────────────────────────

  private async handleBedHoldExpiry(): Promise<void> {
    const now = new Date();

    const expiredHolds = await prisma.bedHold.findMany({
      where: { status: "HELD", expiresAt: { lt: now } },
      select: { id: true, hospitalId: true, emergencyId: true },
    });

    for (const hold of expiredHolds) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.bedHold.update({
            where: { id: hold.id },
            data: { status: "EXPIRED" },
          });
          // Restore the bed atomically in the same transaction
          await tx.$executeRaw`
            UPDATE hospitals
            SET "availableBeds" = "availableBeds" + 1
            WHERE id = ${hold.hospitalId}
          `;
        });
        console.log(`[Scheduler] Bed hold expired and released — hold ${hold.id}`);
      } catch (err) {
        console.error(`[Scheduler] Bed hold expiry failed for ${hold.id}:`, err);
      }
    }
  }
}
