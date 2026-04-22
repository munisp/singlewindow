/**
 * k6 Load Test — TradeGateway™ NGSWTP
 * Run: k6 run scripts/load-test.js
 * Run with env: k6 run --env BASE_URL=https://your-domain.com scripts/load-test.js
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";

const errorRate = new Rate("errors");
const healthLatency = new Trend("health_latency");
const trpcLatency = new Trend("trpc_latency");
const requestCount = new Counter("requests_total");

export const options = {
  scenarios: {
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "1m", target: 50 },
        { duration: "2m", target: 100 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 0 },
        { duration: "5s", target: 200 },
        { duration: "30s", target: 200 },
        { duration: "5s", target: 0 },
      ],
      startTime: "3m30s",
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_duration: ["p(50)<100", "p(95)<500", "p(99)<1000"],
    health_latency: ["p(95)<50"],
    trpc_latency: ["p(95)<300"],
    errors: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

function getHeaders(withAuth) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Accept-Encoding": "gzip, deflate",
  };
  if (withAuth && AUTH_TOKEN) {
    headers["Cookie"] = "session=" + AUTH_TOKEN;
  }
  return headers;
}

export default function () {
  group("Health Checks", function() {
    const start = Date.now();
    const res = http.get(BASE_URL + "/api/health", { headers: getHeaders(false) });
    healthLatency.add(Date.now() - start);
    requestCount.add(1);
    const ok = check(res, {
      "health status 200": function(r) { return r.status === 200; },
      "health body ok": function(r) {
        try { return JSON.parse(r.body).status === "ok"; } catch(e) { return false; }
      },
      "health < 100ms": function(r) { return r.timings.duration < 100; },
      "has X-Response-Time": function(r) { return !!r.headers["X-Response-Time"]; },
    });
    errorRate.add(!ok);
  });

  sleep(0.1);

  group("Security Headers", function() {
    const res = http.get(BASE_URL + "/", { headers: getHeaders(false) });
    requestCount.add(1);
    const ok = check(res, {
      "has X-Content-Type-Options": function(r) { return !!r.headers["X-Content-Type-Options"]; },
      "has X-Frame-Options": function(r) { return !!r.headers["X-Frame-Options"]; },
      "has HSTS": function(r) { return !!r.headers["Strict-Transport-Security"]; },
    });
    errorRate.add(!ok);
  });

  sleep(0.1);

  group("tRPC Public Endpoints", function() {
    var endpoints = [
      { name: "portCongestion.getAllForecasts", input: { limit: 10, offset: 0 } },
      { name: "portCongestion.getNetworkSummary", input: {} },
    ];
    for (var i = 0; i < endpoints.length; i++) {
      var ep = endpoints[i];
      var start = Date.now();
      var url = BASE_URL + "/api/trpc/" + ep.name + "?input=" + encodeURIComponent(JSON.stringify({ json: ep.input }));
      var res = http.get(url, { headers: getHeaders(false) });
      trpcLatency.add(Date.now() - start);
      requestCount.add(1);
      var ok = check(res, {
        "trpc returns 200": function(r) { return r.status === 200; },
      });
      errorRate.add(!ok);
    }
  });

  sleep(0.5);
}

export function setup() {
  console.log("TradeGateway NGSWTP Load Test - Target: " + BASE_URL);
  var res = http.get(BASE_URL + "/api/health");
  if (res.status !== 200) {
    throw new Error("Target not reachable: " + res.status);
  }
  return { baseUrl: BASE_URL };
}

export function teardown(data) {
  console.log("Load test complete for " + data.baseUrl);
}
