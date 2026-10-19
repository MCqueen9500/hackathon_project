/**
 * upload.ts — Multer configuration for photo uploads
 *
 * Per spec section 12:
 *   "upload limits (image/* only, max 5 MB, random filename)"
 *   "Files: photo uploads stored on local disk (/server/uploads)"
 */

import multer from "multer";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { resolve, extname } from "path";
import { env } from "../config/env";

const UPLOAD_DIR = resolve(process.cwd(), env.UPLOAD_DIR);

// Ensure directory exists on startup
mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Random UUID filename; keep original extension for content-type sniffing
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (image/*)"));
  }
}

export const photoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024,
    files: 1,
  },
});

export { UPLOAD_DIR };
