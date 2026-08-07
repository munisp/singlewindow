"""
TradeGateway High-Concurrency Stress Test & Latency Benchmark
==============================================================
Measures throughput, P50/P95/P99 latencies, and error rates
across Go, Rust, and Python microservices under simulated production load.
"""

import asyncio
import json
import math
import os
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime

import aiohttp

# ─── Configuration ────────────────────────────────────────────────────────────

GO_BASE_URL = "http://localhost:8091"
RUST_BASE_URL = "http://localhost:8092"
PYTHON_BASE_URL = "http://localhost:8093"

# ─── Data Structures ──────────────────────────────────────────────────────────

@dataclass
class BenchmarkResult:
    service: str
    endpoint: str
    concurrency: int
    total_requests: int
    successful: int
    failed: int
    duration_s: float
    latencies_ms: List[float] = field(default_factory=list)

    @property
    def throughput_rps(self) -> float:
        return self.total_requests / self.duration_s if self.duration_s > 0 else 0

    @property
    def error_rate_pct(self) -> float:
        return (self.failed / self.total_requests * 100) if self.total_requests > 0 else 0

    @property
    def p50_ms(self) -> float:
        return percentile(self.latencies_ms, 50)

    @property
    def p95_ms(self) -> float:
        return percentile(self.latencies_ms, 95)

    @property
    def p99_ms(self) -> float:
        return percentile(self.latencies_ms, 99)

    @property
    def avg_ms(self) -> float:
        return statistics.mean(self.latencies_ms) if self.latencies_ms else 0

    @property
    def min_ms(self) -> float:
        return min(self.latencies_ms) if self.latencies_ms else 0

    @property
    def max_ms(self) -> float:
        return max(self.latencies_ms) if self.latencies_ms else 0


def percentile(data: List[float], pct: int) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = int(math.ceil(pct / 100.0 * len(sorted_data))) - 1
    return sorted_data[max(0, min(idx, len(sorted_data) - 1))]


# ─── Benchmark Engine ─────────────────────────────────────────────────────────

async def send_request(
    session: aiohttp.ClientSession,
    url: str,
    method: str = "POST",
    payload: Optional[dict] = None,
    latencies: List[float] = None,
    errors: List[int] = None,
):
    start = time.perf_counter()
    try:
        if method == "GET":
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                await resp.read()
                ok = resp.status < 400
        else:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                await resp.read()
                ok = resp.status < 400

        latency_ms = (time.perf_counter() - start) * 1000
        if latencies is not None:
            latencies.append(latency_ms)
        if not ok and errors is not None:
            errors.append(1)
        return ok
    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        if latencies is not None:
            latencies.append(latency_ms)
        if errors is not None:
            errors.append(1)
        return False


async def run_benchmark(
    service: str,
    endpoint: str,
    url: str,
    method: str,
    payload_fn,
    concurrency: int,
    total_requests: int,
) -> BenchmarkResult:
    latencies = []
    errors = []
    semaphore = asyncio.Semaphore(concurrency)

    async def bounded_request():
        async with semaphore:
            await send_request(
                session, url, method, payload_fn(), latencies, errors
            )

    connector = aiohttp.TCPConnector(limit=concurrency + 10, force_close=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        start = time.perf_counter()
        tasks = [bounded_request() for _ in range(total_requests)]
        await asyncio.gather(*tasks)
        duration_s = time.perf_counter() - start

    return BenchmarkResult(
        service=service,
        endpoint=endpoint,
        concurrency=concurrency,
        total_requests=total_requests,
        successful=total_requests - len(errors),
        failed=len(errors),
        duration_s=duration_s,
        latencies_ms=latencies,
    )


# ─── Benchmark Scenarios ──────────────────────────────────────────────────────

async def wait_for_server(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    async with aiohttp.ClientSession() as session:
        while time.time() < deadline:
            try:
                async with session.get(f"{url}/health", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                    if resp.status == 200:
                        return True
            except:
                pass
            await asyncio.sleep(0.5)
    return False


async def run_all_benchmarks() -> List[BenchmarkResult]:
    results = []

    print("\n" + "="*70)
    print("TradeGateway High-Concurrency Stress Test & Latency Benchmark")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)

    # ─── GO BENCHMARKS ────────────────────────────────────────────────────────

    print(f"\n{'─'*70}")
    print("GO MICROSERVICES BENCHMARKS")
    print(f"{'─'*70}")

    go_scenarios = [
        # (endpoint, url, method, payload_fn, concurrency, total_requests)
        (
            "WTO Valuation",
            f"{GO_BASE_URL}/v1/wto/valuation",
            "POST",
            lambda: {"transaction_value": 900000, "freight": 80000, "insurance": 20000, "duty_rate": 0.20, "hs_code": "8471300000", "country_of_origin": "CN"},
            100, 5000
        ),
        (
            "UCR Generation",
            f"{GO_BASE_URL}/v1/ucr/generate",
            "POST",
            lambda: {"trader_id": "TRADER001", "sequence": int(time.time() * 1000) % 1000000},
            200, 10000
        ),
        (
            "NCS Landing Cost",
            f"{GO_BASE_URL}/v1/ncs/landing-cost",
            "POST",
            lambda: {"cif_value": 1000000.0, "hs_code": "8471300000"},
            200, 10000
        ),
        (
            "Mojaloop ILP",
            f"{GO_BASE_URL}/v1/mojaloop/ilp",
            "POST",
            lambda: {"amount": 5000000, "currency": "NGN"},
            100, 5000
        ),
        (
            "Redis Quorum Lease",
            f"{GO_BASE_URL}/v1/quorum/lease?node_id=bench-node",
            "GET",
            lambda: None,
            50, 2000
        ),
    ]

    for name, url, method, payload_fn, concurrency, total in go_scenarios:
        print(f"\n  Benchmarking: {name} (concurrency={concurrency}, requests={total})")
        result = await run_benchmark("Go", name, url, method, payload_fn, concurrency, total)
        results.append(result)
        print(f"    Throughput:  {result.throughput_rps:>10.0f} req/s")
        print(f"    P50 Latency: {result.p50_ms:>10.3f} ms")
        print(f"    P95 Latency: {result.p95_ms:>10.3f} ms")
        print(f"    P99 Latency: {result.p99_ms:>10.3f} ms")
        print(f"    Error Rate:  {result.error_rate_pct:>10.2f} %")

    # ─── RUST BENCHMARKS ──────────────────────────────────────────────────────

    print(f"\n{'─'*70}")
    print("RUST MICROSERVICES BENCHMARKS")
    print(f"{'─'*70}")

    rust_scenarios = [
        (
            "WTO Valuation",
            f"{RUST_BASE_URL}/v1/wto/valuation",
            "POST",
            lambda: {"transaction_value": 900000.0, "freight": 80000.0, "insurance": 20000.0, "duty_rate": 0.20, "hs_code": "8471300000"},
            200, 10000
        ),
        (
            "LPCO Validation",
            f"{RUST_BASE_URL}/v1/lpco/validate",
            "POST",
            lambda: {"hs_code": "02011000", "country_of_origin": "BR", "quantity": 5000.0},
            200, 10000
        ),
        (
            "HS Classification",
            f"{RUST_BASE_URL}/v1/hs/classify",
            "POST",
            lambda: {"description": "Dell laptop computer 15 inch Intel Core i7"},
            500, 20000
        ),
    ]

    for name, url, method, payload_fn, concurrency, total in rust_scenarios:
        print(f"\n  Benchmarking: {name} (concurrency={concurrency}, requests={total})")
        result = await run_benchmark("Rust", name, url, method, payload_fn, concurrency, total)
        results.append(result)
        print(f"    Throughput:  {result.throughput_rps:>10.0f} req/s")
        print(f"    P50 Latency: {result.p50_ms:>10.3f} ms")
        print(f"    P95 Latency: {result.p95_ms:>10.3f} ms")
        print(f"    P99 Latency: {result.p99_ms:>10.3f} ms")
        print(f"    Error Rate:  {result.error_rate_pct:>10.2f} %")

    # ─── PYTHON BENCHMARKS ────────────────────────────────────────────────────

    print(f"\n{'─'*70}")
    print("PYTHON MICROSERVICES BENCHMARKS")
    print(f"{'─'*70}")

    python_scenarios = [
        (
            "PEP Screening",
            f"{PYTHON_BASE_URL}/v1/pep/screen",
            "POST",
            lambda: {"entity_name": "LEGITIMATE IMPORTS LTD", "amount": 500000.0},
            50, 2000
        ),
        (
            "AI Risk Scoring",
            f"{PYTHON_BASE_URL}/v1/risk/score",
            "POST",
            lambda: {"cif_value": 1000000, "duty_rate": 0.20, "country_of_origin": "CN", "hs_code": "8471300000"},
            100, 5000
        ),
        (
            "NCS Landing Cost",
            f"{PYTHON_BASE_URL}/v1/ncs/landing-cost",
            "POST",
            lambda: {"cif_value": 1000000.0, "hs_code": "8471"},
            100, 5000
        ),
        (
            "Geo Distance",
            f"{PYTHON_BASE_URL}/v1/geo/distance",
            "POST",
            lambda: {"lat1": 6.4474, "lon1": 3.3903, "lat2": 4.7167, "lon2": 7.1500},
            100, 5000
        ),
        (
            "NAICOM Report",
            f"{PYTHON_BASE_URL}/v1/naicom/report",
            "POST",
            lambda: {"total_premiums": 10000000.0, "total_claims": 3000000.0},
            50, 2000
        ),
    ]

    for name, url, method, payload_fn, concurrency, total in python_scenarios:
        print(f"\n  Benchmarking: {name} (concurrency={concurrency}, requests={total})")
        result = await run_benchmark("Python", name, url, method, payload_fn, concurrency, total)
        results.append(result)
        print(f"    Throughput:  {result.throughput_rps:>10.0f} req/s")
        print(f"    P50 Latency: {result.p50_ms:>10.3f} ms")
        print(f"    P95 Latency: {result.p95_ms:>10.3f} ms")
        print(f"    P99 Latency: {result.p99_ms:>10.3f} ms")
        print(f"    Error Rate:  {result.error_rate_pct:>10.2f} %")

    return results


# ─── Report Generation ────────────────────────────────────────────────────────

def generate_report(results: List[BenchmarkResult]) -> str:
    lines = []
    lines.append("# TradeGateway High-Concurrency Stress Test Report")
    lines.append(f"\n**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"\n**Total Benchmark Scenarios:** {len(results)}")

    total_requests = sum(r.total_requests for r in results)
    total_errors = sum(r.failed for r in results)
    lines.append(f"\n**Total Requests Executed:** {total_requests:,}")
    lines.append(f"\n**Total Errors:** {total_errors:,}")
    lines.append(f"\n**Overall Error Rate:** {total_errors/total_requests*100:.3f}%")

    lines.append("\n---\n")

    for service in ["Go", "Rust", "Python"]:
        service_results = [r for r in results if r.service == service]
        if not service_results:
            continue

        lines.append(f"\n## {service} Microservices\n")
        lines.append("| Endpoint | Concurrency | Requests | Throughput (req/s) | P50 (ms) | P95 (ms) | P99 (ms) | Avg (ms) | Error % |")
        lines.append("|---|---|---|---|---|---|---|---|---|")

        for r in service_results:
            lines.append(
                f"| {r.endpoint} | {r.concurrency} | {r.total_requests:,} | "
                f"**{r.throughput_rps:,.0f}** | {r.p50_ms:.3f} | {r.p95_ms:.3f} | "
                f"{r.p99_ms:.3f} | {r.avg_ms:.3f} | {r.error_rate_pct:.2f}% |"
            )

    lines.append("\n---\n")
    lines.append("## Performance Summary\n")
    lines.append("| Service | Best Throughput | Best P99 | Worst P99 | Avg Error Rate |")
    lines.append("|---|---|---|---|---|")

    for service in ["Go", "Rust", "Python"]:
        sr = [r for r in results if r.service == service]
        if not sr:
            continue
        best_tps = max(r.throughput_rps for r in sr)
        best_p99 = min(r.p99_ms for r in sr)
        worst_p99 = max(r.p99_ms for r in sr)
        avg_err = statistics.mean(r.error_rate_pct for r in sr)
        lines.append(f"| {service} | {best_tps:,.0f} req/s | {best_p99:.3f}ms | {worst_p99:.3f}ms | {avg_err:.3f}% |")

    lines.append("\n---\n")
    lines.append("## Key Findings\n")

    # Find fastest endpoint
    fastest = max(results, key=lambda r: r.throughput_rps)
    lines.append(f"- **Highest Throughput:** {fastest.service} `{fastest.endpoint}` at **{fastest.throughput_rps:,.0f} req/s**")

    # Find lowest P99
    lowest_p99 = min(results, key=lambda r: r.p99_ms)
    lines.append(f"- **Lowest P99 Latency:** {lowest_p99.service} `{lowest_p99.endpoint}` at **{lowest_p99.p99_ms:.3f}ms**")

    # Error rate
    if total_errors == 0:
        lines.append(f"- **Zero errors** across all {total_requests:,} requests")
    else:
        lines.append(f"- **Error rate:** {total_errors/total_requests*100:.3f}% ({total_errors:,} errors)")

    return "\n".join(lines)


# ─── Main ─────────────────────────────────────────────────────────────────────

async def main():
    # Wait for all servers
    print("Waiting for benchmark servers to be ready...")
    servers = [
        (GO_BASE_URL, "Go"),
        (RUST_BASE_URL, "Rust"),
        (PYTHON_BASE_URL, "Python"),
    ]

    for url, name in servers:
        ready = await wait_for_server(url, timeout=30)
        if ready:
            print(f"  ✓ {name} server ready at {url}")
        else:
            print(f"  ✗ {name} server NOT ready at {url} — skipping")

    results = await run_all_benchmarks()

    # Print summary table
    print(f"\n{'='*70}")
    print("BENCHMARK SUMMARY")
    print(f"{'='*70}")
    print(f"{'Service':<8} {'Endpoint':<25} {'TPS':>10} {'P50ms':>8} {'P95ms':>8} {'P99ms':>8} {'Err%':>6}")
    print(f"{'─'*8} {'─'*25} {'─'*10} {'─'*8} {'─'*8} {'─'*8} {'─'*6}")
    for r in results:
        print(f"{r.service:<8} {r.endpoint:<25} {r.throughput_rps:>10,.0f} {r.p50_ms:>8.3f} {r.p95_ms:>8.3f} {r.p99_ms:>8.3f} {r.error_rate_pct:>6.2f}")

    # Save report
    report = generate_report(results)
    report_path = "/home/ubuntu/benchmark_report.md"
    with open(report_path, "w") as f:
        f.write(report)
    print(f"\nReport saved to: {report_path}")

    # Save raw results as JSON
    raw_path = "/home/ubuntu/benchmark_raw.json"
    with open(raw_path, "w") as f:
        json.dump([{
            "service": r.service,
            "endpoint": r.endpoint,
            "concurrency": r.concurrency,
            "total_requests": r.total_requests,
            "successful": r.successful,
            "failed": r.failed,
            "duration_s": r.duration_s,
            "throughput_rps": r.throughput_rps,
            "p50_ms": r.p50_ms,
            "p95_ms": r.p95_ms,
            "p99_ms": r.p99_ms,
            "avg_ms": r.avg_ms,
            "min_ms": r.min_ms,
            "max_ms": r.max_ms,
            "error_rate_pct": r.error_rate_pct,
        } for r in results], f, indent=2)
    print(f"Raw results saved to: {raw_path}")

    return results


if __name__ == "__main__":
    asyncio.run(main())
