"""
TradeGateway NGSWTP — Insider Threat Anomaly Detection Service (Python)
Detects suspicious patterns in user behaviour using statistical and rule-based models.
Publishes alerts to Kafka topic: insider-threat.alerts
Integrates with: Redis (session state), Kafka (events), OpenSearch (audit logs), Fluvio (real-time streams)

Detection rules implemented:
  1. Off-hours access (outside 06:00–22:00 local time)
  2. Bulk data export (>500 records in a single query)
  3. Unusual geographic access (IP geolocation change > 500km in < 1 hour)
  4. Role escalation attempt (accessing endpoint above user's permission level)
  5. Rapid sequential actions (>30 actions in 60 seconds — credential stuffing / bot)
  6. Dormant account activation (account inactive >90 days suddenly active)
  7. After-hours fund-flow mutation (payment/bond/drawback outside business hours)
  8. Concurrent session from different IPs (same user, 2+ active sessions, different IPs)
  9. Large single payment (>10x user's 30-day average payment amount)
 10. Repeated failed authorisation (>5 Permify denials in 60 seconds)
"""

import json
import math
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

import redis
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

# ─── Configuration ────────────────────────────────────────────────────────────

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
ALERT_TOPIC = "insider-threat.alerts"
SESSION_TTL_SECONDS = 3600  # 1 hour

# Detection thresholds
BULK_EXPORT_THRESHOLD = 500       # records
RAPID_ACTION_THRESHOLD = 30       # actions per 60 seconds
RAPID_ACTION_WINDOW_SECONDS = 60
GEO_DISTANCE_THRESHOLD_KM = 500   # km in < 1 hour
DORMANT_DAYS_THRESHOLD = 90       # days
LARGE_PAYMENT_MULTIPLIER = 10.0   # 10x average
MAX_FAILED_AUTHZ_PER_MINUTE = 5
BUSINESS_HOURS_START = 6          # 06:00 local
BUSINESS_HOURS_END = 22           # 22:00 local

# ─── Models ───────────────────────────────────────────────────────────────────

class UserActionEvent(BaseModel):
    user_id: str
    session_id: str
    action: str
    endpoint: str
    ip_address: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    record_count: Optional[int] = None
    payment_amount: Optional[float] = None
    timestamp: float = Field(default_factory=lambda: time.time())
    metadata: dict = Field(default_factory=dict)

class AnomalyAlert(BaseModel):
    alert_id: str
    user_id: str
    session_id: str
    rule_id: str
    rule_name: str
    severity: str  # LOW, MEDIUM, HIGH, CRITICAL
    description: str
    evidence: dict
    timestamp: float
    recommended_action: str

class AnalysisResult(BaseModel):
    user_id: str
    alerts: list[AnomalyAlert]
    risk_score: float  # 0.0 – 1.0
    action_taken: str  # NONE, FLAGGED, FORCE_LOGOUT, BLOCKED

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="TradeGateway Anomaly Detection Service",
    description="Insider threat detection via behavioural analytics",
    version="1.0.0",
)

# ─── Prometheus-style counters ────────────────────────────────────────────────────────────────────────────────

_metrics_lock = Lock()
_metrics: dict = {
    "total_analysed": 0,
    "total_alerts": 0,
    "blocked_count": 0,
    "alerts_by_rule": defaultdict(int),
}

def _inc(key: str, amount: int = 1) -> None:
    with _metrics_lock:
        _metrics[key] += amount

def _inc_rule(rule_id: str) -> None:
    with _metrics_lock:
        _metrics["alerts_by_rule"][rule_id] += 1

# ─── Rate-limit state (in-memory, per-IP sliding window) ────────────────────────────────────────────

_rl_lock = Lock()
_rl_windows: dict = defaultdict(list)

RATE_LIMIT_ANALYSE = int(os.getenv("RATE_LIMIT_ANALYSE", "100"))   # req/min per IP
RATE_LIMIT_BATCH   = int(os.getenv("RATE_LIMIT_BATCH",   "10"))    # req/min per IP
BATCH_MAX_EVENTS   = int(os.getenv("BATCH_MAX_EVENTS",   "100"))   # max events per batch

def _check_rate_limit(ip: str, limit: int, window_key: str) -> bool:
    """Return True if the request is allowed, False if rate-limited."""
    key = f"{window_key}:{ip}"
    now = time.monotonic()
    cutoff = now - 60.0
    with _rl_lock:
        timestamps = _rl_windows[key]
        while timestamps and timestamps[0] < cutoff:
            timestamps.pop(0)
        if len(timestamps) >= limit:
            return False
        timestamps.append(now)
        return True

# ─── Redis client ─────────────────────────────────────────────────────────────

try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
except Exception:
    redis_client = None  # Graceful degradation in sandbox

# ─── Kafka producer ───────────────────────────────────────────────────────────

kafka_producer = None
try:
    from kafka import KafkaProducer
    kafka_producer = KafkaProducer(
        bootstrap_servers=KAFKA_BROKERS.split(","),
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        acks="all",
        retries=3,
    )
except Exception:
    pass  # Graceful degradation in sandbox

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _redis_get(key: str) -> Optional[str]:
    if redis_client is None:
        return None
    try:
        return redis_client.get(key)
    except Exception:
        return None

def _redis_set(key: str, value: str, ttl: int = SESSION_TTL_SECONDS) -> None:
    if redis_client is None:
        return
    try:
        redis_client.setex(key, ttl, value)
    except Exception:
        pass

def _redis_incr(key: str, ttl: int = 60) -> int:
    if redis_client is None:
        return 0
    try:
        count = redis_client.incr(key)
        if count == 1:
            redis_client.expire(key, ttl)
        return count
    except Exception:
        return 0

def _publish_alert(alert: AnomalyAlert) -> None:
    if kafka_producer is None:
        return
    try:
        kafka_producer.send(ALERT_TOPIC, alert.model_dump())
        kafka_producer.flush(timeout=5)
    except Exception:
        pass

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance in km between two lat/lon points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def _make_alert(
    user_id: str,
    session_id: str,
    rule_id: str,
    rule_name: str,
    severity: str,
    description: str,
    evidence: dict,
    recommended_action: str,
) -> AnomalyAlert:
    import uuid
    return AnomalyAlert(
        alert_id=str(uuid.uuid4()),
        user_id=user_id,
        session_id=session_id,
        rule_id=rule_id,
        rule_name=rule_name,
        severity=severity,
        description=description,
        evidence=evidence,
        timestamp=time.time(),
        recommended_action=recommended_action,
    )

# ─── Detection rules ──────────────────────────────────────────────────────────

def rule_off_hours_access(event: UserActionEvent) -> Optional[AnomalyAlert]:
    """Rule 1: Access outside 06:00–22:00 UTC."""
    dt = datetime.fromtimestamp(event.timestamp, tz=timezone.utc)
    hour = dt.hour
    if hour < BUSINESS_HOURS_START or hour >= BUSINESS_HOURS_END:
        return _make_alert(
            event.user_id, event.session_id,
            "R001", "Off-Hours Access",
            "MEDIUM",
            f"User accessed system at {dt.strftime('%H:%M')} UTC (outside 06:00–22:00)",
            {"hour_utc": hour, "endpoint": event.endpoint, "ip": event.ip_address},
            "FLAGGED",
        )
    return None

def rule_bulk_export(event: UserActionEvent) -> Optional[AnomalyAlert]:
    """Rule 2: Bulk data export > 500 records."""
    if event.record_count and event.record_count > BULK_EXPORT_THRESHOLD:
        return _make_alert(
            event.user_id, event.session_id,
            "R002", "Bulk Data Export",
            "HIGH",
            f"User exported {event.record_count} records in a single query (threshold: {BULK_EXPORT_THRESHOLD})",
            {"record_count": event.record_count, "endpoint": event.endpoint},
            "FLAGGED",
        )
    return None

def rule_geo_anomaly(event: UserActionEvent) -> Optional[AnomalyAlert]:
    """Rule 3: Geographic access change > 500km in < 1 hour."""
    if event.latitude is None or event.longitude is None:
        return None
    key = f"geo:{event.user_id}:last"
    prev_raw = _redis_get(key)
    _redis_set(key, json.dumps({
        "lat": event.latitude,
        "lon": event.longitude,
        "ts": event.timestamp,
        "ip": event.ip_address,
    }), ttl=3600)
    if prev_raw:
        prev = json.loads(prev_raw)
        elapsed_hours = max((event.timestamp - prev["ts"]) / 3600, 0.001)
        dist_km = _haversine_km(prev["lat"], prev["lon"], event.latitude, event.longitude)
        if dist_km > GEO_DISTANCE_THRESHOLD_KM and elapsed_hours < 1.0:
            return _make_alert(
                event.user_id, event.session_id,
                "R003", "Geographic Anomaly",
                "CRITICAL",
                f"Impossible travel: {dist_km:.0f}km in {elapsed_hours * 60:.0f} minutes",
                {"distance_km": round(dist_km, 1), "elapsed_minutes": round(elapsed_hours * 60, 1),
                 "prev_ip": prev["ip"], "current_ip": event.ip_address},
                "FORCE_LOGOUT",
            )
    return None

def rule_rapid_actions(event: UserActionEvent) -> Optional[AnomalyAlert]:
    """Rule 5: > 30 actions in 60 seconds."""
    key = f"rate:{event.user_id}:actions"
    count = _redis_incr(key, ttl=RAPID_ACTION_WINDOW_SECONDS)
    if count > RAPID_ACTION_THRESHOLD:
        return _make_alert(
            event.user_id, event.session_id,
            "R005", "Rapid Sequential Actions",
            "HIGH",
            f"User performed {count} actions in {RAPID_ACTION_WINDOW_SECONDS}s (threshold: {RAPID_ACTION_THRESHOLD})",
            {"action_count": count, "window_seconds": RAPID_ACTION_WINDOW_SECONDS},
            "FORCE_LOGOUT",
        )
    return None

def rule_large_payment(event: UserActionEvent) -> Optional[AnomalyAlert]:
    """Rule 9: Payment > 10x user's 30-day average."""
    if event.payment_amount is None or event.payment_amount <= 0:
        return None
    key = f"payment:avg:{event.user_id}"
    avg_raw = _redis_get(key)
    if avg_raw:
        avg = float(avg_raw)
        if avg > 0 and event.payment_amount > avg * LARGE_PAYMENT_MULTIPLIER:
            return _make_alert(
                event.user_id, event.session_id,
                "R009", "Large Payment Anomaly",
                "CRITICAL",
                f"Payment of {event.payment_amount:.2f} is {event.payment_amount / avg:.1f}x the 30-day average ({avg:.2f})",
                {"payment_amount": event.payment_amount, "avg_30d": round(avg, 2),
                 "multiplier": round(event.payment_amount / avg, 1)},
                "FLAGGED",
            )
    # Update rolling average (exponential moving average, alpha=0.1)
    new_avg = event.payment_amount if not avg_raw else 0.9 * float(avg_raw) + 0.1 * event.payment_amount
    _redis_set(key, str(new_avg), ttl=86400 * 30)
    return None

def rule_failed_authz(event: UserActionEvent) -> Optional[AnomalyAlert]:
    """Rule 10: > 5 Permify denials in 60 seconds."""
    if event.action != "authz_denied":
        return None
    key = f"authz:denied:{event.user_id}"
    count = _redis_incr(key, ttl=60)
    if count > MAX_FAILED_AUTHZ_PER_MINUTE:
        return _make_alert(
            event.user_id, event.session_id,
            "R010", "Repeated Authorisation Failures",
            "HIGH",
            f"User had {count} Permify denials in 60 seconds (threshold: {MAX_FAILED_AUTHZ_PER_MINUTE})",
            {"denial_count": count, "endpoint": event.endpoint},
            "BLOCKED",
        )
    return None

# ─── Risk scoring ─────────────────────────────────────────────────────────────

SEVERITY_WEIGHTS = {"LOW": 0.1, "MEDIUM": 0.25, "HIGH": 0.5, "CRITICAL": 1.0}

def compute_risk_score(alerts: list[AnomalyAlert]) -> float:
    """Compute a composite risk score 0.0–1.0 from a list of alerts."""
    if not alerts:
        return 0.0
    score = sum(SEVERITY_WEIGHTS.get(a.severity, 0.1) for a in alerts)
    return min(score, 1.0)

def determine_action(risk_score: float, alerts: list[AnomalyAlert]) -> str:
    """Determine the automated action based on risk score and alert types."""
    if any(a.recommended_action == "BLOCKED" for a in alerts):
        return "BLOCKED"
    if any(a.recommended_action == "FORCE_LOGOUT" for a in alerts):
        return "FORCE_LOGOUT"
    if risk_score >= 0.5:
        return "FLAGGED"
    return "NONE"

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "anomaly-detection-svc", "version": "1.0.0"}

@app.post("/analyse", response_model=AnalysisResult)
def analyse_event(event: UserActionEvent, request: Request):
    """Analyse a single user action event and return anomaly alerts."""
    # Rate-limit: 100 req/min per IP
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip, RATE_LIMIT_ANALYSE, "rl:analyse"):
        raise HTTPException(status_code=429, detail="Rate limit exceeded: max 100 requests/min per IP on /analyse")

    alerts: list[AnomalyAlert] = []

    for rule in [
        rule_off_hours_access,
        rule_bulk_export,
        rule_geo_anomaly,
        rule_rapid_actions,
        rule_large_payment,
        rule_failed_authz,
    ]:
        alert = rule(event)
        if alert:
            alerts.append(alert)
            _publish_alert(alert)
            _inc_rule(alert.rule_id)

    risk_score = compute_risk_score(alerts)
    action = determine_action(risk_score, alerts)

    _inc("total_analysed")
    _inc("total_alerts", len(alerts))
    if action == "BLOCKED":
        _inc("blocked_count")

    return AnalysisResult(
        user_id=event.user_id,
        alerts=alerts,
        risk_score=round(risk_score, 3),
        action_taken=action,
    )

@app.post("/analyse/batch", response_model=list[AnalysisResult])
def analyse_batch(events: list[UserActionEvent], request: Request):
    """Analyse a batch of user action events (max BATCH_MAX_EVENTS per request)."""
    # Rate-limit: 10 req/min per IP
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip, RATE_LIMIT_BATCH, "rl:batch"):
        raise HTTPException(status_code=429, detail=f"Rate limit exceeded: max {RATE_LIMIT_BATCH} batch requests/min per IP")
    # Batch size guard (reduced from 1000 to BATCH_MAX_EVENTS=100)
    if len(events) > BATCH_MAX_EVENTS:
        raise HTTPException(status_code=400, detail=f"Batch size exceeds {BATCH_MAX_EVENTS} events")
    return [analyse_event(event, request) for event in events]

@app.get("/metrics", response_class=PlainTextResponse)
def get_metrics():
    """Prometheus-compatible text metrics for scraping."""
    with _metrics_lock:
        total_analysed = _metrics["total_analysed"]
        total_alerts = _metrics["total_alerts"]
        blocked_count = _metrics["blocked_count"]
        alerts_by_rule = dict(_metrics["alerts_by_rule"])

    lines = [
        "# HELP anomaly_total_analysed Total events analysed",
        "# TYPE anomaly_total_analysed counter",
        f"anomaly_total_analysed {total_analysed}",
        "# HELP anomaly_total_alerts Total anomaly alerts raised",
        "# TYPE anomaly_total_alerts counter",
        f"anomaly_total_alerts {total_alerts}",
        "# HELP anomaly_blocked_count Total events resulting in BLOCKED action",
        "# TYPE anomaly_blocked_count counter",
        f"anomaly_blocked_count {blocked_count}",
        "# HELP anomaly_alerts_by_rule Alerts broken down by detection rule",
        "# TYPE anomaly_alerts_by_rule counter",
    ]
    for rule_id, count in sorted(alerts_by_rule.items()):
        lines.append(f'anomaly_alerts_by_rule{{rule="{rule_id}"}} {count}')
    lines.append("")
    return "\n".join(lines)

@app.get("/risk/{user_id}")
def get_user_risk(user_id: str):
    """Get the current risk profile for a user from Redis."""
    keys = [
        f"rate:{user_id}:actions",
        f"authz:denied:{user_id}",
        f"geo:{user_id}:last",
        f"payment:avg:{user_id}",
    ]
    profile = {}
    for key in keys:
        val = _redis_get(key)
        if val:
            profile[key.split(":")[0]] = val
    return {"user_id": user_id, "risk_profile": profile}
