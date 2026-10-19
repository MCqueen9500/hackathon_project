import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import type { JwtPayload } from "../types";

// ─── Extend Express Request globally ─────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * JWT authentication middleware.
 *
 * 1. Extracts the Bearer token from the Authorization header.
 * 2. Verifies the token signature and expiry.
 * 3. Looks up the user in the DB to check `active`.
 *    Per spec section 12: "driver account lockout on deactivation takes effect
 *    immediately (check `active` on every request)."
 * 4. Attaches `req.user` (JWT payload) for downstream middleware.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  let payload: JwtPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { active: true },
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (!user.active) {
      res.status(403).json({ error: "Account has been deactivated" });
      return;
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error during authentication" });
    return;
  }

  req.user = payload;
  next();
}
