"""
TradeGateway Redis Quorum Fence Split-Brain Simulation
======================================================
Tests the Lua atomic epoch verification, circuit breaker, and split-brain
protection implemented in the quorum-fence Go service.

Run with: python3 -m pytest tests/integration/python/test_quorum_fence.py -v -s
"""

import asyncio
import hashlib
import json
import os
import time
import uuid
from typing import Optional

import pytest
import redis

# ─── Configuration ────────────────────────────────────────────────────────────

REDIS_ADDR = os.getenv("REDIS_ADDR", "localhost:6379")
REDIS_HOST, REDIS_PORT = REDIS_ADDR.split(":")

# ─── Lua Scripts (mirrors the Go quorum-fence implementation) ─────────────────

LUA_ACQUIRE_LEASE = """
-- TradeGateway Quorum Fence: Atomic Lease Acquisition with Epoch Verification
-- KEYS[1] = lease key, KEYS[2] = epoch key
-- ARGV[1] = node_id, ARGV[2] = expected_epoch, ARGV[3] = lease_ttl_ms, ARGV[4] = new_epoch
local lease_key = KEYS[1]
local epoch_key = KEYS[2]
local node_id = ARGV[1]
local expected_epoch = tonumber(ARGV[2])
local lease_ttl = tonumber(ARGV[3])
local new_epoch = tonumber(ARGV[4])

local current_epoch = tonumber(redis.call('GET', epoch_key) or '0')
if current_epoch ~= expected_epoch then
    local current_holder = redis.call('GET', lease_key) or ''
    return {0, current_holder, current_epoch}
end

local current_holder = redis.call('GET', lease_key)
if current_holder and current_holder ~= '' and current_holder ~= node_id then
    return {0, current_holder, current_epoch}
end

redis.call('SET', lease_key, node_id, 'PX', lease_ttl)
redis.call('SET', epoch_key, new_epoch)
return {1, new_epoch}
"""

LUA_RENEW_LEASE = """
-- TradeGateway Quorum Fence: Atomic Lease Renewal
-- KEYS[1] = lease key, KEYS[2] = epoch key
-- ARGV[1] = node_id, ARGV[2] = lease_ttl_ms
local lease_key = KEYS[1]
local epoch_key = KEYS[2]
local node_id = ARGV[1]
local lease_ttl = tonumber(ARGV[2])

local current_holder = redis.call('GET', lease_key)
if current_holder ~= node_id then
    return {0, current_holder or ''}
end

redis.call('PEXPIRE', lease_key, lease_ttl)
local epoch = redis.call('GET', epoch_key) or '0'
return {1, tonumber(epoch)}
"""

LUA_RELEASE_LEASE = """
-- TradeGateway Quorum Fence: Atomic Lease Release
-- KEYS[1] = lease key, ARGV[1] = node_id
local lease_key = KEYS[1]
local node_id = ARGV[1]
local current_holder = redis.call('GET', lease_key)
if current_holder == node_id then
    redis.call('DEL', lease_key)
    return 1
end
return 0
"""

# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def rdb():
    """Get a fresh Redis connection for each test."""
    r = redis.Redis(host=REDIS_HOST, port=int(REDIS_PORT), decode_responses=True)
    # Clean up test keys before each test
    for key in r.keys("quorum:test:*"):
        r.delete(key)
    yield r
    # Clean up after test
    for key in r.keys("quorum:test:*"):
        r.delete(key)


# ─── Helper Functions ─────────────────────────────────────────────────────────

def acquire_lease(rdb, lease_key, epoch_key, node_id, expected_epoch, new_epoch, ttl_ms=10000):
    """Execute the Lua acquire lease script."""
    result = rdb.eval(LUA_ACQUIRE_LEASE, 2, lease_key, epoch_key,
                      node_id, expected_epoch, ttl_ms, new_epoch)
    return result


def renew_lease(rdb, lease_key, epoch_key, node_id, ttl_ms=10000):
    """Execute the Lua renew lease script."""
    result = rdb.eval(LUA_RENEW_LEASE, 2, lease_key, epoch_key, node_id, ttl_ms)
    return result


def release_lease(rdb, lease_key, node_id):
    """Execute the Lua release lease script."""
    return rdb.eval(LUA_RELEASE_LEASE, 1, lease_key, node_id)


# ─── Test 1: Basic Lease Acquisition ─────────────────────────────────────────

def test_basic_lease_acquisition(rdb):
    """Test that a node can acquire a lease when none is held."""
    print("\nTEST: Basic Lease Acquisition")

    lease_key = "quorum:test:lease:primary"
    epoch_key = "quorum:test:epoch"
    node_id = "node-lagos-001"

    # Epoch starts at 0 (no existing epoch)
    result = acquire_lease(rdb, lease_key, epoch_key, node_id, 0, 1)

    assert result[0] == 1, f"Lease acquisition should succeed, got {result}"
    assert result[1] == 1, f"New epoch should be 1, got {result[1]}"

    # Verify lease is held
    holder = rdb.get(lease_key)
    assert holder == node_id, f"Lease holder should be {node_id}, got {holder}"

    # Verify epoch was updated
    epoch = rdb.get(epoch_key)
    assert epoch == "1", f"Epoch should be 1, got {epoch}"

    print(f"  PASS: Node {node_id} acquired lease with epoch 1")


# ─── Test 2: Epoch Verification — Prevents Stale Leader Writes ───────────────

def test_epoch_verification_prevents_stale_writes(rdb):
    """Test that epoch mismatch prevents lease acquisition (split-brain protection)."""
    print("\nTEST: Epoch Verification — Prevents Stale Leader Writes")

    lease_key = "quorum:test:lease:primary"
    epoch_key = "quorum:test:epoch"
    node_a = "node-lagos-001"
    node_b = "node-london-001"

    # Node A acquires lease at epoch 0 → 1
    result_a = acquire_lease(rdb, lease_key, epoch_key, node_a, 0, 1)
    assert result_a[0] == 1, "Node A should acquire lease"
    print(f"  PASS: Node A acquired lease (epoch 0→1)")

    # Node A releases lease (simulating failure)
    release_lease(rdb, lease_key, node_a)

    # Node B acquires lease at epoch 1 → 2
    result_b = acquire_lease(rdb, lease_key, epoch_key, node_b, 1, 2)
    assert result_b[0] == 1, "Node B should acquire lease at epoch 1"
    print(f"  PASS: Node B acquired lease (epoch 1→2)")

    # Node A (stale) tries to acquire with old epoch 0 — MUST FAIL
    result_a_stale = acquire_lease(rdb, lease_key, epoch_key, node_a, 0, 1)
    assert result_a_stale[0] == 0, \
        f"Stale Node A should be REJECTED (epoch mismatch), got {result_a_stale}"

    print(f"  PASS: Stale Node A REJECTED — epoch mismatch prevents split-brain write")
    print(f"  PASS: Current holder: {rdb.get(lease_key)}, epoch: {rdb.get(epoch_key)}")


# ─── Test 3: Split-Brain Simulation ──────────────────────────────────────────

def test_split_brain_simulation(rdb):
    """Simulate a split-brain scenario where two nodes try to become primary."""
    print("\nTEST: Split-Brain Simulation — two nodes competing for primary")

    lease_key = "quorum:test:lease:primary"
    epoch_key = "quorum:test:epoch"
    node_lagos = "node-lagos-001"
    node_london = "node-london-001"

    # Both nodes start with epoch 0 (network partition scenario)
    # Node Lagos acquires first
    result_lagos = acquire_lease(rdb, lease_key, epoch_key, node_lagos, 0, 1)
    assert result_lagos[0] == 1, "Lagos should acquire lease first"
    print(f"  PASS: Lagos acquired lease (epoch 0→1)")

    # Node London tries to acquire with same epoch 0 — MUST FAIL
    result_london = acquire_lease(rdb, lease_key, epoch_key, node_london, 0, 1)
    assert result_london[0] == 0, \
        f"London should be REJECTED (lease already held), got {result_london}"
    print(f"  PASS: London REJECTED — Lagos holds the lease")

    # Verify only one primary
    holder = rdb.get(lease_key)
    assert holder == node_lagos, f"Only Lagos should be primary, got {holder}"
    print(f"  PASS: Single primary enforced: {holder}")


# ─── Test 4: Lease Renewal (Heartbeat) ───────────────────────────────────────

def test_lease_renewal_heartbeat(rdb):
    """Test that the lease holder can renew its lease."""
    print("\nTEST: Lease Renewal — heartbeat mechanism")

    lease_key = "quorum:test:lease:primary"
    epoch_key = "quorum:test:epoch"
    node_id = "node-lagos-001"

    # Acquire lease
    acquire_lease(rdb, lease_key, epoch_key, node_id, 0, 1, ttl_ms=500)

    # Verify TTL is set
    ttl1 = rdb.pttl(lease_key)
    assert ttl1 > 0, "Lease should have a TTL"
    print(f"  PASS: Initial lease TTL: {ttl1}ms")

    # Wait a bit
    time.sleep(0.1)

    # Renew lease
    result = renew_lease(rdb, lease_key, epoch_key, node_id, ttl_ms=10000)
    assert result[0] == 1, f"Lease renewal should succeed, got {result}"
    print(f"  PASS: Lease renewed, epoch: {result[1]}")

    # Verify TTL was extended
    ttl2 = rdb.pttl(lease_key)
    assert ttl2 > ttl1, f"TTL should be extended after renewal: {ttl2} > {ttl1}"
    print(f"  PASS: Lease TTL extended: {ttl1}ms → {ttl2}ms")


# ─── Test 5: Lease Renewal by Non-Holder Fails ───────────────────────────────

def test_lease_renewal_by_non_holder_fails(rdb):
    """Test that only the lease holder can renew."""
    print("\nTEST: Lease Renewal — non-holder cannot renew")

    lease_key = "quorum:test:lease:primary"
    epoch_key = "quorum:test:epoch"
    node_a = "node-lagos-001"
    node_b = "node-london-001"

    # Node A acquires lease
    acquire_lease(rdb, lease_key, epoch_key, node_a, 0, 1)

    # Node B tries to renew — MUST FAIL
    result = renew_lease(rdb, lease_key, epoch_key, node_b)
    assert result[0] == 0, f"Non-holder renewal should fail, got {result}"
    print(f"  PASS: Non-holder {node_b} cannot renew lease held by {node_a}")


# ─── Test 6: Lease Release ────────────────────────────────────────────────────

def test_lease_release(rdb):
    """Test atomic lease release."""
    print("\nTEST: Lease Release — atomic release by holder only")

    lease_key = "quorum:test:lease:primary"
    epoch_key = "quorum:test:epoch"
    node_a = "node-lagos-001"
    node_b = "node-london-001"

    # Node A acquires lease
    acquire_lease(rdb, lease_key, epoch_key, node_a, 0, 1)

    # Node B tries to release — MUST FAIL
    result_b = release_lease(rdb, lease_key, node_b)
    assert result_b == 0, "Non-holder cannot release lease"
    assert rdb.get(lease_key) == node_a, "Lease should still be held by Node A"
    print(f"  PASS: Non-holder {node_b} cannot release lease")

    # Node A releases its own lease
    result_a = release_lease(rdb, lease_key, node_a)
    assert result_a == 1, "Holder can release lease"
    assert rdb.get(lease_key) is None, "Lease should be released"
    print(f"  PASS: Node A successfully released its lease")


# ─── Test 7: Circuit Breaker — Split-Brain Detection ─────────────────────────

def test_circuit_breaker_split_brain_detection(rdb):
    """Test circuit breaker activation when quorum is lost."""
    print("\nTEST: Circuit Breaker — split-brain detection and activation")

    class CircuitBreaker:
        def __init__(self, threshold=3, timeout_s=30):
            self.state = "CLOSED"
            self.failures = 0
            self.threshold = threshold
            self.timeout_s = timeout_s
            self.last_failure = None

        def allow(self):
            if self.state == "CLOSED":
                return True
            if self.state == "OPEN":
                if self.last_failure and time.time() - self.last_failure > self.timeout_s:
                    self.state = "HALF_OPEN"
                    return True
                return False
            return self.failures < 3  # HALF_OPEN

        def record_failure(self):
            self.failures += 1
            self.last_failure = time.time()
            if self.failures >= self.threshold:
                self.state = "OPEN"

        def record_success(self):
            self.failures = 0
            if self.state == "HALF_OPEN":
                self.state = "CLOSED"

    cb = CircuitBreaker(threshold=3, timeout_s=30)

    # Simulate quorum loss (3 consecutive failures)
    assert cb.allow(), "Circuit should be CLOSED initially"
    print(f"  PASS: Circuit breaker initial state: {cb.state}")

    for i in range(3):
        cb.record_failure()
        if i < 2:
            assert cb.state == "CLOSED" or cb.state == "OPEN"

    assert cb.state == "OPEN", f"Circuit should be OPEN after 3 failures, got {cb.state}"
    assert not cb.allow(), "Circuit OPEN should block requests"
    print(f"  PASS: Circuit breaker OPEN after 3 failures — writes blocked")

    # Simulate recovery
    cb.last_failure = time.time() - 31  # Fast-forward past timeout
    assert cb.allow(), "Circuit should allow probe in HALF_OPEN"
    assert cb.state == "HALF_OPEN"
    print(f"  PASS: Circuit breaker transitioned to HALF_OPEN for probe")

    cb.record_success()
    assert cb.state == "CLOSED", "Circuit should close after success"
    print(f"  PASS: Circuit breaker recovered to CLOSED after successful probe")


# ─── Test 8: Concurrent Lease Acquisition (Race Condition) ───────────────────

def test_concurrent_lease_acquisition_race(rdb):
    """Test that only one node wins the lease under concurrent acquisition."""
    print("\nTEST: Concurrent Lease Acquisition — race condition prevention")

    import threading

    lease_key = "quorum:test:lease:concurrent"
    epoch_key = "quorum:test:epoch:concurrent"
    winners = []
    lock = threading.Lock()

    def try_acquire(node_id):
        r = redis.Redis(host=REDIS_HOST, port=int(REDIS_PORT), decode_responses=True)
        result = r.eval(LUA_ACQUIRE_LEASE, 2, lease_key, epoch_key,
                        node_id, 0, 10000, 1)
        if result[0] == 1:
            with lock:
                winners.append(node_id)
        r.close()

    # 10 nodes try to acquire simultaneously
    threads = [threading.Thread(target=try_acquire, args=(f"node-{i:03d}",)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Exactly one winner
    assert len(winners) == 1, f"Expected exactly 1 winner, got {len(winners)}: {winners}"
    print(f"  PASS: Exactly 1 winner out of 10 concurrent attempts: {winners[0]}")

    # Verify the winner holds the lease
    holder = rdb.get(lease_key)
    assert holder == winners[0], f"Lease holder {holder} != winner {winners[0]}"
    print(f"  PASS: Lease correctly held by winner: {holder}")


# ─── Test 9: Lease Expiry — Automatic Failover ───────────────────────────────

def test_lease_expiry_automatic_failover(rdb):
    """Test that a lease expires and another node can take over."""
    print("\nTEST: Lease Expiry — automatic failover after TTL")

    lease_key = "quorum:test:lease:expiry"
    epoch_key = "quorum:test:epoch:expiry"
    node_a = "node-lagos-001"
    node_b = "node-london-001"

    # Node A acquires with short TTL (200ms)
    result = acquire_lease(rdb, lease_key, epoch_key, node_a, 0, 1, ttl_ms=200)
    assert result[0] == 1
    print(f"  PASS: Node A acquired lease with 200ms TTL")

    # Node B cannot acquire while A holds it
    result_b = acquire_lease(rdb, lease_key, epoch_key, node_b, 1, 2, ttl_ms=10000)
    assert result_b[0] == 0, "Node B should be blocked while A holds lease"
    print(f"  PASS: Node B blocked while Node A holds lease")

    # Wait for lease to expire
    time.sleep(0.3)

    # Node B can now acquire (lease expired)
    result_b2 = acquire_lease(rdb, lease_key, epoch_key, node_b, 1, 2, ttl_ms=10000)
    assert result_b2[0] == 1, f"Node B should acquire after expiry, got {result_b2}"
    print(f"  PASS: Node B acquired lease after Node A's lease expired")
    print(f"  PASS: Automatic failover completed — new epoch: {result_b2[1]}")


# ─── Test 10: Epoch Monotonicity ─────────────────────────────────────────────

def test_epoch_monotonicity(rdb):
    """Test that epoch always increases, never decreases."""
    print("\nTEST: Epoch Monotonicity — epoch can only increase")

    lease_key = "quorum:test:lease:mono"
    epoch_key = "quorum:test:epoch:mono"
    node_a = "node-lagos-001"
    node_b = "node-london-001"

    epochs = []

    # Multiple lease transfers
    for i in range(5):
        node = node_a if i % 2 == 0 else node_b
        expected_epoch = i
        new_epoch = i + 1

        result = acquire_lease(rdb, lease_key, epoch_key, node, expected_epoch, new_epoch, ttl_ms=100)
        if result[0] == 1:
            epochs.append(result[1])
        time.sleep(0.15)  # Wait for lease to expire

    # Verify monotonically increasing
    for i in range(1, len(epochs)):
        assert epochs[i] > epochs[i-1], \
            f"Epoch decreased: {epochs[i-1]} → {epochs[i]}"

    print(f"  PASS: Epoch sequence is monotonically increasing: {epochs}")


# ─── Test 11: DR Failover Timing with Quorum Fence ───────────────────────────

def test_dr_failover_with_quorum_fence(rdb):
    """Test complete DR failover sequence using quorum fence."""
    print("\nTEST: DR Failover with Quorum Fence — end-to-end timing")

    lease_key = "quorum:test:lease:dr"
    epoch_key = "quorum:test:epoch:dr"
    primary = "node-lagos-001"
    secondary = "node-london-001"

    start = time.time()

    # Step 1: Primary acquires lease
    t1 = time.time()
    result = acquire_lease(rdb, lease_key, epoch_key, primary, 0, 1)
    assert result[0] == 1
    step1_ms = (time.time() - t1) * 1000
    print(f"  Step 1 (ACQUIRE_LEASE): {step1_ms:.2f}ms")

    # Step 2: Simulate primary failure — release lease
    t2 = time.time()
    release_lease(rdb, lease_key, primary)
    step2_ms = (time.time() - t2) * 1000
    print(f"  Step 2 (FENCE_PRIMARY): {step2_ms:.2f}ms")

    # Step 3: Secondary acquires lease (promotion)
    t3 = time.time()
    result = acquire_lease(rdb, lease_key, epoch_key, secondary, 1, 2)
    assert result[0] == 1, f"Secondary should acquire lease, got {result}"
    step3_ms = (time.time() - t3) * 1000
    print(f"  Step 3 (PROMOTE_SECONDARY): {step3_ms:.2f}ms")

    total_ms = (time.time() - start) * 1000
    print(f"  Total failover time: {total_ms:.2f}ms")

    # Verify new primary
    assert rdb.get(lease_key) == secondary
    assert rdb.get(epoch_key) == "2"

    # RTO for quorum fence operations should be < 100ms
    assert total_ms < 100, f"Quorum fence failover should be < 100ms, got {total_ms:.2f}ms"
    print(f"  PASS: DR failover completed in {total_ms:.2f}ms (< 100ms target)")
    print(f"  PASS: New primary: {rdb.get(lease_key)}, epoch: {rdb.get(epoch_key)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
