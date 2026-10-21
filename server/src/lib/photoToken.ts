/**
 * lib/photoToken.ts
 *
 * HMAC-SHA256 signed tokens for photo access (spec §17.4).
 *
 * Token format (URL-safe base64): `<expiresAtUnixSec>.<emergencyId>.<hmac>`
 *
 * Properties:
 *   - Tied to a specific emergencyId — cannot be used for another emergency's photo
 *   - Expires after PHOTO_TOKEN_EXPIRY_SEC seconds (default 5 min)
 *   - Constant-time comparison guards against timing attacks
 */

import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";

const SEP = ".";

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", env.PHOTO_HMAC_SECRET)
    .update(payload)
    .digest("base64url");
}

/**
 * Generate a signed photo token for the given emergencyId.
 * Token is valid for PHOTO_TOKEN_EXPIRY_SEC seconds from now.
 */
export function signPhotoToken(emergencyId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + env.PHOTO_TOKEN_EXPIRY_SEC;
  const payload   = `${expiresAt}${SEP}${b64url(emergencyId)}`;
  const hmac      = sign(payload);
  return `${payload}${SEP}${hmac}`;
}

/**
 * Build a full signed photo URL for inclusion in API responses.
 * e.g. /photos/<emergencyId>?token=<signed>
 */
export function photoUrl(emergencyId: string): string {
  return `/photos/${encodeURIComponent(emergencyId)}?token=${encodeURIComponent(signPhotoToken(emergencyId))}`;
}

export type VerifyResult =
  | { ok: true;  emergencyId: string }
  | { ok: false; reason: "EXPIRED" | "INVALID" };

/**
 * Verify a photo token.
 * Returns { ok: true, emergencyId } on success or { ok: false, reason } on failure.
 */
export function verifyPhotoToken(token: string, claimedEmergencyId: string): VerifyResult {
  const parts = token.split(SEP);
  if (parts.length !== 3) return { ok: false, reason: "INVALID" };
  const [expiresAtStr, encodedId, hmac] = parts;

  const payload  = `${expiresAtStr}${SEP}${encodedId}`;
  const expected = sign(payload);

  // Constant-time comparison
  const expectedBuf = Buffer.from(expected);
  const actualBuf   = Buffer.from(hmac);
  const lengthMatch = expectedBuf.length === actualBuf.length;
  if (!lengthMatch || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "INVALID" };
  }

  // Decode and match the emergencyId embedded in the token
  let embeddedId: string;
  try {
    embeddedId = Buffer.from(encodedId, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  if (embeddedId !== claimedEmergencyId) return { ok: false, reason: "INVALID" };

  // Check expiry
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) {
    return { ok: false, reason: "EXPIRED" };
  }

  return { ok: true, emergencyId: claimedEmergencyId };
}
