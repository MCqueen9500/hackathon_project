import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { hospitalRouter } from "./routes/hospital/index";
import { policeRouter } from "./routes/police/index";
import { driverRouter } from "./routes/driver/index";

export function createApp() {
  const app = express();

  // ─── Security middleware ─────────────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );

  // ─── Body parsers ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Routes ──────────────────────────────────────────────────────────────────
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/hospital", hospitalRouter);
  app.use("/police", policeRouter);

  // Driver routes live at root (mix of /hospitals and /emergencies paths per spec 8)
  app.use("/", driverRouter);

  // ─── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // ─── Global error handler ────────────────────────────────────────────────────
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      // Multer errors (file type / size)
      if (err.message?.startsWith("Only image files") || err.message?.includes("File too large")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("[ERROR]", err.message, err.stack);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
