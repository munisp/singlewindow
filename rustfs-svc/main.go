// rustfs-svc — Go microservice that wraps RustFS (S3-compatible) for the
// TradeGateway Document Vault. Exposes a simple HTTP API consumed by the
// tRPC router over localhost.
//
// Endpoints:
//   POST /upload         — multipart/form-data upload → returns { key, url }
//   POST /scan           — multipart/form-data scan → returns { clean, threat, skipped }
//   GET  /download/:key  — proxy object bytes to client
//   POST /presign        — { key, expiresIn } → { url }
//   DELETE /delete/:key  — remove object
//   GET  /health         — liveness probe
//
// Configuration (environment variables):
//   RUSTFS_ENDPOINT     (default: http://localhost:9000)
//   RUSTFS_ACCESS_KEY   (REQUIRED — no default; boot-refuses when unset)
//   RUSTFS_SECRET_KEY   (REQUIRED — no default; boot-refuses when unset)
//   RUSTFS_BUCKET       (default: tradegateway-docs)
//   RUSTFS_REGION       (default: us-east-1)
//   RUSTFS_SERVICE_TOKEN (REQUIRED in production — bearer token every caller must present;
//                         development falls back to a known dev token with a warning)
//   SVC_PORT            (default: 4500)
//   CLAMSCAN_PATH       (default: clamscan)
//   CLAMSCAN_DB_DIR     (default: /var/lib/clamav)
//
// Security (Phase-6 SW-S2-5):
//   - Every data-plane endpoint (/upload, /scan, /download, /presign, /delete)
//     requires `Authorization: Bearer $RUSTFS_SERVICE_TOKEN` (timing-safe compare).
//   - The only intended caller is the tRPC backend (server/rustfsSvcClient.ts).
//   - Callers must identify themselves with X-Rustfs-Caller; every object key is
//     server-side prefixed with that caller id so one caller cannot read, overwrite,
//     presign or delete another caller's objects. Path traversal (..) is rejected.

package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// ─── Config ──────────────────────────────────────────────────────────────────

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// mustEnv fails closed: a missing secret refuses boot in EVERY environment —
// silently defaulting object-storage credentials is how buckets get hijacked.
func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("[rustfs-svc] FATAL: %s must be set — no default is provided (fail closed)", key)
	}
	return v
}

func isProduction() bool {
	return os.Getenv("APP_ENV") == "production" ||
		os.Getenv("NODE_ENV") == "production" ||
		os.Getenv("GO_ENV") == "production"
}

// devServiceToken is ONLY ever used outside production, with a loud warning.
const devServiceToken = "dev-rustfs-service-token"

func loadServiceToken() string {
	tok := os.Getenv("RUSTFS_SERVICE_TOKEN")
	if isProduction() {
		if tok == "" || tok == devServiceToken || len(tok) < 32 {
			log.Fatalf("[rustfs-svc] FATAL: RUSTFS_SERVICE_TOKEN must be set to a strong secret (>=32 chars, not a dev value) in production")
		}
		return tok
	}
	if tok == "" {
		log.Printf("[rustfs-svc] WARN: RUSTFS_SERVICE_TOKEN unset — using development token; NEVER deploy this configuration")
		return devServiceToken
	}
	return tok
}

var (
	s3Endpoint   = envOr("RUSTFS_ENDPOINT", "http://localhost:9000")
	accessKey    = mustEnv("RUSTFS_ACCESS_KEY")
	secretKey    = mustEnv("RUSTFS_SECRET_KEY")
	bucketName   = envOr("RUSTFS_BUCKET", "tradegateway-docs")
	s3Region     = envOr("RUSTFS_REGION", "us-east-1")
	svcPort      = envOr("SVC_PORT", "4500")
	clamscanPath = envOr("CLAMSCAN_PATH", "clamscan")
	clamDBDir    = envOr("CLAMSCAN_DB_DIR", "/var/lib/clamav")
	serviceToken = loadServiceToken()
)

// ─── S3 client ───────────────────────────────────────────────────────────────

func newS3Client() *s3.Client {
	cfg := aws.Config{
		Region:      s3Region,
		Credentials: credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		EndpointResolverWithOptions: aws.EndpointResolverWithOptionsFunc(
			func(service, reg string, options ...interface{}) (aws.Endpoint, error) {
				return aws.Endpoint{
					URL:               s3Endpoint,
					SigningRegion:     s3Region,
					HostnameImmutable: true,
				}, nil
			},
		),
	}
	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
	})
}

var s3c = newS3Client()

// ─── Auth & key scoping (SW-S2-5) ────────────────────────────────────────────

// requireServiceToken wraps the data-plane mux: every request must present the
// shared service token. Comparison is constant-time. /health stays public for
// orchestrator probes.
func requireServiceToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		const prefix = "Bearer "
		auth := r.Header.Get("Authorization")
		tok := strings.TrimPrefix(auth, prefix)
		provided := []byte(tok)
		expected := []byte(serviceToken)
		if !strings.HasPrefix(auth, prefix) || len(provided) != len(expected) ||
			subtle.ConstantTimeCompare(provided, expected) != 1 {
			jsonError(w, http.StatusUnauthorized, "missing or invalid service token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

var callerSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

// callerPrefix derives the per-caller key namespace from the X-Rustfs-Caller
// header. The tRPC backend is the only intended caller ("trpc-backend").
func callerPrefix(r *http.Request) (string, error) {
	caller := strings.TrimSpace(r.Header.Get("X-Rustfs-Caller"))
	if caller == "" {
		return "", fmt.Errorf("missing X-Rustfs-Caller header")
	}
	safe := callerSanitizer.ReplaceAllString(caller, "_")
	if len(safe) > 64 {
		safe = safe[:64]
	}
	return safe + "/", nil
}

// scopedKey confines a caller-supplied key to the caller's namespace and
// rejects path traversal. Idempotent: an already-prefixed key passes through.
func scopedKey(prefix, key string) (string, error) {
	clean := strings.TrimPrefix(strings.TrimSpace(key), "/")
	if clean == "" {
		return "", fmt.Errorf("key is required")
	}
	for _, seg := range strings.Split(clean, "/") {
		if seg == ".." {
			return "", fmt.Errorf("key must not contain '..' path segments")
		}
	}
	if strings.HasPrefix(clean, prefix) {
		return clean, nil
	}
	return prefix + clean, nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func jsonError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// isClamAVReady returns true if clamscan binary exists AND the virus DB is present.
func isClamAVReady() bool {
	_, err := exec.LookPath(clamscanPath)
	if err != nil {
		return false
	}
	// Check for main.cvd or main.cld in the DB directory
	mainCVD := filepath.Join(clamDBDir, "main.cvd")
	mainCLD := filepath.Join(clamDBDir, "main.cld")
	_, e1 := os.Stat(mainCVD)
	_, e2 := os.Stat(mainCLD)
	return e1 == nil || e2 == nil
}

// scanBytes runs clamscan on the provided bytes in a temp file.
// Returns (clean bool, threat string, err error).
// If ClamAV is not ready, returns (true, "", nil) — graceful skip.
func scanBytes(data []byte, filename string) (clean bool, threat string, skipped bool, err error) {
	if !isClamAVReady() {
		log.Printf("[ClamAV] Virus DB not available — skipping scan for %s", filename)
		return true, "", true, nil
	}

	// Write to a temp file
	tmp, err := os.CreateTemp("", "clamav-scan-*")
	if err != nil {
		return false, "", false, fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmp.Name())

	if _, err = io.Copy(tmp, bytes.NewReader(data)); err != nil {
		tmp.Close()
		return false, "", false, fmt.Errorf("failed to write temp file: %w", err)
	}
	tmp.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, clamscanPath,
		"--no-summary",
		"--database="+clamDBDir,
		tmp.Name(),
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	cmdErr := cmd.Run()
	output := stdout.String() + stderr.String()

	// clamscan exit codes: 0 = clean, 1 = virus found, 2 = error
	if cmd.ProcessState != nil {
		switch cmd.ProcessState.ExitCode() {
		case 0:
			return true, "", false, nil
		case 1:
			// Extract threat name from output: "filename: ThreatName FOUND"
			for _, line := range strings.Split(output, "\n") {
				if strings.Contains(line, "FOUND") {
					parts := strings.Fields(line)
					if len(parts) >= 2 {
						threat = parts[len(parts)-2]
					}
					break
				}
			}
			if threat == "" {
				threat = "UNKNOWN_THREAT"
			}
			return false, threat, false, nil
		default:
			return false, "", false, fmt.Errorf("clamscan error (exit %d): %s", cmd.ProcessState.ExitCode(), output)
		}
	}
	if cmdErr != nil {
		return false, "", false, fmt.Errorf("clamscan failed: %w", cmdErr)
	}
	return true, "", false, nil
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// POST /upload
// multipart/form-data: file (binary), key (string), contentType (string)
func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		jsonError(w, http.StatusBadRequest, "failed to parse multipart: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing file field: "+err.Error())
		return
	}
	defer file.Close()

	key := r.FormValue("key")
	if key == "" {
		key = fmt.Sprintf("uploads/%d-%s", time.Now().UnixMilli(), header.Filename)
	}
	prefix, perr := callerPrefix(r)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	key, perr = scopedKey(prefix, key)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	ct := r.FormValue("contentType")
	if ct == "" {
		ct = header.Header.Get("Content-Type")
	}
	if ct == "" {
		ct = "application/octet-stream"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	_, err = s3c.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucketName),
		Key:         aws.String(key),
		Body:        file,
		ContentType: aws.String(ct),
		ACL:         types.ObjectCannedACLPrivate,
	})
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "upload failed: "+err.Error())
		return
	}

	jsonOK(w, map[string]string{
		"key": key,
		"url": fmt.Sprintf("%s/%s/%s", s3Endpoint, bucketName, key),
	})
}

// POST /scan
// multipart/form-data: file (binary), filename (string, optional)
// Returns: { clean: bool, threat: string|null, skipped: bool }
// - clean=true, threat=null, skipped=false → file is clean
// - clean=false, threat="ThreatName", skipped=false → virus detected, REJECT upload
// - clean=true, threat=null, skipped=true → ClamAV DB unavailable, upload allowed with warning
func handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		jsonError(w, http.StatusBadRequest, "failed to parse multipart: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing file field: "+err.Error())
		return
	}
	defer file.Close()

	filename := r.FormValue("filename")
	if filename == "" {
		filename = header.Filename
	}

	// Read file bytes for scanning
	data, err := io.ReadAll(file)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to read file: "+err.Error())
		return
	}

	clean, threat, skipped, scanErr := scanBytes(data, filename)
	if scanErr != nil {
		log.Printf("[ClamAV] Scan error for %s: %v", filename, scanErr)
		// On scan error, allow upload but mark as skipped
		jsonOK(w, map[string]interface{}{
			"clean":   true,
			"threat":  nil,
			"skipped": true,
			"error":   scanErr.Error(),
		})
		return
	}

	var threatVal interface{} = nil
	if threat != "" {
		threatVal = threat
	}

	log.Printf("[ClamAV] Scan result for %s: clean=%v threat=%v skipped=%v", filename, clean, threat, skipped)

	jsonOK(w, map[string]interface{}{
		"clean":   clean,
		"threat":  threatVal,
		"skipped": skipped,
	})
}

// POST /presign
// Body JSON: { "key": "...", "expiresIn": 3600 }
func handlePresign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var body struct {
		Key       string `json:"key"`
		ExpiresIn int    `json:"expiresIn"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.Key == "" {
		jsonError(w, http.StatusBadRequest, "key is required")
		return
	}
	prefix, perr := callerPrefix(r)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	scoped, perr := scopedKey(prefix, body.Key)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	body.Key = scoped
	if body.ExpiresIn <= 0 {
		body.ExpiresIn = 3600
	}

	presignClient := s3.NewPresignClient(s3c)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(body.Key),
	}, s3.WithPresignExpires(time.Duration(body.ExpiresIn)*time.Second))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "presign failed: "+err.Error())
		return
	}
	jsonOK(w, map[string]string{"url": req.URL})
}

// DELETE /delete/{key}
func handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonError(w, http.StatusMethodNotAllowed, "DELETE required")
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/delete/")
	if key == "" {
		jsonError(w, http.StatusBadRequest, "key is required in path")
		return
	}
	prefix, perr := callerPrefix(r)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	key, perr = scopedKey(prefix, key)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	_, err := s3c.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "delete failed: "+err.Error())
		return
	}
	jsonOK(w, map[string]bool{"deleted": true})
}

// GET /download/{key}
func handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, http.StatusMethodNotAllowed, "GET required")
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/download/")
	if key == "" {
		jsonError(w, http.StatusBadRequest, "key is required in path")
		return
	}
	prefix, perr := callerPrefix(r)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	key, perr = scopedKey(prefix, key)
	if perr != nil {
		jsonError(w, http.StatusBadRequest, perr.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	out, err := s3c.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		jsonError(w, http.StatusNotFound, "object not found: "+err.Error())
		return
	}
	defer out.Body.Close()

	if out.ContentType != nil {
		w.Header().Set("Content-Type", *out.ContentType)
	}
	if out.ContentLength != nil {
		w.Header().Set("Content-Length", strconv.FormatInt(*out.ContentLength, 10))
	}
	fname := key[strings.LastIndex(key, "/")+1:]
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fname))
	io.Copy(w, out.Body)
}

// GET /health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{
		"status":       "ok",
		"service":      "rustfs-svc",
		"endpoint":     s3Endpoint,
		"bucket":       bucketName,
		"clamavReady":  isClamAVReady(),
		"time":         time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Main ────────────────────────────────────────────────────────────────────

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/upload", handleUpload)
	mux.HandleFunc("/scan", handleScan)
	mux.HandleFunc("/presign", handlePresign)
	mux.HandleFunc("/delete/", handleDelete)
	mux.HandleFunc("/download/", handleDownload)
	mux.HandleFunc("/health", handleHealth)

	addr := ":" + svcPort
	log.Printf("[rustfs-svc] Listening on %s | bucket=%s | endpoint=%s | clamavReady=%v | auth=service-token",
		addr, bucketName, s3Endpoint, isClamAVReady())
	if err := http.ListenAndServe(addr, requireServiceToken(mux)); err != nil {
		log.Fatalf("[rustfs-svc] Fatal: %v", err)
	}
}
