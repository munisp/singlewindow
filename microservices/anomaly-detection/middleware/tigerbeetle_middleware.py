"""
tigerbeetle_middleware.py — TigerBeetle financial ledger integration for Python AI services.

Python AI services interact with TigerBeetle to:
  - risk-ai: Record risk-based duty surcharges as pending transfers
  - sanctions-service: Freeze trader accounts on confirmed sanctions hits
  - anomaly-detection: Record penalty assessments for detected anomalies
  - hs-classifier: Record duty differential on HS code reclassification

All transfers are recorded via the TigerBeetle HTTP bridge (Rust service).
"""
import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# Ledger codes
LEDGER_NGN_CUSTOMS = 1      # Nigerian Naira customs duties
LEDGER_USD_CUSTOMS = 2      # USD-denominated duties

# Transfer codes
CODE_CUSTOMS_DUTY = 1001
CODE_PENALTY = 1002
CODE_VAT = 1003
CODE_LEVY = 1004
CODE_SURCHARGE = 1005
CODE_ACCOUNT_FREEZE = 1006

# Account IDs (well-known)
ACCOUNT_GOVERNMENT_REVENUE = "gov-revenue-ngn-001"
ACCOUNT_PENALTY_POOL = "gov-penalty-pool-001"


class TigerBeetleMiddleware:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.base_url = os.getenv("TIGERBEETLE_HTTP_URL", "http://tigerbeetle-bridge:8099")
        self.session = requests.Session()
        self.session.timeout = 5

    def record_transfer(
        self,
        transfer_id: str,
        debit_account_id: str,
        credit_account_id: str,
        amount: int,
        ledger: int,
        code: int,
        user_data: Optional[str] = None,
        flags: int = 0,
    ) -> bool:
        """
        Record a double-entry transfer in TigerBeetle.
        amount is in minor currency units (kobo for NGN).
        Returns True on success, False on failure.
        """
        payload = {
            "transfers": [{
                "id": transfer_id,
                "debit_account_id": debit_account_id,
                "credit_account_id": credit_account_id,
                "amount": amount,
                "ledger": ledger,
                "code": code,
                "user_data": user_data or "",
                "flags": flags,
            }]
        }
        try:
            resp = self.session.post(f"{self.base_url}/transfers", json=payload)
            if resp.status_code < 300:
                logger.info(
                    f"[{self.service_name}] TigerBeetle transfer recorded: "
                    f"id={transfer_id} amount={amount} code={code}"
                )
                return True
            logger.warning(
                f"[{self.service_name}] TigerBeetle transfer non-2xx: {resp.status_code}"
            )
            return False
        except Exception as e:
            logger.warning(f"[{self.service_name}] TigerBeetle transfer failed (non-fatal): {e}")
            return False

    def record_duty_surcharge(
        self,
        transfer_id: str,
        trader_account_id: str,
        amount_kobo: int,
        declaration_id: str,
    ) -> bool:
        """Record a risk-based duty surcharge (debit trader, credit government revenue)."""
        import json
        user_data = json.dumps({"declaration_id": declaration_id, "service": self.service_name})
        return self.record_transfer(
            transfer_id=transfer_id,
            debit_account_id=trader_account_id,
            credit_account_id=ACCOUNT_GOVERNMENT_REVENUE,
            amount=amount_kobo,
            ledger=LEDGER_NGN_CUSTOMS,
            code=CODE_SURCHARGE,
            user_data=user_data,
        )

    def record_penalty(
        self,
        transfer_id: str,
        trader_account_id: str,
        amount_kobo: int,
        declaration_id: str,
        reason: str,
    ) -> bool:
        """Record a penalty assessment (debit trader, credit penalty pool)."""
        import json
        user_data = json.dumps({
            "declaration_id": declaration_id,
            "reason": reason,
            "service": self.service_name,
        })
        return self.record_transfer(
            transfer_id=transfer_id,
            debit_account_id=trader_account_id,
            credit_account_id=ACCOUNT_PENALTY_POOL,
            amount=amount_kobo,
            ledger=LEDGER_NGN_CUSTOMS,
            code=CODE_PENALTY,
            user_data=user_data,
        )

    def get_account_balance(self, account_id: str) -> Optional[int]:
        """Get the current balance of a trader's duty account in kobo."""
        try:
            resp = self.session.get(f"{self.base_url}/accounts/{account_id}/balance")
            body = resp.json()
            credits = body.get("credits_posted", 0)
            debits = body.get("debits_posted", 0)
            return credits - debits
        except Exception as e:
            logger.warning(f"[{self.service_name}] TigerBeetle balance check failed: {e}")
            return None
