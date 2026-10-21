import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("7d"),

  // OpenRouteService (optional — falls back to OSRM if missing/placeholder)
  ORS_API_KEY: z.string().default(""),

  // Demo geography
  DEMO_CENTER_LAT: z.coerce.number(),
  DEMO_CENTER_LNG: z.coerce.number(),
  DEMO_RADIUS_KM: z.coerce.number().positive(),

  // Emergency timers (section 6)
  HOSPITAL_APPROVAL_TIMEOUT_SEC: z.coerce.number().positive().default(90),
  POLICE_APPROVAL_TIMEOUT_SEC: z.coerce.number().positive().default(120),
  BED_HOLD_TTL_MIN: z.coerce.number().positive().default(20),

  // Scheduler
  SCHEDULER_POLL_INTERVAL_MS: z.coerce.number().positive().default(1000),

  // Server
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Uploads
  UPLOAD_MAX_SIZE_MB: z.coerce.number().positive().default(5),
  UPLOAD_DIR: z.string().default("./uploads"),

  // Rate limiting
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(60000),

  // Photo token (HMAC-signed, 5-minute expiry by default)
  PHOTO_HMAC_SECRET: z.string().min(16).default("change-me-photo-hmac-secret-32ch"),
  PHOTO_TOKEN_EXPIRY_SEC: z.coerce.number().positive().default(300),

  // Signal timing (ms). Used by SimulatedSignalController.
  SIGNAL_RED_MS:    z.coerce.number().positive().default(30_000),
  SIGNAL_GREEN_MS:  z.coerce.number().positive().default(25_000),
  SIGNAL_YELLOW_MS: z.coerce.number().positive().default(5_000),

  // Deviation reroute threshold
  DEVIATION_THRESHOLD_M:     z.coerce.number().positive().default(60),
  DEVIATION_CONSECUTIVE_N:   z.coerce.number().positive().default(3),
});

const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error(
    "❌ Invalid environment variables:\n",
    _parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

export const env = _parsed.data;
export type Env = typeof env;
