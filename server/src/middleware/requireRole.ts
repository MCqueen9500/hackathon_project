import type { Request, Response, NextFunction } from "express";
import type { Role, AuthenticatedRequest } from "../types";
import { prisma } from "../lib/prisma";

/**
 * Role-based access middleware factory.
 *
 * Usage: router.get("/queue", authenticate, requireRole("POLICE"), handler)
 *
 * Per spec section 4: "Return 403, not 404, for forbidden resources."
 * Per spec section 11: "Unauthorized access → 403 plus audit log entry."
 */
export function requireRole(...roles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(authReq.user.role as Role)) {
      // Write audit log (fire-and-forget; never block the response)
      void prisma.auditLog.create({
        data: {
          actorId:    authReq.user.sub,
          action:     "ACCESS_DENIED",
          entityType: "ENDPOINT",
          entityId:   req.path,
          payload:    { method: req.method, requiredRoles: roles, actualRole: authReq.user.role },
        },
      }).catch(() => { /* ignore logging failures */ });

      res.status(403).json({
        error: `Forbidden: requires role ${roles.join(" or ")}`,
      });
      return;
    }

    next();
  };
}
