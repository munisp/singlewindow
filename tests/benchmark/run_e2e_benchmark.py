"""
TradeGateway Cross-Service End-to-End Pipeline Benchmark
=========================================================
Simulates the full declaration clearance pipeline:
1. Python: Risk Score the declaration
2. Go: Calculate WTO landing cost
3. Rust: Validate LPCO requirements
4. Go: Generate UCR number
5. Go: Generate Mojaloop ILP packet
6. Python: Screen trader for PEP/sanctions

Measures end-to-end latency and throughput across all three stacks.
"""

import asyncio
import json
import math
import statistics
import time
from dataclasses import dataclass, field
from typing import List
from datetime import datetime

import aiohttp

GO_BASE_URL = "http://localhost:8091"
RUST_BASE_URL = "http://localhost:8092"
PYTHON_BASE_URL = "http://localhost:8093"

@dataclass
class PipelineResult:
    request_id: int
    total_latency_ms: float
    step_latencies: dict
    success: bool
    error: str = ""


async def run_declaration_pipeline(
    session: aiohttp.ClientSession,
    request_id: int,
) -> PipelineResult:
    """Run the full 6-step declaration clearance pipeline."""
    start = time.perf_counter()
    step_latencies = {}

    declaration = {
        "cif_value": 1_000_000.0,
        "duty_rate": 0.20,
        "country_of_origin": "CN",
        "hs_code": "8471300000",
        "trader_id": f"TRADER-{request_id % 100:04d}",
        "amount": 1_000_000.0,
    }

    try:
        # Step 1: Python — Risk Score
        t = time.perf_counter()
        async with session.post(f"{PYTHON_BASE_URL}/v1/risk/score", json=declaration) as resp:
            risk_data = await resp.json()
        step_latencies["1_risk_score_ms"] = (time.perf_counter() - t) * 1000

        # Step 2: Go — WTO Landing Cost
        t = time.perf_counter()
        async with session.post(f"{GO_BASE_URL}/v1/wto/valuation", json={
            "transaction_value": declaration["cif_value"] * 0.9,
            "freight": declaration["cif_value"] * 0.08,
            "insurance": declaration["cif_value"] * 0.02,
            "duty_rate": declaration["duty_rate"],
            "hs_code": declaration["hs_code"],
            "country_of_origin": declaration["country_of_origin"],
        }) as resp:
            valuation_data = await resp.json()
        step_latencies["2_wto_valuation_ms"] = (time.perf_counter() - t) * 1000

        # Step 3: Rust — LPCO Validation
        t = time.perf_counter()
        async with session.post(f"{RUST_BASE_URL}/v1/lpco/validate", json={
            "hs_code": declaration["hs_code"],
            "country_of_origin": declaration["country_of_origin"],
            "quantity": 500.0,
        }) as resp:
            lpco_data = await resp.json()
        step_latencies["3_lpco_validate_ms"] = (time.perf_counter() - t) * 1000

        # Step 4: Go — UCR Generation
        t = time.perf_counter()
        async with session.post(f"{GO_BASE_URL}/v1/ucr/generate", json={
            "trader_id": declaration["trader_id"],
            "sequence": request_id,
        }) as resp:
            ucr_data = await resp.json()
        step_latencies["4_ucr_generate_ms"] = (time.perf_counter() - t) * 1000

        # Step 5: Go — Mojaloop ILP
        t = time.perf_counter()
        import_vat = valuation_data.get("import_vat", 0)
        async with session.post(f"{GO_BASE_URL}/v1/mojaloop/ilp", json={
            "amount": int(import_vat * 100),  # Convert to kobo
            "currency": "NGN",
        }) as resp:
            ilp_data = await resp.json()
        step_latencies["5_mojaloop_ilp_ms"] = (time.perf_counter() - t) * 1000

        # Step 6: Python — PEP Screening
        t = time.perf_counter()
        async with session.post(f"{PYTHON_BASE_URL}/v1/pep/screen", json={
            "entity_name": f"COMPANY {request_id % 100:04d} LTD",
            "amount": declaration["amount"],
        }) as resp:
            pep_data = await resp.json()
        step_latencies["6_pep_screen_ms"] = (time.perf_counter() - t) * 1000

        total_ms = (time.perf_counter() - start) * 1000
        return PipelineResult(
            request_id=request_id,
            total_latency_ms=total_ms,
            step_latencies=step_latencies,
            success=True,
        )

    except Exception as e:
        total_ms = (time.perf_counter() - start) * 1000
        return PipelineResult(
            request_id=request_id,
            total_latency_ms=total_ms,
            step_latencies=step_latencies,
            success=False,
            error=str(e),
        )


def percentile(data: List[float], pct: int) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = int(math.ceil(pct / 100.0 * len(sorted_data))) - 1
    return sorted_data[max(0, min(idx, len(sorted_data) - 1))]


async def run_e2e_benchmark(concurrency: int, total_requests: int):
    print(f"\n{'='*70}")
    print(f"CROSS-SERVICE E2E PIPELINE BENCHMARK")
    print(f"Concurrency: {concurrency} | Total Requests: {total_requests}")
    print(f"Pipeline: Python→Go→Rust→Go→Go→Python (6 services)")
    print(f"{'='*70}")

    semaphore = asyncio.Semaphore(concurrency)
    results: List[PipelineResult] = []

    async def bounded_pipeline(req_id: int):
        async with semaphore:
            return await run_declaration_pipeline(session, req_id)

    connector = aiohttp.TCPConnector(limit=concurrency + 20, force_close=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        start = time.perf_counter()
        tasks = [bounded_pipeline(i) for i in range(total_requests)]
        results = await asyncio.gather(*tasks)
        duration_s = time.perf_counter() - start

    # Analyze results
    successful = [r for r in results if r.success]
    failed = [r for r in results if not r.success]
    total_latencies = [r.total_latency_ms for r in successful]

    throughput = len(results) / duration_s

    print(f"\n{'─'*70}")
    print(f"RESULTS")
    print(f"{'─'*70}")
    print(f"  Total Requests:    {total_requests:>10,}")
    print(f"  Successful:        {len(successful):>10,}")
    print(f"  Failed:            {len(failed):>10,}")
    print(f"  Error Rate:        {len(failed)/total_requests*100:>10.2f}%")
    print(f"  Duration:          {duration_s:>10.3f}s")
    print(f"  Throughput:        {throughput:>10.0f} pipelines/s")
    print(f"\n  End-to-End Latency:")
    print(f"    P50:             {percentile(total_latencies, 50):>10.3f}ms")
    print(f"    P95:             {percentile(total_latencies, 95):>10.3f}ms")
    print(f"    P99:             {percentile(total_latencies, 99):>10.3f}ms")
    print(f"    Avg:             {statistics.mean(total_latencies) if total_latencies else 0:>10.3f}ms")
    print(f"    Min:             {min(total_latencies) if total_latencies else 0:>10.3f}ms")
    print(f"    Max:             {max(total_latencies) if total_latencies else 0:>10.3f}ms")

    # Per-step breakdown
    if successful:
        print(f"\n  Per-Step Latency Breakdown (avg):")
        step_names = {
            "1_risk_score_ms": "Step 1: Python Risk Score",
            "2_wto_valuation_ms": "Step 2: Go WTO Valuation",
            "3_lpco_validate_ms": "Step 3: Rust LPCO Validate",
            "4_ucr_generate_ms": "Step 4: Go UCR Generate",
            "5_mojaloop_ilp_ms": "Step 5: Go Mojaloop ILP",
            "6_pep_screen_ms": "Step 6: Python PEP Screen",
        }
        for key, name in step_names.items():
            step_lats = [r.step_latencies.get(key, 0) for r in successful if key in r.step_latencies]
            if step_lats:
                avg = statistics.mean(step_lats)
                p99 = percentile(step_lats, 99)
                print(f"    {name:<35} avg={avg:>7.3f}ms  p99={p99:>7.3f}ms")

    return {
        "concurrency": concurrency,
        "total_requests": total_requests,
        "successful": len(successful),
        "failed": len(failed),
        "duration_s": duration_s,
        "throughput_rps": throughput,
        "p50_ms": percentile(total_latencies, 50),
        "p95_ms": percentile(total_latencies, 95),
        "p99_ms": percentile(total_latencies, 99),
        "avg_ms": statistics.mean(total_latencies) if total_latencies else 0,
        "error_rate_pct": len(failed)/total_requests*100,
    }


async def main():
    print("\nTradeGateway Cross-Service E2E Pipeline Benchmark")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Run at different concurrency levels
    scenarios = [
        (10, 200),    # Low concurrency warm-up
        (50, 1000),   # Medium concurrency
        (100, 2000),  # High concurrency
    ]

    all_results = []
    for concurrency, total in scenarios:
        result = await run_e2e_benchmark(concurrency, total)
        all_results.append(result)

    # Save results
    with open("/home/ubuntu/e2e_benchmark_results.json", "w") as f:
        json.dump(all_results, f, indent=2)

    print(f"\n{'='*70}")
    print("E2E BENCHMARK SUMMARY")
    print(f"{'='*70}")
    print(f"{'Concurrency':<15} {'Requests':<12} {'TPS':>10} {'P50ms':>8} {'P95ms':>8} {'P99ms':>8} {'Err%':>6}")
    print(f"{'─'*15} {'─'*12} {'─'*10} {'─'*8} {'─'*8} {'─'*8} {'─'*6}")
    for r in all_results:
        print(f"{r['concurrency']:<15} {r['total_requests']:<12,} {r['throughput_rps']:>10.0f} {r['p50_ms']:>8.3f} {r['p95_ms']:>8.3f} {r['p99_ms']:>8.3f} {r['error_rate_pct']:>6.2f}")

    print(f"\nResults saved to: /home/ubuntu/e2e_benchmark_results.json")
    return all_results


if __name__ == "__main__":
    asyncio.run(main())
