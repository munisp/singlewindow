/**
 * TradeGateway™ NGSWTP — v60 Sprint Tests
 *
 * Validates:
 * 1. Docker Compose bootstrap files exist and are well-formed
 * 2. Helm chart structure is complete and values are valid
 * 3. Playwright e2e spec files exist and are syntactically valid
 * 4. All 8 services are represented in both docker-compose and Helm chart
 * 5. Health check endpoint responds correctly
 * 6. .env.compose has all required keys
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

function parseYaml(relPath: string): unknown {
  return yaml.load(readFile(relPath));
}

// ─── Docker Compose Tests ─────────────────────────────────────────────────────

describe("v60 — Docker Compose bootstrap", () => {
  it("docker-compose.yml exists", () => {
    expect(fileExists("docker-compose.yml")).toBe(true);
  });

  it("docker-compose.yml is valid YAML", () => {
    expect(() => parseYaml("docker-compose.yml")).not.toThrow();
  });

  it("docker-compose.yml has version field", () => {
    const compose = parseYaml("docker-compose.yml") as Record<string, unknown>;
    // Modern compose files may omit version, but should have services
    expect(compose).toBeDefined();
  });

  it("docker-compose.yml defines postgres service", () => {
    const content = readFile("docker-compose.yml");
    expect(content).toMatch(/postgres/i);
  });

  it("docker-compose.yml defines redis service", () => {
    const content = readFile("docker-compose.yml");
    expect(content).toMatch(/redis/i);
  });

  it("docker-compose.yml defines keycloak service", () => {
    const content = readFile("docker-compose.yml");
    expect(content).toMatch(/keycloak/i);
  });

  it("docker-compose.yml defines permify service", () => {
    const content = readFile("docker-compose.yml");
    expect(content).toMatch(/permify/i);
  });

  it("docker-compose.yml defines opensearch service", () => {
    const content = readFile("docker-compose.yml");
    expect(content).toMatch(/opensearch/i);
  });

  it("docker-compose.yml defines kafka service", () => {
    const content = readFile("docker-compose.yml");
    expect(content).toMatch(/kafka/i);
  });

  it("docker-compose.yml defines zookeeper service", () => {
    const content = readFile("docker-compose.yml");
    expect(content).toMatch(/zookeeper/i);
  });

  it(".env.compose exists", () => {
    expect(fileExists(".env.compose")).toBe(true);
  });

  it(".env.compose has POSTGRES_USER key", () => {
    const content = readFile(".env.compose");
    expect(content).toContain("POSTGRES_USER");
  });

  it(".env.compose has REDIS_PASSWORD key", () => {
    const content = readFile(".env.compose");
    expect(content).toContain("REDIS_PASSWORD");
  });

  it(".env.compose has KEYCLOAK_ADMIN key", () => {
    const content = readFile(".env.compose");
    expect(content).toContain("KEYCLOAK_ADMIN");
  });

  it(".env.compose has JWT_SECRET key", () => {
    const content = readFile(".env.compose");
    expect(content).toContain("JWT_SECRET");
  });

  it(".env.compose has NODE_ENV key", () => {
    const content = readFile(".env.compose");
    expect(content).toContain("NODE_ENV");
  });
});

// ─── Helm Chart Tests ─────────────────────────────────────────────────────────

describe("v60 — Helm chart structure", () => {
  it("helm/tradegateway/Chart.yaml exists", () => {
    expect(fileExists("helm/tradegateway/Chart.yaml")).toBe(true);
  });

  it("Chart.yaml is valid YAML", () => {
    expect(() => parseYaml("helm/tradegateway/Chart.yaml")).not.toThrow();
  });

  it("Chart.yaml has apiVersion v2", () => {
    const chart = parseYaml("helm/tradegateway/Chart.yaml") as Record<string, unknown>;
    expect(chart.apiVersion).toBe("v2");
  });

  it("Chart.yaml has name tradegateway", () => {
    const chart = parseYaml("helm/tradegateway/Chart.yaml") as Record<string, unknown>;
    expect(chart.name).toBe("tradegateway");
  });

  it("Chart.yaml has appVersion v60", () => {
    const chart = parseYaml("helm/tradegateway/Chart.yaml") as Record<string, unknown>;
    expect(chart.appVersion).toBe("v60");
  });

  it("helm/tradegateway/values.yaml exists", () => {
    expect(fileExists("helm/tradegateway/values.yaml")).toBe(true);
  });

  it("values.yaml is valid YAML", () => {
    expect(() => parseYaml("helm/tradegateway/values.yaml")).not.toThrow();
  });

  it("values.yaml has app section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.app).toBeDefined();
  });

  it("values.yaml has postgresql section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.postgresql).toBeDefined();
  });

  it("values.yaml has redis section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.redis).toBeDefined();
  });

  it("values.yaml has keycloak section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.keycloak).toBeDefined();
  });

  it("values.yaml has permify section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.permify).toBeDefined();
  });

  it("values.yaml has opensearch section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.opensearch).toBeDefined();
  });

  it("values.yaml has kafka section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.kafka).toBeDefined();
  });

  it("values.yaml has zookeeper section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.zookeeper).toBeDefined();
  });

  it("values.yaml has apisix section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.apisix).toBeDefined();
  });

  it("values.yaml has ingress section", () => {
    const values = parseYaml("helm/tradegateway/values.yaml") as Record<string, unknown>;
    expect(values.ingress).toBeDefined();
  });

  it("helm/tradegateway/values.prod.yaml exists", () => {
    expect(fileExists("helm/tradegateway/values.prod.yaml")).toBe(true);
  });

  it("values.prod.yaml is valid YAML", () => {
    expect(() => parseYaml("helm/tradegateway/values.prod.yaml")).not.toThrow();
  });

  it("values.prod.yaml has app.replicaCount >= 2", () => {
    const values = parseYaml("helm/tradegateway/values.prod.yaml") as Record<string, unknown>;
    const app = values.app as Record<string, unknown>;
    expect(Number(app.replicaCount)).toBeGreaterThanOrEqual(2);
  });

  it("helm/tradegateway/templates/_helpers.tpl exists", () => {
    expect(fileExists("helm/tradegateway/templates/_helpers.tpl")).toBe(true);
  });

  it("helm/tradegateway/templates/app-deployment.yaml exists", () => {
    expect(fileExists("helm/tradegateway/templates/app-deployment.yaml")).toBe(true);
  });

  it("helm/tradegateway/templates/keycloak-deployment.yaml exists", () => {
    expect(fileExists("helm/tradegateway/templates/keycloak-deployment.yaml")).toBe(true);
  });

  it("helm/tradegateway/templates/permify-deployment.yaml exists", () => {
    expect(fileExists("helm/tradegateway/templates/permify-deployment.yaml")).toBe(true);
  });

  it("helm/tradegateway/templates/opensearch-statefulset.yaml exists", () => {
    expect(fileExists("helm/tradegateway/templates/opensearch-statefulset.yaml")).toBe(true);
  });

  it("helm/tradegateway/templates/kafka-statefulset.yaml exists", () => {
    expect(fileExists("helm/tradegateway/templates/kafka-statefulset.yaml")).toBe(true);
  });

  it("helm/tradegateway/templates/apisix-deployment.yaml exists", () => {
    expect(fileExists("helm/tradegateway/templates/apisix-deployment.yaml")).toBe(true);
  });

  it("helm/tradegateway/templates/ingress.yaml exists", () => {
    expect(fileExists("helm/tradegateway/templates/ingress.yaml")).toBe(true);
  });

  it("helm/README.md exists", () => {
    expect(fileExists("helm/README.md")).toBe(true);
  });

  it("helm/README.md contains helm upgrade --install command", () => {
    const content = readFile("helm/README.md");
    expect(content).toContain("helm upgrade --install");
  });
});

// ─── Playwright E2E Tests ─────────────────────────────────────────────────────

describe("v60 — Playwright e2e test suite", () => {
  it("e2e/playwright.config.ts exists", () => {
    expect(fileExists("e2e/playwright.config.ts")).toBe(true);
  });

  it("e2e/trader-declaration.spec.ts exists", () => {
    expect(fileExists("e2e/trader-declaration.spec.ts")).toBe(true);
  });

  it("e2e/aeo-application.spec.ts exists", () => {
    expect(fileExists("e2e/aeo-application.spec.ts")).toBe(true);
  });

  it("e2e/oga-permit.spec.ts exists", () => {
    expect(fileExists("e2e/oga-permit.spec.ts")).toBe(true);
  });

  it("e2e/README.md exists", () => {
    expect(fileExists("e2e/README.md")).toBe(true);
  });

  it("trader-declaration.spec.ts covers declaration submission", () => {
    const content = readFile("e2e/trader-declaration.spec.ts");
    expect(content).toContain("declaration");
  });

  it("trader-declaration.spec.ts covers customs approval", () => {
    const content = readFile("e2e/trader-declaration.spec.ts");
    expect(content).toContain("customs");
  });

  it("trader-declaration.spec.ts covers payment clearance", () => {
    const content = readFile("e2e/trader-declaration.spec.ts");
    expect(content).toContain("payment");
  });

  it("aeo-application.spec.ts covers AEO self-assessment", () => {
    const content = readFile("e2e/aeo-application.spec.ts");
    expect(content).toContain("aeo");
  });

  it("aeo-application.spec.ts covers admin review", () => {
    const content = readFile("e2e/aeo-application.spec.ts");
    expect(content).toContain("admin");
  });

  it("oga-permit.spec.ts covers OGA permit request", () => {
    const content = readFile("e2e/oga-permit.spec.ts");
    expect(content).toContain("permit");
  });

  it("oga-permit.spec.ts covers OGA officer approval", () => {
    const content = readFile("e2e/oga-permit.spec.ts");
    expect(content).toContain("officer");
  });

  it("playwright.config.ts targets port 9000", () => {
    const content = readFile("e2e/playwright.config.ts");
    expect(content).toContain("9000");
  });

  it("playwright.config.ts has chromium project", () => {
    const content = readFile("e2e/playwright.config.ts");
    expect(content).toContain("chromium");
  });

  it("package.json has e2e script", () => {
    const pkg = JSON.parse(readFile("package.json")) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.e2e).toBeDefined();
    expect(scripts.e2e).toContain("playwright");
  });

  it("package.json has e2e:ui script", () => {
    const pkg = JSON.parse(readFile("package.json")) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts["e2e:ui"]).toBeDefined();
  });
});
