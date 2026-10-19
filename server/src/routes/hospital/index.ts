import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { driversRouter } from "./drivers";

export const hospitalRouter = Router();

// Driver management sub-router
hospitalRouter.use("/drivers", driversRouter);

// ─── Stub routes (Phase 2 implementation) ────────────────────────────────────
// These stubs exist so RBAC tests can prove a DRIVER gets 403 on these endpoints.
const guardHospitalAdmin = [authenticate, requireRole("HOSPITAL_ADMIN")];

hospitalRouter.get("/incoming", ...guardHospitalAdmin, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

hospitalRouter.post("/emergencies/:id/approve", ...guardHospitalAdmin, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

hospitalRouter.post("/emergencies/:id/reject", ...guardHospitalAdmin, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

hospitalRouter.post("/emergencies/:id/revoke", ...guardHospitalAdmin, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

hospitalRouter.post("/emergencies/:id/confirm-handover", ...guardHospitalAdmin, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});

hospitalRouter.patch("/beds", ...guardHospitalAdmin, (_req, res) => {
  res.status(501).json({ message: "Not implemented yet (Phase 2)" });
});
