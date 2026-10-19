import type { Request } from "express";

/**
 * Shared TypeScript types mirroring the Prisma enums + domain models.
 * These are used across routes, services, and socket handlers so we have
 * a single source of truth that doesn't require importing the Prisma client
 * everywhere (which drags in the DB connection).
 */

export type Role = "DRIVER" | "HOSPITAL_ADMIN" | "POLICE";

export type EmergencyStatus =
  | "PENDING_APPROVALS"
  | "ACTIVE"
  | "ARRIVED"
  | "CLOSED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type Severity = "CRITICAL" | "SERIOUS" | "STABLE";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "TIMED_OUT";

export type BedHoldStatus = "HELD" | "CONSUMED" | "RELEASED" | "EXPIRED";

export type LocationSource = "GPS" | "SIMULATOR";

/** JWT payload stored in the access token */
export interface JwtPayload {
  sub: string;       // userId
  role: Role;
  hospitalId?: string;
  iat?: number;
  exp?: number;
}

/** Authenticated request extension */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

