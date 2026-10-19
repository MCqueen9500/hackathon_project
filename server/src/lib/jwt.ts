import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { JwtPayload } from "../types";

/**
 * Signs a 15-minute access token.
 * Payload includes sub (userId), role, and optional hospitalId.
 */
export function signAccessToken(
  payload: Omit<JwtPayload, "iat" | "exp">
): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions["expiresIn"],
  });
}

/**
 * Verifies and decodes an access token.
 * Throws JsonWebTokenError or TokenExpiredError on failure.
 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}
