/**
 * DemoAutoScheduler — automatically approves or rejects hospital approvals
 * for hospitals with mode=DEMO_AUTO (SPEC §17.2).
 *
 * When ALLOW_DEMO_AUTO=true and an emergency is in PENDING_APPROVALS state
 * with a DEMO_AUTO hospital selected, this scheduler fires after a random
 * DEMO_AUTO_DELAY_SEC ± jitter seconds to call the same EmergencyService
 * approve/reject paths used by real hospital admins.
 *
 * The audit log actor is set to the sentinel string "SYSTEM_DEMO_AUTO".
 */

import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import type { EmergencyService } from "../EmergencyService";
import { emitEmergencyEvent } from "../../lib/socket";

const SENTINEL_ACTOR = "SYSTEM_DEMO_AUTO";

export class DemoAutoScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly emergencyService: EmergencyService) {}

  /** Schedule auto-resolution for a new emergency, if applicable. */
  schedule(emergencyId: string, hospitalId: string): void {
    if (env.ALLOW_DEMO_AUTO !== "true") return;
    if (this.timers.has(emergencyId)) return; // already scheduled

    void this._scheduleAsync(emergencyId, hospitalId);
  }

  private async _scheduleAsync(emergencyId: string, hospitalId: string): Promise<void> {
    // Verify the hospital is DEMO_AUTO
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { mode: true, availableBeds: true },
    });
    if (!hospital || hospital.mode !== "DEMO_AUTO") return;

    // Jitter: random between 3 and 8 seconds (clamped by env base)
    const minDelay = 3_000;
    const maxDelay = 8_000;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);

    const timer = setTimeout(() => {
      this.timers.delete(emergencyId);
      void this._resolve(emergencyId, hospitalId);
    }, delay);

    this.timers.set(emergencyId, timer);
  }

  private async _resolve(emergencyId: string, hospitalId: string): Promise<void> {
    try {
      const emergency = await prisma.emergency.findUnique({
        where: { id: emergencyId },
        select: { status: true, hospitalStatus: true, selectedHospitalId: true },
      });

      // Only act when still pending hospital approval
      if (!emergency || emergency.status !== "PENDING_APPROVALS") return;
      if (emergency.hospitalStatus !== "PENDING") return;
      if (emergency.selectedHospitalId !== hospitalId) return;

      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: { availableBeds: true },
      });

      // Decide: reject with DEMO_AUTO_REJECT_RATE probability, else approve if beds
      const shouldReject = Math.random() < env.DEMO_AUTO_REJECT_RATE;
      if (shouldReject || !hospital || hospital.availableBeds < 1) {
        await this.emergencyService.hospitalReject(emergencyId, SENTINEL_ACTOR, hospitalId);
        console.log(`[DEMO_AUTO] Emergency ${emergencyId} auto-REJECTED by demo scheduler`);
      } else {
        await this.emergencyService.hospitalApprove(emergencyId, SENTINEL_ACTOR, hospitalId);
        console.log(`[DEMO_AUTO] Emergency ${emergencyId} auto-APPROVED by demo scheduler`);
      }
    } catch (err) {
      console.warn(`[DEMO_AUTO] Failed to auto-resolve ${emergencyId}:`, (err as Error).message);
    }
  }

  /** Re-schedule any existing PENDING_APPROVALS emergencies (on server restart). */
  async hydrate(): Promise<void> {
    if (env.ALLOW_DEMO_AUTO !== "true") return;

    const pending = await prisma.emergency.findMany({
      where: { status: "PENDING_APPROVALS", hospitalStatus: "PENDING" },
      select: { id: true, selectedHospitalId: true },
    });

    for (const e of pending) {
      if (e.selectedHospitalId) {
        this.schedule(e.id, e.selectedHospitalId);
      }
    }

    if (pending.length > 0) {
      console.log(`[DEMO_AUTO] Hydrated ${pending.length} pending emergencies`);
    }
  }

  /** Cancel a pending auto-resolution (e.g. manually approved/rejected). */
  cancel(emergencyId: string): void {
    const t = this.timers.get(emergencyId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(emergencyId);
    }
  }

  shutdown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
