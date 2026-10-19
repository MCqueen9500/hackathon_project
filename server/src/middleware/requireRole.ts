import type { Request, Response, NextFunction } from "express";
import type { Role } from "../types";

/**
 * Role-based access middleware factory.
 *
 * Usage: router.get("/queue", authenticate, requireRole("POLICE"), handler)
 *
 * Per spec section 4: "Return 403, not 404, for forbidden resources."
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({
        error: `Forbidden: requires role ${roles.join(" or ")}`,
      });
      return;
    }

    next();
  };
}
