/**
 * rustfsSvcClient.ts
 *
 * HTTP client for the Go rustfs-svc microservice running on port 4500.
 * The Go service wraps RustFS (S3-compatible object storage) and exposes
 * a simple REST API for upload, presign, delete, and download operations.
 *
 * All file bytes live in RustFS; this module handles the plumbing between
 * the tRPC router and the Go service.
 */

const RUSTFS_SVC_URL = process.env.RUSTFS_SVC_URL ?? "http://localhost:4500";

export interface UploadResult {
  key: string;
  url: string;
}

export interface PresignResult {
  url: string;
}

/**
 * Upload a file buffer to RustFS via the Go microservice.
 * Returns the S3 key and a direct (non-presigned) internal URL.
 */
export async function rustfsUpload(
  fileBuffer: Buffer,
  key: string,
  contentType: string
): Promise<UploadResult> {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("file", fileBuffer, {
    filename: key.split("/").pop() ?? "file",
    contentType,
  });
  form.append("key", key);
  form.append("contentType", contentType);

  const res = await fetch(`${RUSTFS_SVC_URL}/upload`, {
    method: "POST",
    body: form as unknown as BodyInit,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rustfs-svc upload failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<UploadResult>;
}

/**
 * Generate a presigned GET URL for a stored object.
 * The URL is valid for `expiresIn` seconds (default: 1 hour).
 */
export async function rustfsPresign(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const res = await fetch(`${RUSTFS_SVC_URL}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, expiresIn }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rustfs-svc presign failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as PresignResult;
  return data.url;
}

/**
 * Permanently delete an object from RustFS.
 */
export async function rustfsDelete(key: string): Promise<void> {
  const encodedKey = encodeURIComponent(key);
  const res = await fetch(`${RUSTFS_SVC_URL}/delete/${encodedKey}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rustfs-svc delete failed (${res.status}): ${text}`);
  }
}

export interface ScanResult {
  /** true if the file is clean or the scan was skipped */
  clean: boolean;
  /** threat name if a virus was detected, null otherwise */
  threat: string | null;
  /** true when ClamAV virus DB is unavailable — upload is allowed with a warning */
  skipped: boolean;
  /** optional error message from the scanner */
  error?: string;
}

/**
 * Scan a file buffer for viruses using ClamAV via the Go microservice.
 * Returns { clean: true, skipped: true } when the ClamAV virus DB is not
 * available (graceful degradation — do not block the upload).
 * Returns { clean: false, threat: "ThreatName" } when a virus is detected.
 */
export async function rustfsScan(
  fileBuffer: Buffer,
  filename: string
): Promise<ScanResult> {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("file", fileBuffer, {
    filename,
    contentType: "application/octet-stream",
  });
  form.append("filename", filename);

  try {
    const res = await fetch(`${RUSTFS_SVC_URL}/scan`, {
      method: "POST",
      body: form as unknown as BodyInit,
      headers: form.getHeaders(),
      signal: AbortSignal.timeout(90_000), // ClamAV can be slow on large files
    });

    if (!res.ok) {
      const text = await res.text();
      // On scan service error, allow upload with skipped=true
      console.warn(`[rustfsScan] Scan service error (${res.status}): ${text}`);
      return { clean: true, threat: null, skipped: true, error: text };
    }

    return res.json() as Promise<ScanResult>;
  } catch (err) {
    // Network error reaching the scan service — allow upload with warning
    console.warn(`[rustfsScan] Could not reach scan service: ${err}`);
    return { clean: true, threat: null, skipped: true, error: String(err) };
  }
}

/**
 * Check if the Go microservice is reachable.
 */
export async function rustfsHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${RUSTFS_SVC_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
