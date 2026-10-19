import type { Request, Response, NextFunction } from "express";
import type { Role, AuthenticatedRequest } from "../types";

/**
 * Role-based access middleware factory.
 *
 * Usage: router.get("/queue", authenticate, requireRole("POLICE"), handler)
 *
 * Per spec section 4: "Return 403, not 404, for forbidden resources."
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // After `authenticate`, req.user is always set; cast to access it safely.
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(authReq.user.role as Role)) {
      res.status(403).json({
        error: `Forbidden: requires role ${roles.join(" or ")}`,
      });
      return;
    }

    next();
  };
}
