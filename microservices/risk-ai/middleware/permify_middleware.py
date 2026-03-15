"""
permify_middleware.py — Permify fine-grained authorization for Python AI service endpoints.
Checks ReBAC permissions before serving AI inference results.
"""
import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)


class PermifyMiddleware:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.base_url = os.getenv("PERMIFY_URL", "http://permify:3476")
        self.tenant_id = os.getenv("PERMIFY_TENANT_ID", "t1")
        self.session = requests.Session()
        self.session.timeout = 2

    def check(self, user_id: str, entity_type: str, entity_id: str, permission: str) -> bool:
        """
        Check if user_id can perform permission on entity_type:entity_id.
        Fails open (returns True) if Permify is unavailable.
        """
        payload = {
            "metadata": {"depth": 20},
            "entity": {"type": entity_type, "id": entity_id},
            "permission": permission,
            "subject": {"type": "user", "id": user_id},
        }
        url = f"{self.base_url}/v1/tenants/{self.tenant_id}/permissions/check"
        try:
            resp = self.session.post(url, json=payload)
            result = resp.json()
            allowed = result.get("can") == "RESULT_ALLOWED"
            logger.info(
                f"[{self.service_name}] Permify check: user={user_id} "
                f"entity={entity_type}:{entity_id} perm={permission} allowed={allowed}"
            )
            return allowed
        except Exception as e:
            logger.warning(f"[{self.service_name}] Permify check failed (fail-open): {e}")
            return True  # fail-open for AI service availability

    def can_invoke_ai(self, service_account_id: str) -> bool:
        """Check if a service account can invoke AI inference endpoints."""
        return self.check(service_account_id, "ai_service", "singleton", "invoke")

    def can_view_risk_score(self, user_id: str, declaration_id: str) -> bool:
        """Check if a user can view the risk score for a declaration."""
        return self.check(user_id, "declaration", declaration_id, "view_risk_score")
