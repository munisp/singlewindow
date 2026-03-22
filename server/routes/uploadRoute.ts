/**
 * /api/upload — Multipart file upload endpoint
 * Accepts a file, uploads it to S3 via storagePut, returns { url, fileKey, fileName, mimeType, fileSizeBytes }
 * Requires authentication (session cookie).
 */
import { Router } from "express";
import multer from "multer";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { sdk } from "../_core/sdk";

const router = Router();

// Store file in memory (max 20MB per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    // Verify session
    let user: any;
    try {
      user = await sdk.authenticateRequest(req as any);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const { originalname, mimetype, buffer, size } = req.file;
    const ext = originalname.split(".").pop() ?? "bin";
    const fileKey = `declaration-documents/${user.id}/${nanoid(12)}.${ext}`;

    const { url } = await storagePut(fileKey, buffer, mimetype);

    res.json({
      url,
      fileKey,
      fileName: originalname,
      mimeType: mimetype,
      fileSizeBytes: size,
    });
  } catch (err: any) {
    console.error("[Upload] Error:", err);
    if (err.message?.includes("not allowed")) {
      res.status(400).json({ error: err.message });
    } else if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "File too large — maximum 20MB" });
    } else {
      res.status(500).json({ error: "Upload failed" });
    }
  }
});

export { router as uploadRouter };
