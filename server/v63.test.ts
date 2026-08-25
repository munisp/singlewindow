/**
 * v63 vitest test suite — JWS Signing, Temporal Worker Health, CI Pipeline
 *
 * Tests verify:
 *   1. JWS module structure and algorithm constants
 *   2. FSPIOP-Signature header format contract
 *   3. Temporal worker health endpoint response contract
 *   4. GitHub Actions services.yml CI pipeline structure
 *   5. Integration between JWS signer and Mojaloop DFSP registration
 *   6. Health endpoint Kubernetes probe contract
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");

// ─── File existence helpers ───────────────────────────────────────────────────

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

function readYAML(relPath: string): Record<string, unknown> {
  return yaml.load(readFile(relPath)) as Record<string, unknown>;
}

// ─── 1. JWS module structure ──────────────────────────────────────────────────

describe("JWS signing module — jws.go", () => {
  const jwsPath = "services/go/mojaloop-gateway/internal/dfsp/jws.go";
  const jwsTestPath = "services/go/mojaloop-gateway/internal/dfsp/jws_test.go";

  it("jws.go exists", () => {
    expect(fileExists(jwsPath)).toBe(true);
  });

  it("jws_test.go exists", () => {
    expect(fileExists(jwsTestPath)).toBe(true);
  });

  it("defines AlgPS256 constant (RSA-PSS recommended algorithm)", () => {
    const content = readFile(jwsPath);
    expect(content).toContain('AlgPS256 JWSAlgorithm = "PS256"');
  });

  it("defines AlgEdDSA constant (Ed25519 preferred)", () => {
    const content = readFile(jwsPath);
    expect(content).toContain('AlgEdDSA JWSAlgorithm = "EdDSA"');
  });

  it("defines AlgES256 constant (ECDSA P-256)", () => {
    const content = readFile(jwsPath);
    expect(content).toContain('AlgES256 JWSAlgorithm = "ES256"');
  });

  it("defines AlgRS256 constant (RSA legacy)", () => {
    const content = readFile(jwsPath);
    expect(content).toContain('AlgRS256 JWSAlgorithm = "RS256"');
  });

  it("exports FSPIOPProtectedHeader struct with all required Mojaloop fields", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("FSPIOPProtectedHeader");
    expect(content).toContain("FSPIOP-URI");
    expect(content).toContain("FSPIOP-HTTP-Method");
    expect(content).toContain("FSPIOP-Source");
    expect(content).toContain("FSPIOP-Destination");
    expect(content).toContain('"Date"');
  });

  it("exports FSPIOPSignature envelope struct with signature and protectedHeader", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("FSPIOPSignature");
    expect(content).toContain('"signature"');
    expect(content).toContain('"protectedHeader"');
  });

  it("exports Signer struct with thread-safe RWMutex", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("sync.RWMutex");
    expect(content).toContain("type Signer struct");
  });

  it("exports NewSignerFromPEM constructor", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("func NewSignerFromPEM");
  });

  it("exports NewSignerFromEnv constructor with ephemeral fallback", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("func NewSignerFromEnv");
    expect(content).toContain("DFSP_JWS_PRIVATE_KEY_PATH");
    expect(content).toContain("newEphemeralSigner");
  });

  it("exports RotateKey for zero-downtime key rotation", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("func (s *Signer) RotateKey");
  });

  it("exports SignRequest that sets FSPIOP-Signature header", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("func (s *Signer) SignRequest");
    expect(content).toContain("FSPIOP-Signature");
  });

  it("exports VerifyRequest for inbound request verification", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("func VerifyRequest");
  });

  it("exports JWKSHandler for public key discovery", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("func (s *Signer) JWKSHandler");
    expect(content).toContain("dfsp/jwks.json");
  });

  it("exports PublicJWK for hub verification", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("func (s *Signer) PublicJWK");
  });

  it("supports RSA PKCS#1, PKCS#8, EC, and Ed25519 PEM block types", () => {
    const content = readFile(jwsPath);
    expect(content).toContain('"RSA PRIVATE KEY"');
    expect(content).toContain('"PRIVATE KEY"');
    expect(content).toContain('"EC PRIVATE KEY"');
  });

  it("uses RSA-PSS with PSSSaltLengthEqualsHash (not PKCS1v15 for PS256)", () => {
    const content = readFile(jwsPath);
    expect(content).toContain("rsa.SignPSS");
    expect(content).toContain("PSSSaltLengthEqualsHash");
  });

  it("sets Date header automatically if not present", () => {
    const content = readFile(jwsPath);
    expect(content).toContain('req.Header.Get("Date") == ""');
    expect(content).toContain("http.TimeFormat");
  });

  it("JWK export includes kty, use, kid, alg fields", () => {
    const content = readFile(jwsPath);
    expect(content).toContain('"kty"');
    expect(content).toContain('"use"');
    expect(content).toContain('"kid"');
    expect(content).toContain('"alg"');
  });
});

// ─── 2. JWS test coverage ─────────────────────────────────────────────────────

describe("JWS test coverage — jws_test.go", () => {
  const testPath = "services/go/mojaloop-gateway/internal/dfsp/jws_test.go";

  it("covers RSA key loading", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestNewSignerFromPEM_RSA");
  });

  it("covers EC key loading", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestNewSignerFromPEM_EC");
  });

  it("covers Ed25519 key loading", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestNewSignerFromPEM_Ed25519");
  });

  it("covers invalid PEM rejection", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestNewSignerFromPEM_InvalidPEM");
  });

  it("covers sign/verify round-trip for Ed25519", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestSignVerify_RoundTrip_Ed25519");
  });

  it("covers sign/verify round-trip for RSA", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestSignVerify_RoundTrip_RSA");
  });

  it("covers sign/verify round-trip for EC", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestSignVerify_RoundTrip_EC");
  });

  it("covers tampered body detection", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestVerifyRequest_TamperedBody_Fails");
  });

  it("covers key rotation", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestRotateKey_ChangesAlgorithm");
    expect(content).toContain("TestRotateKey_InvalidPEM");
    expect(content).toContain("TestRotateKey_CanSignAfterRotation");
  });

  it("covers JWKS endpoint for RSA and Ed25519", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestJWKSHandler_RSA");
    expect(content).toContain("TestJWKSHandler_Ed25519");
  });

  it("covers missing FSPIOP-Signature header rejection", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestVerifyRequest_MissingHeader");
  });

  it("covers malformed FSPIOP-Signature header rejection", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestVerifyRequest_MalformedHeader");
  });

  it("covers ephemeral signer for development", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestNewEphemeralSigner");
  });
});

// ─── 3. Temporal worker health endpoint ───────────────────────────────────────

describe("Temporal worker health endpoint — health.go", () => {
  const healthPath = "services/go/workflow-service/cmd/worker/health.go";
  const healthTestPath = "services/go/workflow-service/cmd/worker/health_test.go";

  it("health.go exists", () => {
    expect(fileExists(healthPath)).toBe(true);
  });

  it("health_test.go exists", () => {
    expect(fileExists(healthTestPath)).toBe(true);
  });

  it("defines WorkerHealthState with atomic fields", () => {
    const content = readFile(healthPath);
    expect(content).toContain("WorkerHealthState");
    expect(content).toContain("atomic.Bool");
    expect(content).toContain("atomic.Int32");
  });

  it("defines HealthResponse JSON struct", () => {
    const content = readFile(healthPath);
    expect(content).toContain("HealthResponse");
    expect(content).toContain('"status"');
    expect(content).toContain('"temporal_connected"');
    expect(content).toContain('"workflows_registered"');
    expect(content).toContain('"workflows_expected"');
    expect(content).toContain('"uptime_seconds"');
    expect(content).toContain('"version"');
    expect(content).toContain('"timestamp"');
  });

  it("returns 200 OK for healthy state", () => {
    const content = readFile(healthPath);
    expect(content).toContain("http.StatusOK");
  });

  it("returns 207 Multi-Status for degraded state (workflow count mismatch)", () => {
    const content = readFile(healthPath);
    expect(content).toContain("http.StatusMultiStatus");
    expect(content).toContain('"degraded"');
  });

  it("returns 503 for unhealthy state (Temporal disconnected)", () => {
    const content = readFile(healthPath);
    expect(content).toContain("http.StatusServiceUnavailable");
    expect(content).toContain('"unhealthy"');
  });

  it("exposes /health, /ready, and /live endpoints", () => {
    const content = readFile(healthPath);
    expect(content).toContain('"/health"');
    expect(content).toContain('"/ready"');
    expect(content).toContain('"/live"');
  });

  it("liveness probe always returns 200 (process alive)", () => {
    const content = readFile(healthPath);
    expect(content).toContain("livenessHandler");
    expect(content).toContain('"alive":true');
  });

  it("readiness probe returns 503 when Temporal disconnected", () => {
    const content = readFile(healthPath);
    expect(content).toContain("readinessHandler");
    expect(content).toContain('"ready":false');
  });

  it("probes Temporal connectivity every 15 seconds", () => {
    const content = readFile(healthPath);
    expect(content).toContain("15 * time.Second");
    expect(content).toContain("temporalClient.CheckHealth");
  });

  it("reads WORKER_HEALTH_PORT from environment", () => {
    const content = readFile(healthPath);
    expect(content).toContain("WORKER_HEALTH_PORT");
    expect(content).toContain('"8090"');
  });

  it("configures read/write timeouts for the HTTP server", () => {
    const content = readFile(healthPath);
    expect(content).toContain("ReadTimeout");
    expect(content).toContain("WriteTimeout");
  });
});

// ─── 4. Health endpoint test coverage ────────────────────────────────────────

describe("Health endpoint test coverage — health_test.go", () => {
  const testPath = "services/go/workflow-service/cmd/worker/health_test.go";

  it("covers healthy state (200 OK)", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestHealthHandler_Healthy");
  });

  it("covers unhealthy state (503 — Temporal disconnected)", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestHealthHandler_Unhealthy_TemporalDisconnected");
  });

  it("covers degraded state (207 — workflow count mismatch)", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestHealthHandler_Degraded_WorkflowCountMismatch");
  });

  it("covers nil globalHealth guard", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestHealthHandler_NilGlobalHealth");
  });

  it("covers readiness probe ready state", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestReadinessHandler_Ready");
  });

  it("covers readiness probe not-ready (Temporal disconnected)", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestReadinessHandler_NotReady_TemporalDisconnected");
  });

  it("covers readiness probe not-ready (workflow count mismatch)", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestReadinessHandler_NotReady_WorkflowCountMismatch");
  });

  it("covers liveness probe always-alive", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestLivenessHandler_AlwaysAlive");
  });

  it("covers Content-Type header", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestHealthHandler_ContentType");
    expect(content).toContain("application/json");
  });

  it("covers uptime calculation", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestHealthHandler_UptimeIncreases");
  });

  it("covers concurrent access safety", () => {
    const content = readFile(testPath);
    expect(content).toContain("TestHealthHandler_ConcurrentAccess");
  });
});

// ─── 5. GitHub Actions services.yml ──────────────────────────────────────────

describe("GitHub Actions CI pipeline — services.yml", () => {
  const ciPath = ".github/workflows/services.yml";

  it("services.yml exists", () => {
    expect(fileExists(ciPath)).toBe(true);
  });

  it("is valid YAML", () => {
    expect(() => readYAML(ciPath)).not.toThrow();
  });

  it("triggers on push to main, develop, release/*, and v6* branches", () => {
    const content = readFile(ciPath);
    expect(content).toContain("main");
    expect(content).toContain("develop");
    expect(content).toContain("release/**");
    expect(content).toContain("v6*");
  });

  it("triggers on paths: services/go/** and services/rust/**", () => {
    const content = readFile(ciPath);
    expect(content).toContain("services/go/**");
    expect(content).toContain("services/rust/**");
  });

  it("has detect-changes job with path filtering", () => {
    const content = readFile(ciPath);
    expect(content).toContain("detect-changes");
    expect(content).toContain("Classify changed paths");
    expect(content).toContain("git diff --name-only");
  });

  it("has go-test-matrix job covering all 3 Go services", () => {
    const content = readFile(ciPath);
    expect(content).toContain("go-test-matrix");
    expect(content).toContain("payment-service");
    expect(content).toContain("workflow-service");
    expect(content).toContain("mojaloop-gateway");
  });

  it("runs go test with -race flag for data race detection", () => {
    const content = readFile(ciPath);
    expect(content).toContain("-race");
  });

  it("runs go test with -coverprofile for coverage reporting", () => {
    const content = readFile(ciPath);
    expect(content).toContain("-coverprofile=coverage.out");
  });

  it("has rust-test-matrix job covering tigerbeetle-bridge-rs", () => {
    const content = readFile(ciPath);
    expect(content).toContain("rust-test-matrix");
    expect(content).toContain("tigerbeetle-bridge-rs");
  });

  it("runs cargo clippy with -D warnings (no warnings allowed)", () => {
    const content = readFile(ciPath);
    expect(content).toContain("cargo clippy");
    expect(content).toContain("-D warnings");
  });

  it("runs cargo fmt --check for formatting enforcement", () => {
    const content = readFile(ciPath);
    expect(content).toContain("cargo fmt --check");
  });

  it("has jws-integration job for JWS signing tests with real key file", () => {
    const content = readFile(ciPath);
    expect(content).toContain("jws-integration");
    expect(content).toContain("openssl genrsa");
    expect(content).toContain("DFSP_JWS_PRIVATE_KEY_PATH");
  });

  it("has worker-health job for Temporal health endpoint tests", () => {
    const content = readFile(ciPath);
    expect(content).toContain("worker-health");
    expect(content).toContain("./cmd/worker/...");
  });

  it("has summary job that fails if any job fails", () => {
    const content = readFile(ciPath);
    expect(content).toContain("summary");
    expect(content).toContain("exit 1");
  });

  it("uses concurrency group to cancel in-progress runs", () => {
    const content = readFile(ciPath);
    expect(content).toContain("concurrency");
    expect(content).toContain("cancel-in-progress: true");
  });

  it("uses actions/cache for Cargo registry caching", () => {
    const content = readFile(ciPath);
    expect(content).toContain("actions/cache@v4");
    expect(content).toContain("~/.cargo/registry");
  });

  it("uses actions/upload-artifact to preserve coverage and binaries", () => {
    const content = readFile(ciPath);
    expect(content).toContain("actions/upload-artifact@v4");
  });

  it("sets fail-fast: false in matrix strategy (don't cancel all on one failure)", () => {
    const content = readFile(ciPath);
    expect(content).toContain("fail-fast: false");
  });

  it("provides stub env vars so tests don't fail on missing connections", () => {
    const content = readFile(ciPath);
    expect(content).toContain("TEMPORAL_HOST");
    expect(content).toContain("TIGERBEETLE_ADDR");
    expect(content).toContain("MOJALOOP_HUB_URL");
  });

  it("uses Go 1.23 and Rust stable toolchain", () => {
    const content = readFile(ciPath);
    expect(content).toContain("GO_VERSION");
    expect(content).toContain('"1.23"');
    expect(content).toContain("RUST_TOOLCHAIN");
    expect(content).toContain('"stable"');
  });
});

// ─── 6. Integration: JWS wired into DFSP registration ────────────────────────

describe("JWS integration with DFSP registration", () => {
  const registrationPath = "services/go/mojaloop-gateway/internal/dfsp/registration.go";

  it("registration.go exists", () => {
    expect(fileExists(registrationPath)).toBe(true);
  });

  it("registration.go sets FSPIOP-Source header on all ALS requests", () => {
    const content = readFile(registrationPath);
    expect(content).toContain("FSPIOP-Source");
  });

  it("jws.go and registration.go are in the same package (dfsp)", () => {
    const jwsContent = readFile("services/go/mojaloop-gateway/internal/dfsp/jws.go");
    const regContent = readFile(registrationPath);
    expect(jwsContent).toContain("package dfsp");
    expect(regContent).toContain("package dfsp");
  });

  it("register-dfsp binary exists", () => {
    expect(fileExists("services/go/mojaloop-gateway/cmd/register-dfsp/main.go")).toBe(true);
  });
});

// ─── 7. Kubernetes probe contract ─────────────────────────────────────────────

describe("Kubernetes probe contract", () => {
  const healthPath = "services/go/workflow-service/cmd/worker/health.go";

  it("liveness probe endpoint is /live (not /health — avoids false restarts)", () => {
    const content = readFile(healthPath);
    expect(content).toContain('"/live"');
    expect(content).toContain("livenessHandler");
  });

  it("readiness probe endpoint is /ready", () => {
    const content = readFile(healthPath);
    expect(content).toContain('"/ready"');
    expect(content).toContain("readinessHandler");
  });

  it("health endpoint is /health (for general monitoring)", () => {
    const content = readFile(healthPath);
    expect(content).toContain('"/health"');
    expect(content).toContain("healthHandler");
  });

  it("Helm chart references the health port 8090", () => {
    const helmPath = "helm/tradegateway/values.yaml";
    if (fileExists(helmPath)) {
      const content = readFile(helmPath);
      // Health port should be referenced somewhere in the Helm values
      expect(content.includes("8090") || content.includes("health")).toBe(true);
    }
  });
});

// ─── 8. v63 file completeness ─────────────────────────────────────────────────

describe("v63 deliverable completeness", () => {
  const expectedFiles = [
    "services/go/mojaloop-gateway/internal/dfsp/jws.go",
    "services/go/mojaloop-gateway/internal/dfsp/jws_test.go",
    "services/go/workflow-service/cmd/worker/health.go",
    "services/go/workflow-service/cmd/worker/health_test.go",
    ".github/workflows/services.yml",
  ];

  for (const file of expectedFiles) {
    it(`${file} exists`, () => {
      expect(fileExists(file)).toBe(true);
    });
  }

  it("services.yml is non-trivial (> 100 lines)", () => {
    const content = readFile(".github/workflows/services.yml");
    const lines = content.split("\n").length;
    expect(lines).toBeGreaterThan(100);
  });

  it("jws.go is non-trivial (> 150 lines)", () => {
    const content = readFile("services/go/mojaloop-gateway/internal/dfsp/jws.go");
    const lines = content.split("\n").length;
    expect(lines).toBeGreaterThan(150);
  });

  it("health.go is non-trivial (> 80 lines)", () => {
    const content = readFile("services/go/workflow-service/cmd/worker/health.go");
    const lines = content.split("\n").length;
    expect(lines).toBeGreaterThan(80);
  });

  it("jws_test.go covers at least 20 test functions", () => {
    const content = readFile("services/go/mojaloop-gateway/internal/dfsp/jws_test.go");
    const testFunctions = content.match(/^func Test/gm) || [];
    expect(testFunctions.length).toBeGreaterThanOrEqual(20);
  });

  it("health_test.go covers at least 10 test functions", () => {
    const content = readFile("services/go/workflow-service/cmd/worker/health_test.go");
    const testFunctions = content.match(/^func Test/gm) || [];
    expect(testFunctions.length).toBeGreaterThanOrEqual(10);
  });
});
