"""TCP-level quorum-fence resilience tests.

Run only against the disposable Redis and Toxiproxy containers created by the
`chaos-fence` CI job. Each test client reaches Redis through its own proxy so a
fault can isolate one contender without affecting the other contender.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Final

import pytest
import redis
import requests
from redis.exceptions import RedisError

TOXIPROXY_API: Final = os.environ.get("TOXIPROXY_API", "http://127.0.0.1:8474")
REDIS_ADMIN_PORT: Final = int(os.environ.get("REDIS_ADMIN_PORT", "6379"))
NODE_A_PORT: Final = int(os.environ.get("REDIS_PROXY_A_PORT", "16379"))
NODE_B_PORT: Final = int(os.environ.get("REDIS_PROXY_B_PORT", "16380"))
RESOURCE: Final = "declaration:quorum-test"
LEASE_KEY: Final = f"quorum-fence:lease:{RESOURCE}"
EPOCH_KEY: Final = f"quorum-fence:epoch:{RESOURCE}"
LEASE_TTL_MS: Final = 350
TOXIPROXY_UPSTREAM: Final = os.environ.get("TOXIPROXY_UPSTREAM", "redis-chaos:6379")

ACQUIRE_LUA = """
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {0, tonumber(redis.call('GET', KEYS[2]) or '0')}
end
local fence = redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[1], ARGV[1] .. ':' .. fence, 'PX', ARGV[2])
return {1, fence}
"""

RENEW_LUA = """
local expected = ARGV[1] .. ':' .. ARGV[2]
if redis.call('GET', KEYS[1]) ~= expected then
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
"""


class Toxiproxy:
    """Small HTTP client for the Toxiproxy endpoints used by this suite."""

    def wait_until_ready(self) -> None:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                response = requests.get(f"{TOXIPROXY_API}/version", timeout=1)
                if response.ok:
                    return
            except requests.RequestException:
                pass
            time.sleep(0.25)
        raise RuntimeError("Toxiproxy did not become ready within 20 seconds")

    def reset(self) -> None:
        response = requests.post(f"{TOXIPROXY_API}/reset", timeout=2)
        response.raise_for_status()

    def create_proxy(self, name: str, listen_port: int) -> None:
        requests.delete(f"{TOXIPROXY_API}/proxies/{name}", timeout=2)
        response = requests.post(
            f"{TOXIPROXY_API}/proxies",
            json={
                "name": name,
                "listen": f"0.0.0.0:{listen_port}",
                "upstream": TOXIPROXY_UPSTREAM,
                "enabled": True,
            },
            timeout=2,
        )
        response.raise_for_status()

    def add_timeout_partition(self, proxy: str) -> None:
        """Blackhole both request and response directions for one node only."""
        for stream in ("upstream", "downstream"):
            response = requests.post(
                f"{TOXIPROXY_API}/proxies/{proxy}/toxics",
                json={
                    "name": f"partition-{stream}",
                    "type": "timeout",
                    "stream": stream,
                    "toxicity": 1.0,
                    "attributes": {"timeout": 0},
                },
                timeout=2,
            )
            response.raise_for_status()

    def remove_partition(self, proxy: str) -> None:
        for stream in ("upstream", "downstream"):
            response = requests.delete(
                f"{TOXIPROXY_API}/proxies/{proxy}/toxics/partition-{stream}",
                timeout=2,
            )
            response.raise_for_status()


@dataclass
class CircuitBreaker:
    failure_threshold: int = 2
    failures: int = 0
    state: str = "closed"

    def allow_call(self) -> bool:
        return self.state != "open"

    def record_success(self) -> None:
        self.failures = 0
        self.state = "closed"

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= self.failure_threshold:
            self.state = "open"

    def probe_after_recovery(self) -> None:
        """Simplified half-open transition for the test harness."""
        if self.state == "open":
            self.state = "half-open"


class FenceNode:
    def __init__(self, name: str, port: int) -> None:
        self.name = name
        self.client = redis.Redis(
            host="127.0.0.1",
            port=port,
            decode_responses=True,
            socket_connect_timeout=0.15,
            socket_timeout=0.15,
            retry_on_timeout=False,
        )
        self.acquire_script = self.client.register_script(ACQUIRE_LUA)
        self.renew_script = self.client.register_script(RENEW_LUA)
        self.breaker = CircuitBreaker()

    def acquire(self) -> int | None:
        if not self.breaker.allow_call():
            return None
        try:
            won, fence = self.acquire_script(
                keys=[LEASE_KEY, EPOCH_KEY],
                args=[self.name, LEASE_TTL_MS],
            )
            self.breaker.record_success()
            return int(fence) if int(won) == 1 else None
        except RedisError:
            self.breaker.record_failure()
            return None

    def renew(self, fence: int) -> bool:
        if not self.breaker.allow_call():
            return False
        try:
            renewed = self.renew_script(
                keys=[LEASE_KEY],
                args=[self.name, fence, LEASE_TTL_MS],
            )
            self.breaker.record_success()
            return bool(renewed)
        except RedisError:
            self.breaker.record_failure()
            return False


class ProtectedSink:
    """The resource guarded by fences; it rejects stale writer tokens."""

    def __init__(self) -> None:
        self.highest_fence = 0
        self.accepted: list[tuple[str, int, str]] = []

    def commit(self, owner: str, fence: int, operation_id: str) -> None:
        if fence < self.highest_fence:
            raise RuntimeError(
                f"stale fence {fence}; highest accepted fence is {self.highest_fence}"
            )
        self.highest_fence = max(self.highest_fence, fence)
        self.accepted.append((owner, fence, operation_id))


@pytest.fixture
def topology() -> tuple[Toxiproxy, redis.Redis]:
    toxi = Toxiproxy()
    toxi.wait_until_ready()
    toxi.reset()
    toxi.create_proxy("node-a", NODE_A_PORT)
    toxi.create_proxy("node-b", NODE_B_PORT)

    admin = redis.Redis(host="127.0.0.1", port=REDIS_ADMIN_PORT, decode_responses=True)
    admin.ping()
    admin.delete(LEASE_KEY, EPOCH_KEY)
    yield toxi, admin
    toxi.reset()
    admin.delete(LEASE_KEY, EPOCH_KEY)


def test_partitioned_incumbent_is_fenced_after_successor_acquires(
    topology: tuple[Toxiproxy, redis.Redis],
) -> None:
    """A true client-path partition must not permit a stale leader to commit."""
    toxi, _admin = topology
    node_a = FenceNode("node-a", NODE_A_PORT)
    node_b = FenceNode("node-b", NODE_B_PORT)
    sink = ProtectedSink()

    fence_a = node_a.acquire()
    assert fence_a is not None
    sink.commit("node-a", fence_a, "before-partition")

    # TCP traffic between Node A and Redis now times out, while Node B remains healthy.
    toxi.add_timeout_partition("node-a")
    assert node_a.renew(fence_a) is False
    assert node_a.renew(fence_a) is False
    assert node_a.breaker.state == "open"

    time.sleep((LEASE_TTL_MS + 150) / 1000)
    fence_b = node_b.acquire()
    assert fence_b is not None
    assert fence_b > fence_a
    sink.commit("node-b", fence_b, "after-partition")

    # Node A still has stale in-memory state, but the protected target rejects it.
    with pytest.raises(RuntimeError, match="stale fence"):
        sink.commit("node-a", fence_a, "stale-write")

    assert sink.highest_fence == fence_b
    assert [owner for owner, _, _ in sink.accepted] == ["node-a", "node-b"]


def test_flapping_recovery_requires_a_successful_post_heal_probe(
    topology: tuple[Toxiproxy, redis.Redis],
) -> None:
    """Two real timeout failures open the breaker; recovery succeeds only after healing."""
    toxi, _admin = topology
    node_a = FenceNode("node-a", NODE_A_PORT)

    toxi.add_timeout_partition("node-a")
    assert node_a.acquire() is None
    assert node_a.acquire() is None
    assert node_a.breaker.state == "open"

    toxi.remove_partition("node-a")
    node_a.breaker.probe_after_recovery()
    recovered_fence = node_a.acquire()

    assert recovered_fence is not None
    assert node_a.breaker.state == "closed"
    assert node_a.breaker.failures == 0
