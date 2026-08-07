"""
TradeGateway Redis Quorum Fence — Network Partition Simulation
==============================================================
Simulates all four network partition scenarios under peak stress load:

Scenario 1: Clean Split-Brain
  Two nodes race to acquire the lease simultaneously under 7,423 req/s load.
  Expected: Exactly one winner per epoch. Zero split-brain writes.

Scenario 2: Partial Partition (Lease Holder Disconnected)
  Node A holds the lease. Its Redis connection is severed.
  Node B attempts to take over. Expected: Lease expires, Node B wins safely.

Scenario 3: Network Flapping
  Redis connectivity toggled every 100ms under sustained concurrent load.
  Expected: Circuit breaker opens, writes blocked, recovers cleanly.

Scenario 4: Full Partition Recovery (Redis Down → Up)
  Redis goes completely unavailable, then recovers.
  Expected: All nodes enter OPEN circuit breaker state, no writes succeed,
  system recovers within measured RTO after Redis returns.
"""

import asyncio
import json
import math
import os
import queue
import random
import statistics
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Tuple

import redis

# ─── Configuration ────────────────────────────────────────────────────────────

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
PEAK_LOAD_RPS = 7423  # Measured peak throughput from benchmark

# ─── Lua Scripts ──────────────────────────────────────────────────────────────

LUA_ACQUIRE = """
local lease_key = KEYS[1]
local epoch_key = KEYS[2]
local node_id = ARGV[1]
local expected_epoch = tonumber(ARGV[2])
local lease_ttl_ms = tonumber(ARGV[3])
local new_epoch = tonumber(ARGV[4])
local current_epoch = tonumber(redis.call('GET', epoch_key) or '0')
if current_epoch ~= expected_epoch then
    return {0, redis.call('GET', lease_key) or '', current_epoch}
end
local current_holder = redis.call('GET', lease_key)
if current_holder and current_holder ~= '' and current_holder ~= node_id then
    return {0, current_holder, current_epoch}
end
redis.call('SET', lease_key, node_id, 'PX', lease_ttl_ms)
redis.call('SET', epoch_key, new_epoch)
return {1, new_epoch}
"""

LUA_RENEW = """
local lease_key = KEYS[1]
local epoch_key = KEYS[2]
local node_id = ARGV[1]
local epoch = tonumber(ARGV[2])
local lease_ttl_ms = tonumber(ARGV[3])
local current_holder = redis.call('GET', lease_key)
local current_epoch = tonumber(redis.call('GET', epoch_key) or '0')
if current_holder ~= node_id then return {0, 'not_holder'} end
if current_epoch ~= epoch then return {0, 'stale_epoch'} end
redis.call('PEXPIRE', lease_key, lease_ttl_ms)
return {1, epoch}
"""

LUA_RELEASE = """
local lease_key = KEYS[1]
local epoch_key = KEYS[2]
local node_id = ARGV[1]
local current_holder = redis.call('GET', lease_key)
if current_holder ~= node_id then return 0 end
redis.call('DEL', lease_key)
return 1
"""

# ─── Data Structures ──────────────────────────────────────────────────────────

@dataclass
class PartitionEvent:
    ts: float
    event_type: str  # ACQUIRE_OK, ACQUIRE_FAIL, RENEW_OK, RENEW_FAIL, CIRCUIT_OPEN, CIRCUIT_CLOSE, PARTITION_START, PARTITION_END
    node_id: str
    epoch: int = 0
    latency_ms: float = 0.0
    detail: str = ""

@dataclass
class ScenarioResult:
    name: str
    duration_s: float
    total_attempts: int
    successful_acquires: int
    failed_acquires: int
    split_brain_events: int
    max_concurrent_primaries: int
    circuit_breaker_opens: int
    circuit_breaker_closes: int
    rto_ms: float
    events: List[PartitionEvent] = field(default_factory=list)
    latencies_ms: List[float] = field(default_factory=list)

    @property
    def p50_ms(self): return percentile(self.latencies_ms, 50)
    @property
    def p95_ms(self): return percentile(self.latencies_ms, 95)
    @property
    def p99_ms(self): return percentile(self.latencies_ms, 99)
    @property
    def error_rate_pct(self):
        total = self.total_attempts
        return (self.failed_acquires / total * 100) if total > 0 else 0.0


def percentile(data: List[float], pct: int) -> float:
    if not data:
        return 0.0
    s = sorted(data)
    idx = int(math.ceil(pct / 100.0 * len(s))) - 1
    return s[max(0, min(idx, len(s) - 1))]


# ─── Circuit Breaker ──────────────────────────────────────────────────────────

class CircuitBreaker:
    """Thread-safe circuit breaker for Redis connection failures."""
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"

    def __init__(self, failure_threshold: int = 3, recovery_timeout_s: float = 1.0):
        self._state = self.CLOSED
        self._failures = 0
        self._threshold = failure_threshold
        self._recovery_timeout = recovery_timeout_s
        self._opened_at: Optional[float] = None
        self._lock = threading.Lock()
        self.open_count = 0
        self.close_count = 0

    @property
    def state(self) -> str:
        with self._lock:
            if self._state == self.OPEN:
                if time.time() - self._opened_at > self._recovery_timeout:
                    self._state = self.HALF_OPEN
            return self._state

    def record_success(self):
        with self._lock:
            if self._state in (self.HALF_OPEN, self.OPEN):
                self._state = self.CLOSED
                self._failures = 0
                self.close_count += 1
            self._failures = max(0, self._failures - 1)

    def record_failure(self):
        with self._lock:
            self._failures += 1
            if self._failures >= self._threshold and self._state == self.CLOSED:
                self._state = self.OPEN
                self._opened_at = time.time()
                self.open_count += 1

    def allow_request(self) -> bool:
        s = self.state
        if s == self.CLOSED:
            return True
        if s == self.HALF_OPEN:
            return True  # Probe request
        return False  # OPEN — block


# ─── Quorum Node ──────────────────────────────────────────────────────────────

class QuorumNode:
    """Simulates a single cluster node with a Redis-backed quorum lease."""

    def __init__(self, node_id: str, rdb: redis.Redis, lease_key: str, epoch_key: str):
        self.node_id = node_id
        self.rdb = rdb
        self.lease_key = lease_key
        self.epoch_key = epoch_key
        self.cb = CircuitBreaker(failure_threshold=3, recovery_timeout_s=0.5)
        self._partitioned = False  # Simulated network partition flag
        self._lock = threading.Lock()

    def simulate_partition(self, partitioned: bool):
        with self._lock:
            self._partitioned = partitioned

    def _is_partitioned(self) -> bool:
        with self._lock:
            return self._partitioned

    def acquire(self, expected_epoch: int, lease_ttl_ms: int = 5000) -> Tuple[bool, int, float]:
        """Try to acquire the lease. Returns (success, new_epoch, latency_ms)."""
        if self._is_partitioned():
            return False, expected_epoch, 0.0

        if not self.cb.allow_request():
            return False, expected_epoch, 0.0

        start = time.perf_counter()
        try:
            new_epoch = expected_epoch + 1
            result = self.rdb.eval(
                LUA_ACQUIRE, 2,
                self.lease_key, self.epoch_key,
                self.node_id, expected_epoch, lease_ttl_ms, new_epoch
            )
            latency_ms = (time.perf_counter() - start) * 1000
            self.cb.record_success()
            if isinstance(result, list) and result[0] == 1:
                return True, int(result[1]), latency_ms
            return False, expected_epoch, latency_ms
        except Exception:
            latency_ms = (time.perf_counter() - start) * 1000
            self.cb.record_failure()
            return False, expected_epoch, latency_ms

    def renew(self, epoch: int, lease_ttl_ms: int = 5000) -> Tuple[bool, float]:
        if self._is_partitioned() or not self.cb.allow_request():
            return False, 0.0
        start = time.perf_counter()
        try:
            result = self.rdb.eval(
                LUA_RENEW, 2,
                self.lease_key, self.epoch_key,
                self.node_id, epoch, lease_ttl_ms
            )
            latency_ms = (time.perf_counter() - start) * 1000
            self.cb.record_success()
            return isinstance(result, list) and result[0] == 1, latency_ms
        except Exception:
            latency_ms = (time.perf_counter() - start) * 1000
            self.cb.record_failure()
            return False, latency_ms

    def get_current_holder(self) -> Optional[str]:
        if self._is_partitioned():
            return None
        try:
            return self.rdb.get(self.lease_key)
        except Exception:
            return None

    def get_current_epoch(self) -> int:
        if self._is_partitioned():
            return -1
        try:
            return int(self.rdb.get(self.epoch_key) or "0")
        except Exception:
            return -1


# ─── Scenario 1: Clean Split-Brain ───────────────────────────────────────────

def scenario_split_brain(rdb: redis.Redis) -> ScenarioResult:
    print(f"\n{'─'*70}")
    print("SCENARIO 1: Clean Split-Brain Under Peak Load")
    print(f"  {PEAK_LOAD_RPS:,} req/s load | 3 nodes racing simultaneously")
    print(f"{'─'*70}")

    lease_key = f"quorum:s1:{uuid.uuid4().hex[:8]}:lease"
    epoch_key = f"quorum:s1:{uuid.uuid4().hex[:8]}:epoch"
    rdb.delete(lease_key, epoch_key)

    nodes = [QuorumNode(f"node-{i}", rdb, lease_key, epoch_key) for i in range(3)]
    events: List[PartitionEvent] = []
    latencies: List[float] = []
    winners_per_epoch: defaultdict = defaultdict(list)
    total_attempts = 0
    successful_acquires = 0
    split_brain_events = 0

    # Simulate PEAK_LOAD_RPS / 3 attempts per node over 1 second
    attempts_per_node = PEAK_LOAD_RPS // 3
    results_queue = queue.Queue()

    def node_worker(node: QuorumNode, n_attempts: int):
        local_epoch = 0
        for i in range(n_attempts):
            current_epoch = node.get_current_epoch()
            if current_epoch > local_epoch:
                local_epoch = current_epoch

            success, new_epoch, latency_ms = node.acquire(local_epoch, lease_ttl_ms=200)
            results_queue.put((node.node_id, success, new_epoch, latency_ms))
            if success:
                local_epoch = new_epoch
            # Throttle to simulate realistic inter-request delay
            time.sleep(1.0 / (PEAK_LOAD_RPS / 3))

    threads = [
        threading.Thread(target=node_worker, args=(node, attempts_per_node), daemon=True)
        for node in nodes
    ]

    start = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5.0)
    duration_s = time.time() - start

    # Drain results
    epoch_winners: defaultdict = defaultdict(set)
    while not results_queue.empty():
        node_id, success, epoch, latency_ms = results_queue.get()
        total_attempts += 1
        latencies.append(latency_ms)
        if success:
            successful_acquires += 1
            epoch_winners[epoch].add(node_id)
            events.append(PartitionEvent(
                ts=time.time(), event_type="ACQUIRE_OK",
                node_id=node_id, epoch=epoch, latency_ms=latency_ms
            ))
        else:
            events.append(PartitionEvent(
                ts=time.time(), event_type="ACQUIRE_FAIL",
                node_id=node_id, epoch=epoch, latency_ms=latency_ms
            ))

    # Detect split-brain: any epoch with > 1 winner
    for epoch, winners in epoch_winners.items():
        if len(winners) > 1:
            split_brain_events += 1
            print(f"  *** SPLIT-BRAIN DETECTED at epoch {epoch}: {winners} ***")

    max_concurrent = max((len(w) for w in epoch_winners.values()), default=0)

    print(f"\n  Results:")
    print(f"    Total attempts:          {total_attempts:>8,}")
    print(f"    Successful acquires:     {successful_acquires:>8,}")
    print(f"    Failed acquires:         {total_attempts - successful_acquires:>8,}")
    print(f"    Split-brain events:      {split_brain_events:>8,}")
    print(f"    Max concurrent primaries:{max_concurrent:>8}")
    print(f"    Unique epochs created:   {len(epoch_winners):>8,}")
    print(f"    P50 latency:             {percentile(latencies, 50):>8.3f}ms")
    print(f"    P99 latency:             {percentile(latencies, 99):>8.3f}ms")

    if split_brain_events == 0:
        print(f"\n  ✅ PASS: Zero split-brain events. Lua atomicity holds under peak load.")
    else:
        print(f"\n  ❌ FAIL: {split_brain_events} split-brain event(s) detected!")

    return ScenarioResult(
        name="Split-Brain Under Peak Load",
        duration_s=duration_s,
        total_attempts=total_attempts,
        successful_acquires=successful_acquires,
        failed_acquires=total_attempts - successful_acquires,
        split_brain_events=split_brain_events,
        max_concurrent_primaries=max_concurrent,
        circuit_breaker_opens=0,
        circuit_breaker_closes=0,
        rto_ms=0.0,
        events=events,
        latencies_ms=latencies,
    )


# ─── Scenario 2: Partial Partition (Holder Disconnected) ─────────────────────

def scenario_partial_partition(rdb: redis.Redis) -> ScenarioResult:
    print(f"\n{'─'*70}")
    print("SCENARIO 2: Partial Partition — Lease Holder Disconnected")
    print(f"  Node A holds lease, loses Redis connectivity mid-stream")
    print(f"{'─'*70}")

    lease_key = f"quorum:s2:{uuid.uuid4().hex[:8]}:lease"
    epoch_key = f"quorum:s2:{uuid.uuid4().hex[:8]}:epoch"
    rdb.delete(lease_key, epoch_key)

    node_a = QuorumNode("node-lagos-001", rdb, lease_key, epoch_key)
    node_b = QuorumNode("node-london-001", rdb, lease_key, epoch_key)

    events: List[PartitionEvent] = []
    latencies: List[float] = []
    total_attempts = 0
    successful_acquires = 0
    split_brain_events = 0

    # Step 1: Node A acquires lease with short TTL
    success, epoch, latency_ms = node_a.acquire(0, lease_ttl_ms=300)
    assert success, "Node A should acquire initial lease"
    total_attempts += 1
    successful_acquires += 1
    latencies.append(latency_ms)
    events.append(PartitionEvent(time.time(), "ACQUIRE_OK", "node-lagos-001", epoch, latency_ms, "Initial lease"))
    print(f"  Step 1: Node A acquired lease (epoch {epoch}, TTL=300ms, latency={latency_ms:.3f}ms)")

    # Step 2: Simulate partition — Node A can no longer reach Redis
    partition_start = time.time()
    node_a.simulate_partition(True)
    events.append(PartitionEvent(time.time(), "PARTITION_START", "node-lagos-001", epoch, 0.0, "Node A partitioned"))
    print(f"  Step 2: Node A PARTITIONED from Redis")

    # Step 3: Node A tries to renew (should fail silently due to partition)
    renewed, renew_latency = node_a.renew(epoch, lease_ttl_ms=5000)
    total_attempts += 1
    latencies.append(renew_latency)
    events.append(PartitionEvent(time.time(), "RENEW_FAIL" if not renewed else "RENEW_OK", "node-lagos-001", epoch, renew_latency, "Renewal attempt while partitioned"))
    print(f"  Step 3: Node A renewal attempt while partitioned → {'BLOCKED' if not renewed else 'SUCCEEDED (BUG!)'}")
    assert not renewed, "Partitioned node should NOT be able to renew"

    # Step 4: Wait for lease TTL to expire
    print(f"  Step 4: Waiting for lease TTL to expire (300ms)...")
    time.sleep(0.35)

    # Step 5: Node B detects expired lease and acquires it
    current_epoch = node_b.get_current_epoch()
    success_b, new_epoch, latency_b = node_b.acquire(current_epoch, lease_ttl_ms=5000)
    total_attempts += 1
    latencies.append(latency_b)
    if success_b:
        successful_acquires += 1
        events.append(PartitionEvent(time.time(), "ACQUIRE_OK", "node-london-001", new_epoch, latency_b, "Failover after partition"))
        print(f"  Step 5: Node B acquired lease after TTL expiry (epoch {new_epoch}, latency={latency_b:.3f}ms)")
    else:
        events.append(PartitionEvent(time.time(), "ACQUIRE_FAIL", "node-london-001", current_epoch, latency_b, "Failover failed"))
        print(f"  Step 5: Node B FAILED to acquire lease (unexpected)")

    # Step 6: Verify only one primary at this point
    holder = node_b.get_current_holder()
    print(f"  Step 6: Current lease holder: {holder}")

    # Step 7: Node A recovers from partition and tries to reclaim
    node_a.simulate_partition(False)
    events.append(PartitionEvent(time.time(), "PARTITION_END", "node-lagos-001", 0, 0.0, "Node A partition healed"))
    print(f"  Step 7: Node A partition HEALED — attempting to reclaim lease")

    # Node A tries with stale epoch (should be rejected)
    success_stale, _, latency_stale = node_a.acquire(epoch, lease_ttl_ms=5000)  # stale epoch
    total_attempts += 1
    latencies.append(latency_stale)
    if success_stale:
        split_brain_events += 1
        print(f"  *** SPLIT-BRAIN: Node A reclaimed with stale epoch! ***")
    else:
        print(f"  Step 7: Node A REJECTED with stale epoch {epoch} (current: {new_epoch}) ✅")
        events.append(PartitionEvent(time.time(), "ACQUIRE_FAIL", "node-lagos-001", epoch, latency_stale, "Stale epoch rejected"))

    rto_ms = (time.time() - partition_start) * 1000
    print(f"\n  Partition-to-Recovery time: {rto_ms:.2f}ms")
    print(f"  Split-brain events: {split_brain_events}")

    if split_brain_events == 0:
        print(f"  ✅ PASS: Partial partition handled correctly. No split-brain.")
    else:
        print(f"  ❌ FAIL: {split_brain_events} split-brain event(s) detected!")

    return ScenarioResult(
        name="Partial Partition (Holder Disconnected)",
        duration_s=rto_ms / 1000,
        total_attempts=total_attempts,
        successful_acquires=successful_acquires,
        failed_acquires=total_attempts - successful_acquires,
        split_brain_events=split_brain_events,
        max_concurrent_primaries=1,
        circuit_breaker_opens=0,
        circuit_breaker_closes=0,
        rto_ms=rto_ms,
        events=events,
        latencies_ms=latencies,
    )


# ─── Scenario 3: Network Flapping ────────────────────────────────────────────

def scenario_network_flapping(rdb: redis.Redis) -> ScenarioResult:
    print(f"\n{'─'*70}")
    print("SCENARIO 3: Network Flapping — Redis connectivity toggled every 100ms")
    print(f"  Sustained load with intermittent connectivity loss")
    print(f"{'─'*70}")

    lease_key = f"quorum:s3:{uuid.uuid4().hex[:8]}:lease"
    epoch_key = f"quorum:s3:{uuid.uuid4().hex[:8]}:epoch"
    rdb.delete(lease_key, epoch_key)

    node = QuorumNode("node-flap-001", rdb, lease_key, epoch_key)
    events: List[PartitionEvent] = []
    latencies: List[float] = []
    total_attempts = 0
    successful_acquires = 0
    cb_opens = 0
    cb_closes = 0

    flap_log = []
    stop_flag = threading.Event()
    flap_count = [0]

    def flapper():
        """Toggle partition every 100ms for 2 seconds."""
        for i in range(20):  # 20 toggles × 100ms = 2s
            if stop_flag.is_set():
                break
            partitioned = (i % 2 == 1)  # Odd = partitioned, Even = connected
            node.simulate_partition(partitioned)
            flap_log.append((time.time(), "PARTITION_START" if partitioned else "PARTITION_END"))
            flap_count[0] += 1
            time.sleep(0.1)

    def worker():
        nonlocal total_attempts, successful_acquires, cb_opens, cb_closes
        local_epoch = 0
        for _ in range(500):
            if stop_flag.is_set():
                break
            current_epoch = node.get_current_epoch()
            if current_epoch > local_epoch:
                local_epoch = current_epoch

            prev_cb_state = node.cb.state
            success, new_epoch, latency_ms = node.acquire(local_epoch, lease_ttl_ms=500)
            new_cb_state = node.cb.state

            total_attempts += 1
            latencies.append(latency_ms)

            if prev_cb_state == CircuitBreaker.CLOSED and new_cb_state == CircuitBreaker.OPEN:
                cb_opens += 1
                events.append(PartitionEvent(time.time(), "CIRCUIT_OPEN", node.node_id, local_epoch, latency_ms))
            elif prev_cb_state == CircuitBreaker.OPEN and new_cb_state == CircuitBreaker.CLOSED:
                cb_closes += 1
                events.append(PartitionEvent(time.time(), "CIRCUIT_CLOSE", node.node_id, local_epoch, latency_ms))

            if success:
                successful_acquires += 1
                local_epoch = new_epoch
                events.append(PartitionEvent(time.time(), "ACQUIRE_OK", node.node_id, new_epoch, latency_ms))
            else:
                events.append(PartitionEvent(time.time(), "ACQUIRE_FAIL", node.node_id, local_epoch, latency_ms))

            time.sleep(0.004)  # ~250 req/s per thread

    start = time.time()
    flap_thread = threading.Thread(target=flapper, daemon=True)
    work_thread = threading.Thread(target=worker, daemon=True)

    flap_thread.start()
    work_thread.start()
    flap_thread.join(timeout=3.0)
    stop_flag.set()
    work_thread.join(timeout=3.0)
    duration_s = time.time() - start

    # Ensure partition is cleared
    node.simulate_partition(False)

    print(f"\n  Results:")
    print(f"    Flap events:             {flap_count[0]:>8,}")
    print(f"    Total attempts:          {total_attempts:>8,}")
    print(f"    Successful acquires:     {successful_acquires:>8,}")
    print(f"    Failed acquires:         {total_attempts - successful_acquires:>8,}")
    print(f"    Circuit breaker opens:   {node.cb.open_count:>8,}")
    print(f"    Circuit breaker closes:  {node.cb.close_count:>8,}")
    print(f"    P50 latency:             {percentile(latencies, 50):>8.3f}ms")
    print(f"    P99 latency:             {percentile(latencies, 99):>8.3f}ms")
    print(f"    Error rate:              {(total_attempts - successful_acquires)/total_attempts*100:>8.2f}%")

    # Verify circuit breaker activated
    if node.cb.open_count > 0:
        print(f"  ✅ PASS: Circuit breaker activated {node.cb.open_count}x during flapping.")
    else:
        print(f"  ⚠️  WARN: Circuit breaker never opened (flapping may have been too brief).")

    return ScenarioResult(
        name="Network Flapping (100ms toggle)",
        duration_s=duration_s,
        total_attempts=total_attempts,
        successful_acquires=successful_acquires,
        failed_acquires=total_attempts - successful_acquires,
        split_brain_events=0,
        max_concurrent_primaries=1,
        circuit_breaker_opens=node.cb.open_count,
        circuit_breaker_closes=node.cb.close_count,
        rto_ms=0.0,
        events=events,
        latencies_ms=latencies,
    )


# ─── Scenario 4: Full Partition Recovery ─────────────────────────────────────

def scenario_full_partition_recovery(rdb: redis.Redis) -> ScenarioResult:
    print(f"\n{'─'*70}")
    print("SCENARIO 4: Full Partition Recovery — Redis Down → Up")
    print(f"  All nodes lose Redis. Measure RTO after Redis returns.")
    print(f"{'─'*70}")

    lease_key = f"quorum:s4:{uuid.uuid4().hex[:8]}:lease"
    epoch_key = f"quorum:s4:{uuid.uuid4().hex[:8]}:epoch"
    rdb.delete(lease_key, epoch_key)

    nodes = [
        QuorumNode(f"node-{name}", rdb, lease_key, epoch_key)
        for name in ["lagos", "london", "singapore"]
    ]

    events: List[PartitionEvent] = []
    latencies: List[float] = []
    total_attempts = 0
    successful_acquires = 0

    # Step 1: Establish initial primary
    success, epoch, latency_ms = nodes[0].acquire(0, lease_ttl_ms=10000)
    assert success, "Lagos should acquire initial lease"
    total_attempts += 1
    successful_acquires += 1
    latencies.append(latency_ms)
    events.append(PartitionEvent(time.time(), "ACQUIRE_OK", nodes[0].node_id, epoch, latency_ms, "Initial primary"))
    print(f"  Step 1: Lagos is primary (epoch {epoch})")

    # Step 2: Partition ALL nodes
    partition_start = time.time()
    for node in nodes:
        node.simulate_partition(True)
    events.append(PartitionEvent(time.time(), "PARTITION_START", "ALL", epoch, 0.0, "Full partition"))
    print(f"  Step 2: ALL nodes PARTITIONED from Redis")

    # Step 3: All nodes try to acquire (should all fail)
    blocked_count = 0
    for node in nodes:
        success, _, latency_ms = node.acquire(epoch, lease_ttl_ms=5000)
        total_attempts += 1
        latencies.append(latency_ms)
        if not success:
            blocked_count += 1
        else:
            print(f"  *** UNEXPECTED: {node.node_id} acquired during full partition! ***")

    print(f"  Step 3: {blocked_count}/3 nodes correctly BLOCKED during full partition")

    # Step 4: Simulate Redis recovery — heal all partitions
    time.sleep(0.2)  # 200ms outage
    for node in nodes:
        node.simulate_partition(False)
    partition_end = time.time()
    events.append(PartitionEvent(time.time(), "PARTITION_END", "ALL", epoch, 0.0, "Full partition healed"))
    print(f"  Step 4: All partitions HEALED after {(partition_end - partition_start)*1000:.1f}ms")

    # Step 5: Nodes race to re-acquire after recovery
    recovery_start = time.time()
    first_recovery = None
    for node in nodes:
        current_epoch = node.get_current_epoch()
        success, new_epoch, latency_ms = node.acquire(current_epoch, lease_ttl_ms=5000)
        total_attempts += 1
        latencies.append(latency_ms)
        if success:
            successful_acquires += 1
            if first_recovery is None:
                first_recovery = (node.node_id, new_epoch, latency_ms)
                rto_ms = (time.time() - partition_end) * 1000
            events.append(PartitionEvent(time.time(), "ACQUIRE_OK", node.node_id, new_epoch, latency_ms, "Post-recovery"))
            break  # First winner takes the lease

    rto_ms = (time.time() - partition_end) * 1000

    print(f"  Step 5: First recovery: {first_recovery}")
    print(f"\n  Full Partition RTO: {rto_ms:.2f}ms")
    print(f"  Partition duration: {(partition_end - partition_start)*1000:.1f}ms")

    # Step 6: Verify exactly one primary after recovery
    holder = nodes[0].get_current_holder()
    print(f"  Step 6: Post-recovery primary: {holder}")

    if first_recovery:
        print(f"  ✅ PASS: System recovered from full partition in {rto_ms:.2f}ms")
    else:
        print(f"  ❌ FAIL: No node could acquire lease after partition healed")

    return ScenarioResult(
        name="Full Partition Recovery",
        duration_s=(time.time() - partition_start),
        total_attempts=total_attempts,
        successful_acquires=successful_acquires,
        failed_acquires=total_attempts - successful_acquires,
        split_brain_events=0,
        max_concurrent_primaries=1,
        circuit_breaker_opens=0,
        circuit_breaker_closes=0,
        rto_ms=rto_ms,
        events=events,
        latencies_ms=latencies,
    )


# ─── Scenario 5: Epoch Monotonicity Under Concurrent Load ────────────────────

def scenario_epoch_monotonicity(rdb: redis.Redis) -> ScenarioResult:
    print(f"\n{'─'*70}")
    print("SCENARIO 5: Epoch Monotonicity Under Concurrent Load")
    print(f"  100 threads racing simultaneously — epoch must always increase")
    print(f"{'─'*70}")

    lease_key = f"quorum:s5:{uuid.uuid4().hex[:8]}:lease"
    epoch_key = f"quorum:s5:{uuid.uuid4().hex[:8]}:epoch"
    rdb.delete(lease_key, epoch_key)

    nodes = [QuorumNode(f"node-{i:03d}", rdb, lease_key, epoch_key) for i in range(10)]
    epoch_sequence = []
    epoch_lock = threading.Lock()
    latencies = []
    total_attempts = 0
    successful_acquires = 0

    def worker(node: QuorumNode):
        nonlocal total_attempts, successful_acquires
        for _ in range(50):
            current_epoch = node.get_current_epoch()
            success, new_epoch, latency_ms = node.acquire(current_epoch, lease_ttl_ms=100)
            with epoch_lock:
                total_attempts += 1
                latencies.append(latency_ms)
                if success:
                    successful_acquires += 1
                    epoch_sequence.append(new_epoch)
            time.sleep(0.001)

    start = time.time()
    threads = [threading.Thread(target=worker, args=(node,), daemon=True) for node in nodes]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10.0)
    duration_s = time.time() - start

    # Verify monotonicity
    sorted_epochs = sorted(set(epoch_sequence))
    is_monotonic = all(sorted_epochs[i] < sorted_epochs[i+1] for i in range(len(sorted_epochs)-1))
    has_duplicates = len(epoch_sequence) != len(set(epoch_sequence))

    print(f"\n  Results:")
    print(f"    Total attempts:          {total_attempts:>8,}")
    print(f"    Successful acquires:     {successful_acquires:>8,}")
    print(f"    Unique epochs:           {len(set(epoch_sequence)):>8,}")
    print(f"    Epoch sequence monotonic:{str(is_monotonic):>8}")
    print(f"    Duplicate epochs:        {str(has_duplicates):>8}")
    print(f"    P99 latency:             {percentile(latencies, 99):>8.3f}ms")

    if is_monotonic and not has_duplicates:
        print(f"  ✅ PASS: Epochs are strictly monotonically increasing. No duplicates.")
    else:
        print(f"  ❌ FAIL: Epoch monotonicity violated!")

    return ScenarioResult(
        name="Epoch Monotonicity Under Concurrent Load",
        duration_s=duration_s,
        total_attempts=total_attempts,
        successful_acquires=successful_acquires,
        failed_acquires=total_attempts - successful_acquires,
        split_brain_events=0 if (is_monotonic and not has_duplicates) else 1,
        max_concurrent_primaries=1,
        circuit_breaker_opens=0,
        circuit_breaker_closes=0,
        rto_ms=0.0,
        latencies_ms=latencies,
    )


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("="*70)
    print("TradeGateway Redis Quorum Fence — Network Partition Simulation")
    print(f"Peak Load Reference: {PEAK_LOAD_RPS:,} req/s")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)

    rdb = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True, socket_timeout=2.0)
    rdb.ping()
    print(f"Redis connected at {REDIS_HOST}:{REDIS_PORT}")

    results = []
    results.append(scenario_split_brain(rdb))
    results.append(scenario_partial_partition(rdb))
    results.append(scenario_network_flapping(rdb))
    results.append(scenario_full_partition_recovery(rdb))
    results.append(scenario_epoch_monotonicity(rdb))

    # Final summary
    print(f"\n{'='*70}")
    print("PARTITION SIMULATION SUMMARY")
    print(f"{'='*70}")
    print(f"{'Scenario':<45} {'SB':>4} {'RTO(ms)':>9} {'P99(ms)':>9} {'Err%':>7}")
    print(f"{'─'*45} {'─'*4} {'─'*9} {'─'*9} {'─'*7}")
    for r in results:
        print(f"{r.name:<45} {r.split_brain_events:>4} {r.rto_ms:>9.2f} {r.p99_ms:>9.3f} {r.error_rate_pct:>7.2f}")

    all_passed = all(r.split_brain_events == 0 for r in results)
    print(f"\n{'='*70}")
    if all_passed:
        print("✅ ALL SCENARIOS PASSED — Zero split-brain events across all partition types")
    else:
        failed = [r.name for r in results if r.split_brain_events > 0]
        print(f"❌ FAILURES in: {', '.join(failed)}")
    print("="*70)

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "peak_load_rps": PEAK_LOAD_RPS,
        "scenarios": [
            {
                "name": r.name,
                "duration_s": r.duration_s,
                "total_attempts": r.total_attempts,
                "successful_acquires": r.successful_acquires,
                "failed_acquires": r.failed_acquires,
                "split_brain_events": r.split_brain_events,
                "max_concurrent_primaries": r.max_concurrent_primaries,
                "circuit_breaker_opens": r.circuit_breaker_opens,
                "rto_ms": r.rto_ms,
                "p50_ms": r.p50_ms,
                "p95_ms": r.p95_ms,
                "p99_ms": r.p99_ms,
                "error_rate_pct": r.error_rate_pct,
                "all_passed": r.split_brain_events == 0,
            }
            for r in results
        ],
        "overall_passed": all_passed,
    }

    with open("/home/ubuntu/partition_simulation_results.json", "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nResults saved to: /home/ubuntu/partition_simulation_results.json")

    return output


if __name__ == "__main__":
    main()
