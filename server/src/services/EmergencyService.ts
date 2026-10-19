/**
 * EmergencyService — the ONLY place that mutates emergency status or approvals.
 *
 * Per spec section 15 rule 1:
 *   "Only EmergencyService mutates emergency status or approvals.
 *    No status changes in route handlers or UI code."
 *
 * State machine (section 6):
 *
 *   create ─────────────────────► PENDING_APPROVALS
 *                                      │
 *              policeApprove + hospitalApprove ─► ACTIVE ─► ARRIVED ─► CLOSED
 *                                      │
 *              policeReject ──────────► REJECTED
 *              cancel ─────────────────► CANCELLED
 *              hospital exhausted ──────► EXPIRED
 *
 * Concurrency safety (section 11):
 *   hospitalApprove uses a raw SQL atomic decrement inside an interactive
 *   transaction, so two concurrent approvals for the last bed → exactly one wins.
 */

import type { Emergency, ApprovalStatus, EmergencyStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { EmergencyError } from "../errors/EmergencyError";
import type { RankingProvider, RankedHospital } from "./ranking/RankingProvider";
import { env } from "../config/env";
import { emitEmergencyEvent } from "../lib/socket";

// ── Terminal states allow no further transitions ──────────────────────────────
const TERMINAL: EmergencyStatus[] = [
  "CLOSED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateEmergencyDto {
  driverId: string;
  severity: "CRITICAL" | "SERIOUS" | "STABLE";
  originLat: number;
  originLng: number;
  photoPath: string;
  note?: string;
  idempotencyKey: string;
  city?: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class EmergencyService {
  constructor(private readonly ranking: RankingProvider) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────────

  /**
   * Create a new emergency.
   * Idempotent: if the idempotencyKey was already used, returns the existing record.
   */
  async create(dto: CreateEmergencyDto): Promise<Emergency> {
    // Idempotency guard
    const existing = await prisma.emergency.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;

    // Rank all hospitals by proximity, excluding those with no beds
    const hospitals = await prisma.hospital.findMany({
      select: { id: true, lat: true, lng: true, availableBeds: true },
    });
    const ranked = await this.ranking.rank(dto.originLat, dto.originLng, hospitals);

    if (ranked.length === 0) {
      throw new EmergencyError(
        "NO_HOSPITALS_FOUND",
        "No hospitals with available beds found near the emergency origin"
      );
    }

    const now = Date.now();
    const hospitalDeadline = new Date(now + env.HOSPITAL_APPROVAL_TIMEOUT_SEC * 1_000);
    const policeDeadline   = new Date(now + env.POLICE_APPROVAL_TIMEOUT_SEC   * 1_000);

    const emergency = await prisma.emergency.create({
      data: {
        driverId:          dto.driverId,
        severity:          dto.severity,
        originLat:         dto.originLat,
        originLng:         dto.originLng,
        photoPath:         dto.photoPath,
        note:              dto.note,
        idempotencyKey:    dto.idempotencyKey,
        city:              dto.city,
        status:            "PENDING_APPROVALS",
        policeStatus:      "PENDING",
        hospitalStatus:    "PENDING",
        policeDeadline,
        hospitalDeadline,
        policeEscalated:   false,
        selectedHospitalId: ranked[0].hospitalId,
        hospitalAttempt:   0,
        rankedHospitals:   ranked as unknown as Prisma.InputJsonValue,
        etaSeconds:        ranked[0].etaSeconds,
        distanceMeters:    ranked[0].distanceMeters,
      },
    });

    await this.audit("EMERGENCY_CREATED", emergency.id, dto.driverId, {
      severity: dto.severity,
      selectedHospitalId: ranked[0].hospitalId,
      rankedCount: ranked.length,
    });

    emitEmergencyEvent("emergency:created", {
      emergencyId: emergency.id,
      driverId: emergency.driverId,
      selectedHospitalId: emergency.selectedHospitalId,
      data: { emergency },
    });

    return emergency;
  }

  // ─── POLICE APPROVE ───────────────────────────────────────────────────────

  async policeApprove(emergencyId: string, actorId: string): Promise<Emergency> {
    await this.assert(emergencyId, {
      status: "PENDING_APPROVALS",
      policeStatus: "PENDING",
    });

    // Re-read inside to compute next status atomically
    const em = await this.findOrThrow(emergencyId);
    const newStatus: EmergencyStatus =
      em.hospitalStatus === "APPROVED" ? "ACTIVE" : "PENDING_APPROVALS";

    const updated = await prisma.emergency.update({
      where: { id: emergencyId },
      data: { policeStatus: "APPROVED", policeDeadline: null, status: newStatus },
    });

    await this.audit("POLICE_APPROVED", emergencyId, actorId, { newStatus }, {
      driverId: em.driverId,
      selectedHospitalId: updated.selectedHospitalId,
    });
    return updated;
  }

  // ─── POLICE REJECT ────────────────────────────────────────────────────────

  async policeReject(emergencyId: string, actorId: string): Promise<Emergency> {
    await this.assert(emergencyId, {
      status: "PENDING_APPROVALS",
      policeStatus: "PENDING",
    });

    // Release any bed hold if hospital had already approved in parallel
    await this.releaseBedHold(emergencyId);

    const updated = await prisma.emergency.update({
      where: { id: emergencyId },
      data: { policeStatus: "REJECTED", status: "REJECTED", closedAt: new Date() },
    });

    await this.audit("POLICE_REJECTED", emergencyId, actorId, undefined, {
      driverId: updated.driverId,
      selectedHospitalId: updated.selectedHospitalId,
    });
    return updated;
  }

  // ─── HOSPITAL APPROVE ─────────────────────────────────────────────────────

  /**
   * Atomically decrements hospital.availableBeds and creates the bed hold inside
   * a single interactive transaction. If two concurrent approvals race for the
   * last bed, the SQL WHERE clause ("availableBeds" > 0) means exactly one wins.
   */
  async hospitalApprove(
    emergencyId: string,
    actorId: string,
    callerHospitalId: string
  ): Promise<Emergency> {
    const em = await this.assert(emergencyId, {
      status: "PENDING_APPROVALS",
      hospitalStatus: "PENDING",
    });

    if (em.selectedHospitalId !== callerHospitalId) {
      throw new EmergencyError(
        "WRONG_HOSPITAL",
        `Emergency is assigned to hospital ${em.selectedHospitalId ?? "none"}`
      );
    }

    const newStatus: EmergencyStatus =
      em.policeStatus === "APPROVED" ? "ACTIVE" : "PENDING_APPROVALS";

    const expiresAt = new Date(Date.now() + env.BED_HOLD_TTL_MIN * 60 * 1_000);

    const updated = await prisma.$transaction(async (tx) => {
      // Atomic decrement — zero-rows means no beds → transaction aborts with domain error
      const affected = await tx.$executeRaw`
        UPDATE hospitals
        SET "availableBeds" = "availableBeds" - 1
        WHERE id = ${callerHospitalId} AND "availableBeds" > 0
      `;

      if (affected === 0) {
        throw new EmergencyError(
          "NO_BEDS_AVAILABLE",
          "No beds available at this hospital (concurrent approval won)"
        );
      }

      const updatedEm = await tx.emergency.update({
        where: { id: emergencyId },
        data: { hospitalStatus: "APPROVED", hospitalDeadline: null, status: newStatus },
      });

      await tx.bedHold.create({
        data: { hospitalId: callerHospitalId, emergencyId, status: "HELD", expiresAt },
      });

      return updatedEm;
    });

    await this.audit("HOSPITAL_APPROVED", emergencyId, actorId, {
      hospitalId: callerHospitalId,
      newStatus,
    }, {
      driverId: em.driverId,
      selectedHospitalId: callerHospitalId,
    });
    return updated;
  }

  // ─── HOSPITAL REJECT ──────────────────────────────────────────────────────

  async hospitalReject(
    emergencyId: string,
    actorId: string,
    callerHospitalId: string
  ): Promise<Emergency> {
    const em = await this.assert(emergencyId, {
      status: "PENDING_APPROVALS",
      hospitalStatus: "PENDING",
    });

    if (em.selectedHospitalId !== callerHospitalId) {
      throw new EmergencyError(
        "WRONG_HOSPITAL",
        `Emergency is assigned to hospital ${em.selectedHospitalId ?? "none"}`
      );
    }

    await prisma.emergency.update({
      where: { id: emergencyId },
      data: { hospitalStatus: "REJECTED" },
    });

    await this.audit("HOSPITAL_REJECTED", emergencyId, actorId, {
      hospitalId: callerHospitalId,
    }, {
      driverId: em.driverId,
      selectedHospitalId: em.selectedHospitalId,
    });

    return this.assignNextHospital(emergencyId);
  }

  // ─── HOSPITAL REVOKE ──────────────────────────────────────────────────────

  /** Hospital revokes its bed hold and returns the case to assignment pool. */
  async hospitalRevoke(
    emergencyId: string,
    actorId: string,
    callerHospitalId: string
  ): Promise<Emergency> {
    const em = await this.assert(emergencyId, {
      status: ["ACTIVE", "PENDING_APPROVALS"],
      hospitalStatus: "APPROVED",
    });

    if (em.selectedHospitalId !== callerHospitalId) {
      throw new EmergencyError(
        "WRONG_HOSPITAL",
        "Only the assigned hospital can revoke"
      );
    }

    await this.releaseBedHold(emergencyId);

    await prisma.emergency.update({
      where: { id: emergencyId },
      data: { hospitalStatus: "REJECTED", status: "PENDING_APPROVALS" },
    });

    await this.audit("HOSPITAL_REVOKED", emergencyId, actorId, {
      hospitalId: callerHospitalId,
    }, {
      driverId: em.driverId,
      selectedHospitalId: em.selectedHospitalId,
    });

    return this.assignNextHospital(emergencyId);
  }

  // ─── CANCEL ───────────────────────────────────────────────────────────────

  async cancel(emergencyId: string, actorId: string): Promise<Emergency> {
    const em = await this.findOrThrow(emergencyId);

    if (TERMINAL.includes(em.status)) {
      throw new EmergencyError(
        "INVALID_TRANSITION",
        `Cannot cancel: emergency is already in terminal status ${em.status}`
      );
    }

    // Release any in-flight bed hold
    await this.releaseBedHold(emergencyId);

    const updated = await prisma.emergency.update({
      where: { id: emergencyId },
      data: { status: "CANCELLED", closedAt: new Date() },
    });

    await this.audit("EMERGENCY_CANCELLED", emergencyId, actorId, undefined, {
      driverId: em.driverId,
      selectedHospitalId: em.selectedHospitalId,
    });
    return updated;
  }

  // ─── ARRIVED ─────────────────────────────────────────────────────────────

  async arrived(emergencyId: string, actorId: string): Promise<Emergency> {
    await this.assert(emergencyId, { status: "ACTIVE" });

    const updated = await prisma.emergency.update({
      where: { id: emergencyId },
      data: { status: "ARRIVED" },
    });

    // Consume the bed hold — ambulance has physically arrived
    await prisma.bedHold.updateMany({
      where: { emergencyId, status: "HELD" },
      data: { status: "CONSUMED" },
    });

    await this.audit("AMBULANCE_ARRIVED", emergencyId, actorId, undefined, {
      driverId: updated.driverId,
      selectedHospitalId: updated.selectedHospitalId,
    });
    return updated;
  }

  // ─── CONFIRM HANDOVER ─────────────────────────────────────────────────────

  async confirmHandover(
    emergencyId: string,
    actorId: string,
    callerHospitalId: string
  ): Promise<Emergency> {
    const em = await this.assert(emergencyId, { status: "ARRIVED" });

    if (em.selectedHospitalId !== callerHospitalId) {
      throw new EmergencyError(
        "WRONG_HOSPITAL",
        "Only the receiving hospital can confirm patient handover"
      );
    }

    const updated = await prisma.emergency.update({
      where: { id: emergencyId },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    // Edge case: arrived may not have consumed the hold (e.g., revoke was pending)
    await prisma.bedHold.updateMany({
      where: { emergencyId, status: "HELD" },
      data: { status: "CONSUMED" },
    });

    await this.audit("HANDOVER_CONFIRMED", emergencyId, actorId, {
      hospitalId: callerHospitalId,
    }, {
      driverId: updated.driverId,
      selectedHospitalId: updated.selectedHospitalId,
    });
    return updated;
  }

  // ─── HOSPITAL TIMEOUT (called by Scheduler) ───────────────────────────────

  /**
   * Called when HOSPITAL_APPROVAL_TIMEOUT_SEC elapses without a hospital decision.
   * Safe to call multiple times — idempotent if status already advanced.
   */
  async hospitalTimeout(emergencyId: string): Promise<Emergency> {
    const em = await this.findOrThrow(emergencyId);

    // If already handled (scheduler ran twice before next tick) — no-op
    if (em.status !== "PENDING_APPROVALS" || em.hospitalStatus !== "PENDING") {
      return em;
    }

    await prisma.emergency.update({
      where: { id: emergencyId },
      data: { hospitalStatus: "TIMED_OUT" },
    });

    await this.audit("HOSPITAL_TIMED_OUT", emergencyId, null, {
      hospitalId: em.selectedHospitalId,
      attempt: em.hospitalAttempt,
    }, {
      driverId: em.driverId,
      selectedHospitalId: em.selectedHospitalId,
    });

    return this.assignNextHospital(emergencyId);
  }

  // ─── PRIVATE: assign next hospital in the ranked list ────────────────────

  private async assignNextHospital(emergencyId: string): Promise<Emergency> {
    const em = await this.findOrThrow(emergencyId);
    const ranked = (em.rankedHospitals as RankedHospital[] | null) ?? [];
    const nextAttempt = em.hospitalAttempt + 1;

    if (nextAttempt >= ranked.length) {
      // All hospitals exhausted
      const expired = await prisma.emergency.update({
        where: { id: emergencyId },
        data: { status: "EXPIRED", closedAt: new Date() },
      });
      await this.audit("EMERGENCY_EXPIRED", emergencyId, null, {
        exhaustedAttempts: nextAttempt,
      }, {
        driverId: em.driverId,
        selectedHospitalId: em.selectedHospitalId,
      });
      return expired;
    }

    const next = ranked[nextAttempt];
    const hospitalDeadline = new Date(
      Date.now() + env.HOSPITAL_APPROVAL_TIMEOUT_SEC * 1_000
    );

    const updated = await prisma.emergency.update({
      where: { id: emergencyId },
      data: {
        selectedHospitalId: next.hospitalId,
        hospitalAttempt:    nextAttempt,
        hospitalStatus:     "PENDING",
        hospitalDeadline,
        etaSeconds:         next.etaSeconds,
        distanceMeters:     next.distanceMeters,
      },
    });

    await this.audit("HOSPITAL_REASSIGNED", emergencyId, null, {
      attempt:    nextAttempt,
      hospitalId: next.hospitalId,
    }, {
      driverId: em.driverId,
      selectedHospitalId: next.hospitalId,
    });

    return updated;
  }

  // ─── PRIVATE: release a HELD bed hold ────────────────────────────────────

  async releaseBedHold(emergencyId: string): Promise<void> {
    const held = await prisma.bedHold.findFirst({
      where: { emergencyId, status: "HELD" },
    });
    if (!held) return;

    await prisma.$transaction(async (tx) => {
      await tx.bedHold.update({
        where: { id: held.id },
        data: { status: "RELEASED" },
      });
      // Restore the bed atomically in the same transaction
      await tx.$executeRaw`
        UPDATE hospitals
        SET "availableBeds" = "availableBeds" + 1
        WHERE id = ${held.hospitalId}
      `;
    });
  }

  // ─── PRIVATE: findOrThrow ─────────────────────────────────────────────────

  private async findOrThrow(emergencyId: string): Promise<Emergency> {
    const em = await prisma.emergency.findUnique({ where: { id: emergencyId } });
    if (!em) {
      throw new EmergencyError(
        "EMERGENCY_NOT_FOUND",
        `Emergency ${emergencyId} not found`
      );
    }
    return em;
  }

  // ─── PRIVATE: assert state preconditions ─────────────────────────────────

  /**
   * Fetches the emergency and checks the expected status/approval conditions.
   * Throws EmergencyError('INVALID_TRANSITION') if any condition fails.
   * Returns the emergency so the caller can read its current state.
   */
  private async assert(
    emergencyId: string,
    conditions: {
      status?: EmergencyStatus | EmergencyStatus[];
      policeStatus?: ApprovalStatus;
      hospitalStatus?: ApprovalStatus;
    }
  ): Promise<Emergency> {
    const em = await this.findOrThrow(emergencyId);

    if (conditions.status !== undefined) {
      const allowed = Array.isArray(conditions.status)
        ? conditions.status
        : [conditions.status];
      if (!allowed.includes(em.status)) {
        throw new EmergencyError(
          "INVALID_TRANSITION",
          `Emergency status is "${em.status}", expected one of [${allowed.join(", ")}]`,
          { emergencyId, currentStatus: em.status, expected: allowed }
        );
      }
    }

    if (
      conditions.policeStatus !== undefined &&
      em.policeStatus !== conditions.policeStatus
    ) {
      throw new EmergencyError(
        "INVALID_TRANSITION",
        `Police status is "${em.policeStatus}", expected "${conditions.policeStatus}"`,
        { emergencyId, currentPoliceStatus: em.policeStatus }
      );
    }

    if (
      conditions.hospitalStatus !== undefined &&
      em.hospitalStatus !== conditions.hospitalStatus
    ) {
      throw new EmergencyError(
        "INVALID_TRANSITION",
        `Hospital status is "${em.hospitalStatus}", expected "${conditions.hospitalStatus}"`,
        { emergencyId, currentHospitalStatus: em.hospitalStatus }
      );
    }

    return em;
  }

  // ─── PRIVATE: audit log ───────────────────────────────────────────────────

  private async audit(
    action: string,
    entityId: string,
    actorId: string | null,
    payload?: Record<string, unknown>,
    emitCtx?: { driverId: string; selectedHospitalId: string | null }
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        action,
        entityType: "Emergency",
        entityId,
        actorId,
        payload: payload !== undefined ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    // Emit socket event on every transition (spec rule 8).
    // The caller passes the emergency context so we avoid an extra DB round-trip.
    if (action !== "EMERGENCY_CREATED" && emitCtx) {
      emitEmergencyEvent("emergency:updated", {
        emergencyId: entityId,
        driverId: emitCtx.driverId,
        selectedHospitalId: emitCtx.selectedHospitalId,
        data: { emergencyId: entityId, action, payload },
      });
    }
  }
}
