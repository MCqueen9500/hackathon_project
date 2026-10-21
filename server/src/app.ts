import express from "express";
import helmet from "helmet";
import cors from "cors";
import { allowedOrigins } from "./config/env";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { hospitalRouter } from "./routes/hospital/index";
import { policeRouter } from "./routes/police/index";
import { driverRouter } from "./routes/driver/index";
import { photosRouter } from "./routes/photos/index";
import { signalsRouter } from "./routes/signals/index";

export function createApp() {
  const app = express();

  // ─── Security middleware ─────────────────────────────────────────────────────
  app.use(helmet());

  // CORS: CORS_ORIGIN (comma-separated) plus PUBLIC_ORIGIN (phone HTTPS tunnel)
  const origins = allowedOrigins();
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow server-to-server requests (no origin) and listed origins
        if (!origin || origins.includes(origin)) {
          cb(null, true);
        } else {
          cb(new Error(`CORS: origin ${origin} not in allowlist`));
        }
      },
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
  app.use("/photos", photosRouter);
  app.use("/signals", signalsRouter);

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
      // CORS errors
      if (err.message?.startsWith("CORS:")) {
        res.status(403).json({ error: err.message });
        return;
      }
      console.error("[ERROR]", err.message, err.stack);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
