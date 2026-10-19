import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";

export const policeRouter = Router();

// ─── All police routes require POLICE role ────────────────────────────────────
const guardPolice = [authenticate, requireRole("POLICE")];

// ─── Stub routes (Phase 2 implementation) ────────────────────────────────────
// These stubs exist so RBAC tests can prove a DRIVER / HOSPITAL_ADMIN gets 403.
policeRouter.get("/queue", ...guardPolice, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

policeRouter.post("/emergencies/:id/verify", ...guardPolice, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

policeRouter.post("/emergencies/:id/reject", ...guardPolice, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

policeRouter.post("/closures", ...guardPolice, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

policeRouter.delete("/closures/:id", ...guardPolice, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

policeRouter.get("/closures", ...guardPolice, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});
