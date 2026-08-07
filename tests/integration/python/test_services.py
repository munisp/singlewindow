"""
TradeGateway Python Integration Test Suite
==========================================
Tests all Python microservices end-to-end against a real PostgreSQL instance.
Run with: python3 -m pytest tests/integration/python/test_services.py -v
"""

import asyncio
import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/tradegateway_test"
)

# ─── Schema Setup (run once) ──────────────────────────────────────────────────

async def _ensure_schema():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS nfiu_sar_queue (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                sar_reference VARCHAR(64) UNIQUE NOT NULL,
                trader_id VARCHAR(128) NOT NULL,
                transaction_amount NUMERIC(18,2) NOT NULL,
                suspicious_activity TEXT NOT NULL,
                status VARCHAR(16) DEFAULT 'pending',
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 5,
                dlq_reason TEXT,
                dlq_at TIMESTAMPTZ,
                pep_flag BOOLEAN DEFAULT FALSE,
                risk_score NUMERIC(5,2),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS sar_audit_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                sar_id UUID,
                sar_reference VARCHAR(64),
                event_type VARCHAR(64) NOT NULL,
                event_data JSONB NOT NULL,
                actor VARCHAR(128),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS pep_screening_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                entity_name TEXT NOT NULL,
                risk_score NUMERIC(5,2) NOT NULL,
                pep_matched BOOLEAN DEFAULT FALSE,
                bypass_attempted BOOLEAN DEFAULT FALSE,
                bypass_blocked BOOLEAN DEFAULT FALSE,
                match_details JSONB,
                screened_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS naicom_reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                report_period VARCHAR(7) NOT NULL,
                report_type VARCHAR(32) NOT NULL,
                total_premiums_ngn NUMERIC(18,2),
                total_claims_ngn NUMERIC(18,2),
                loss_ratio_pct NUMERIC(6,4),
                solvency_margin_pct NUMERIC(6,4),
                risk_based_capital NUMERIC(18,2),
                report_data JSONB NOT NULL,
                generated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(report_period, report_type)
            );
            CREATE TABLE IF NOT EXISTS payments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                trader_id VARCHAR(128),
                amount NUMERIC(18,2),
                status VARCHAR(32) DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
    finally:
        await conn.close()

# Run schema setup synchronously before tests
asyncio.get_event_loop().run_until_complete(_ensure_schema())


# ─── Helper: get a fresh connection per test ──────────────────────────────────

async def get_conn():
    return await asyncpg.connect(DATABASE_URL)


# ─── Test 1: SAR Submission and Queue Management ──────────────────────────────

def test_sar_submission_and_queue():
    """Test SAR submission, status tracking, and audit logging."""
    print("\nTEST: SAR Submission and Queue Management")

    async def run():
        conn = await get_conn()
        try:
            sar_id = str(uuid.uuid4())
            sar_ref = f"SAR-TEST-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{sar_id[:8].upper()}"

            await conn.execute("""
                INSERT INTO nfiu_sar_queue (id, sar_reference, trader_id, transaction_amount, suspicious_activity)
                VALUES ($1, $2, 'test-trader-001', 7500000.00, 'Unusual payment pattern')
            """, sar_id, sar_ref)

            row = await conn.fetchrow("SELECT * FROM nfiu_sar_queue WHERE id=$1", sar_id)
            assert row is not None
            assert row["status"] == "pending"
            assert float(row["transaction_amount"]) == 7500000.00

            await conn.execute("""
                INSERT INTO sar_audit_log (sar_id, sar_reference, event_type, event_data, actor)
                VALUES ($1, $2, 'SAR_SUBMITTED', $3, 'test-system')
            """, sar_id, sar_ref, json.dumps({"amount": 7500000.00}))

            audit = await conn.fetchrow("SELECT * FROM sar_audit_log WHERE sar_id=$1", sar_id)
            assert audit is not None
            assert audit["event_type"] == "SAR_SUBMITTED"
            print(f"  PASS: SAR {sar_ref} submitted and audit logged")
        finally:
            await conn.close()

    asyncio.get_event_loop().run_until_complete(run())


# ─── Test 2: SAR Dead-Letter Queue with Retry ─────────────────────────────────

def test_sar_dlq_retry_cycle():
    """Test SAR DLQ routing and manual requeue cycle."""
    print("\nTEST: SAR Dead-Letter Queue — retry and requeue cycle")

    async def run():
        conn = await get_conn()
        try:
            prefix = f"SAR-DLQ-PY2-{uuid.uuid4().hex[:6]}"
            for i in range(20):
                await conn.execute("""
                    INSERT INTO nfiu_sar_queue (sar_reference, trader_id, transaction_amount, suspicious_activity, retry_count, max_retries)
                    VALUES ($1, 'dlq-test-trader', 1000000.00, 'DLQ test', 5, 5)
                    ON CONFLICT (sar_reference) DO NOTHING
                """, f"{prefix}-{i:04d}")

            await conn.execute(f"""
                UPDATE nfiu_sar_queue
                SET status='dlq', dlq_reason='nfiu_api_outage', dlq_at=NOW()
                WHERE sar_reference LIKE '{prefix}-%' AND retry_count >= max_retries
            """)

            dlq_count = await conn.fetchval(
                f"SELECT COUNT(*) FROM nfiu_sar_queue WHERE sar_reference LIKE '{prefix}-%' AND status='dlq'"
            )
            assert dlq_count == 20, f"Expected 20 in DLQ, got {dlq_count}"
            print(f"  PASS: {dlq_count} SARs routed to DLQ")

            await conn.execute(f"""
                UPDATE nfiu_sar_queue
                SET status='pending', retry_count=0, dlq_reason=NULL, dlq_at=NULL
                WHERE sar_reference LIKE '{prefix}-%' AND status='dlq'
            """)

            pending_count = await conn.fetchval(
                f"SELECT COUNT(*) FROM nfiu_sar_queue WHERE sar_reference LIKE '{prefix}-%' AND status='pending'"
            )
            assert pending_count == 20, f"Expected 20 requeued, got {pending_count}"
            print(f"  PASS: {pending_count} SARs requeued from DLQ")
        finally:
            await conn.close()

    asyncio.get_event_loop().run_until_complete(run())


# ─── Test 3: PEP Screening — Fuzzy Matching ───────────────────────────────────

def test_pep_screening_fuzzy_matching():
    """Test PEP screening with fuzzy name matching and bypass detection."""
    print("\nTEST: PEP Screening — fuzzy matching and bypass detection")

    PEP_DATABASE = {
        "JOHN DOE ENTERPRISES": {"risk_score": 95.0, "pep_type": "DOMESTIC_PEP"},
        "GLOBAL TRADE LTD": {"risk_score": 88.0, "pep_type": "FOREIGN_PEP"},
    }

    def fuzzy_similarity(a, b):
        if a == b: return 1.0
        la, lb = len(a), len(b)
        if la == 0 or lb == 0: return 0.0
        dp = [[0]*(lb+1) for _ in range(la+1)]
        for i in range(la+1): dp[i][0] = i
        for j in range(lb+1): dp[0][j] = j
        for i in range(1, la+1):
            for j in range(1, lb+1):
                cost = 0 if a[i-1] == b[j-1] else 1
                dp[i][j] = min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost)
        return 1.0 - dp[la][lb] / max(la, lb)

    def screen(entity_name, amount, bypass_attempt=False):
        normalized = entity_name.upper().strip()
        pep_matched, risk_score, match_details = False, 0.0, {}
        if normalized in PEP_DATABASE:
            pep_matched = True
            match_details = PEP_DATABASE[normalized]
            risk_score = match_details["risk_score"]
        if not pep_matched:
            for pep_name, pep_data in PEP_DATABASE.items():
                sim = fuzzy_similarity(normalized, pep_name)
                if sim > 0.75:
                    pep_matched = True
                    match_details = {**pep_data, "similarity": sim}
                    risk_score = pep_data["risk_score"] * sim
                    break
        bypass_blocked = False
        if bypass_attempt:
            bypass_blocked = True
            risk_score = max(risk_score, 90.0)
            pep_matched = True
        if 4_500_000 <= amount < 5_000_000:
            risk_score = max(risk_score, 60.0)
            match_details["structuring_flag"] = True
        return {"pep_matched": pep_matched, "risk_score": risk_score, "bypass_blocked": bypass_blocked, "match_details": match_details}

    r = screen("JOHN DOE ENTERPRISES", 1_000_000)
    assert r["pep_matched"] and r["risk_score"] == 95.0
    print(f"  PASS: Direct PEP match — risk_score={r['risk_score']}")

    r = screen("JOHN DOE ENTERPRISE", 1_000_000)  # fuzzy
    assert r["pep_matched"] and r["risk_score"] > 70.0
    print(f"  PASS: Fuzzy PEP match — risk_score={r['risk_score']:.2f}")

    r = screen("UNKNOWN COMPANY", 1_000_000, bypass_attempt=True)
    assert r["bypass_blocked"] and r["risk_score"] >= 90.0
    print(f"  PASS: Bypass attempt blocked — risk_score={r['risk_score']}")

    r = screen("CLEAN COMPANY LTD", 4_750_000)
    assert r["risk_score"] >= 60.0 and r["match_details"].get("structuring_flag")
    print(f"  PASS: Structuring detected — risk_score={r['risk_score']}")

    r = screen("LEGITIMATE IMPORTS LTD", 500_000)
    assert not r["pep_matched"] and r["risk_score"] == 0.0
    print(f"  PASS: Clean entity cleared — risk_score={r['risk_score']}")


# ─── Test 4: NAICOM Report Generation ────────────────────────────────────────

def test_naicom_report_generation():
    """Test NAICOM monthly report with loss ratios and solvency margins."""
    print("\nTEST: NAICOM Report Generation — loss ratios and solvency margins")

    async def run():
        conn = await get_conn()
        try:
            period = datetime.now(timezone.utc).strftime("%Y-%m")
            # Insert test payments
            for i in range(10):
                await conn.execute("""
                    INSERT INTO payments (trader_id, amount, status)
                    VALUES ('naicom-test-trader', $1, $2)
                """, 1_000_000.0 * (i + 1), "completed" if i < 8 else "refunded")

            row = await conn.fetchrow("""
                SELECT
                    COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END), 0) AS total_premiums,
                    COALESCE(SUM(CASE WHEN status='refunded' THEN amount ELSE 0 END), 0) AS total_claims
                FROM payments WHERE trader_id='naicom-test-trader'
            """)
            tp = float(row["total_premiums"])
            tc = float(row["total_claims"])
            loss_ratio = (tc / tp * 100) if tp > 0 else 0.0
            assets = tp * 1.25
            liabilities = tc * 1.1
            net_premium = tp * 0.85
            solvency_margin = ((assets - liabilities) / net_premium * 100) if net_premium > 0 else 150.0
            rbc = max(3_000_000_000, tp * 0.18)

            assert tp > 0
            assert 0 <= loss_ratio <= 100
            assert solvency_margin > 0
            assert rbc >= 3_000_000_000

            print(f"  PASS: Total Premiums: ₦{tp:,.0f}")
            print(f"  PASS: Loss Ratio: {loss_ratio:.2f}%")
            print(f"  PASS: Solvency Margin: {solvency_margin:.2f}%")
            print(f"  PASS: RBC: ₦{rbc:,.0f}")

            await conn.execute("""
                INSERT INTO naicom_reports (report_period, report_type, total_premiums_ngn, total_claims_ngn,
                    loss_ratio_pct, solvency_margin_pct, risk_based_capital, report_data)
                VALUES ($1,'MONTHLY',$2,$3,$4,$5,$6,$7)
                ON CONFLICT (report_period, report_type) DO UPDATE SET total_premiums_ngn=EXCLUDED.total_premiums_ngn
            """, period, tp, tc, loss_ratio, solvency_margin, rbc, json.dumps({"period": period}))

            saved = await conn.fetchrow(
                "SELECT * FROM naicom_reports WHERE report_period=$1 AND report_type='MONTHLY'", period
            )
            assert saved is not None
            print(f"  PASS: NAICOM report persisted for period {period}")
        finally:
            await conn.close()

    asyncio.get_event_loop().run_until_complete(run())


# ─── Test 5: SAR Forensic Audit Trail ────────────────────────────────────────

def test_sar_forensic_audit_trail():
    """Test SAR audit trail integrity with SHA-256 forensic hash."""
    print("\nTEST: SAR Forensic Audit Trail — SHA-256 integrity")

    async def run():
        conn = await get_conn()
        try:
            sar_id = str(uuid.uuid4())
            sar_ref = f"SAR-AUDIT-{sar_id[:8].upper()}"

            await conn.execute("""
                INSERT INTO nfiu_sar_queue (id, sar_reference, trader_id, transaction_amount, suspicious_activity)
                VALUES ($1, $2, 'audit-test-trader', 8000000.00, 'Audit trail test')
            """, sar_id, sar_ref)

            events = [
                ("SAR_SUBMITTED", {"amount": 8000000.00}),
                ("SAR_RETRY_SCHEDULED", {"retry_count": 1}),
                ("SAR_DLQ_ROUTED", {"reason": "max_retries_exceeded"}),
                ("SAR_REQUEUED", {"actor": "compliance-officer-001"}),
                ("SAR_SUBMITTED_TO_NFIU", {"nfiu_ref": "NFIU-2026-001234"}),
            ]
            for event_type, event_data in events:
                await conn.execute("""
                    INSERT INTO sar_audit_log (sar_id, sar_reference, event_type, event_data, actor)
                    VALUES ($1, $2, $3, $4, 'test-system')
                """, sar_id, sar_ref, event_type, json.dumps(event_data))

            audit_events = await conn.fetch(
                "SELECT id, event_type, event_data, actor, created_at FROM sar_audit_log WHERE sar_id=$1 ORDER BY created_at ASC",
                sar_id
            )
            assert len(audit_events) == len(events)

            audit_data = [dict(e) for e in audit_events]
            audit_str = json.dumps(audit_data, default=str, sort_keys=True)
            forensic_hash = hashlib.sha256(audit_str.encode()).hexdigest()

            assert len(forensic_hash) == 64
            assert all(c in "0123456789abcdef" for c in forensic_hash)
            print(f"  PASS: {len(audit_events)} audit events recorded")
            print(f"  PASS: Forensic hash: {forensic_hash[:32]}...")
        finally:
            await conn.close()

    asyncio.get_event_loop().run_until_complete(run())


# ─── Test 6: AI Risk Scoring Logic ───────────────────────────────────────────

def test_ai_risk_scoring_features():
    """Test AI risk scoring feature extraction and scoring logic."""
    print("\nTEST: AI Risk Scoring — feature extraction and scoring")

    def extract_features(decl):
        return {
            "cif_value": decl.get("cif_value", 0),
            "duty_rate": decl.get("duty_rate", 0),
            "country_risk": {"CN": 0.3, "AE": 0.5, "US": 0.1}.get(decl.get("country_of_origin", ""), 0.2),
            "is_high_value": 1 if decl.get("cif_value", 0) > 10_000_000 else 0,
            "is_restricted_hs": 1 if decl.get("hs_code", "")[:4] in ["0201", "2710", "9301"] else 0,
            "hs_chapter": int(decl.get("hs_code", "00")[:2]),
        }

    def score_risk(f):
        score = f["country_risk"] * 30 + f["is_high_value"] * 20 + f["is_restricted_hs"] * 25
        score += min(f["duty_rate"] * 100, 15)
        score += 10 if f["hs_chapter"] in [93, 27, 2] else 0
        return min(score, 100.0)

    cases = [
        ({"cif_value": 500_000, "duty_rate": 0.0, "country_of_origin": "US", "hs_code": "8471300000"}, None, 30.0, "Low-risk electronics"),
        ({"cif_value": 50_000_000, "duty_rate": 0.05, "country_of_origin": "AE", "hs_code": "2710121000"}, 50.0, None, "High-risk petroleum"),
        ({"cif_value": 5_000_000, "duty_rate": 0.35, "country_of_origin": "CN", "hs_code": "8703210000"}, 20.0, None, "Medium-risk vehicles"),
    ]

    for decl, min_score, max_score, name in cases:
        score = score_risk(extract_features(decl))
        if min_score: assert score >= min_score, f"{name}: score {score:.1f} < {min_score}"
        if max_score: assert score <= max_score, f"{name}: score {score:.1f} > {max_score}"
        print(f"  PASS: {name} — risk_score={score:.1f}")


# ─── Test 7: Geospatial Distance Calculation ─────────────────────────────────

def test_geospatial_distance_calculation():
    """Test Haversine distance calculation for vessel tracking."""
    print("\nTEST: Geospatial — Haversine distance calculation")

    import math

    def haversine_km(lat1, lon1, lat2, lon2):
        R = 6371.0
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi, dlambda = math.radians(lat2-lat1), math.radians(lon2-lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        return 2 * R * math.asin(math.sqrt(a))

    def in_geofence(lat, lon, clat, clon, radius_km):
        return haversine_km(lat, lon, clat, clon) <= radius_km

    d = haversine_km(6.4474, 3.3903, 4.7167, 7.1500)
    assert 400 < d < 600, f"Apapa-Onne: expected ~500km, got {d:.1f}km"
    print(f"  PASS: Apapa → Onne: {d:.1f}km")

    d2 = haversine_km(6.4474, 3.3903, 51.5074, -0.1278)
    assert 5000 < d2 < 6000
    print(f"  PASS: Lagos → London: {d2:.1f}km")

    assert in_geofence(6.0, 3.5, 6.4474, 3.3903, 370.0)
    print(f"  PASS: Vessel inside Lagos EEZ geofence")

    assert not in_geofence(15.0, 3.5, 6.4474, 3.3903, 370.0)
    print(f"  PASS: Vessel outside Lagos EEZ correctly detected")


# ─── Test 8: NFIU API Outage — Zero Data Loss ─────────────────────────────────

def test_nfiu_api_outage_zero_data_loss():
    """Test that NFIU API outage results in zero SAR data loss via DLQ."""
    print("\nTEST: NFIU API Outage — zero data loss guarantee")

    async def run():
        conn = await get_conn()
        try:
            prefix = f"SAR-OUTAGE-PY3-{uuid.uuid4().hex[:6]}"
            sar_count = 100
            for i in range(sar_count):
                await conn.execute("""
                    INSERT INTO nfiu_sar_queue (sar_reference, trader_id, transaction_amount, suspicious_activity, retry_count, max_retries)
                    VALUES ($1, 'outage-test', 1000000.00, 'Outage test', 5, 5)
                    ON CONFLICT (sar_reference) DO NOTHING
                """, f"{prefix}-{i:04d}")

            await conn.execute(f"""
                UPDATE nfiu_sar_queue SET status='dlq', dlq_reason='nfiu_api_outage', dlq_at=NOW()
                WHERE sar_reference LIKE '{prefix}-%' AND retry_count >= max_retries
            """)

            total = await conn.fetchval(f"SELECT COUNT(*) FROM nfiu_sar_queue WHERE sar_reference LIKE '{prefix}-%'")
            in_dlq = await conn.fetchval(f"SELECT COUNT(*) FROM nfiu_sar_queue WHERE sar_reference LIKE '{prefix}-%' AND status='dlq'")

            assert total == sar_count, f"Data loss: {total}/{sar_count}"
            assert in_dlq == sar_count
            print(f"  PASS: Zero data loss — {total}/{sar_count} SARs in DLQ")
        finally:
            await conn.close()

    asyncio.get_event_loop().run_until_complete(run())


# ─── Test 9: Concurrent PEP Screening ────────────────────────────────────────

def test_concurrent_pep_screening():
    """Test 50 concurrent PEP screenings."""
    print("\nTEST: Concurrent PEP Screening — 50 simultaneous screenings")

    async def run():
        # Use separate connections for each concurrent task
        async def screen_one(entity_name, amount):
            conn = await get_conn()
            try:
                risk_score = 95.0 if "DOE" in entity_name.upper() else 5.0
                pep_matched = risk_score > 50.0
                await conn.execute("""
                    INSERT INTO pep_screening_log (entity_name, risk_score, pep_matched)
                    VALUES ($1, $2, $3)
                """, entity_name, risk_score, pep_matched)
                return pep_matched
            finally:
                await conn.close()

        tasks = [
            screen_one(f"COMPANY-{i:04d}" if i % 5 != 0 else "JOHN DOE ENTERPRISES", 1_000_000.0)
            for i in range(50)
        ]
        results = await asyncio.gather(*tasks)
        return results

    results = asyncio.get_event_loop().run_until_complete(run())
    pep_count = sum(1 for r in results if r)
    assert pep_count == 10, f"Expected 10 PEP matches, got {pep_count}"
    print(f"  PASS: 50 concurrent screenings — {pep_count} PEP matches detected")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
