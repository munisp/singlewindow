"""
keycloak_middleware.py — Keycloak JWT validation for Python AI service HTTP endpoints.
Fetches JWKS from Keycloak and validates RS256 bearer tokens.
"""
import logging
import os
import threading
import time
from typing import Dict, Optional

import requests

logger = logging.getLogger(__name__)


class KeycloakMiddleware:
    def __init__(self, service_name: str):
        self.service_name = service_name
        base = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
        realm = os.getenv("KEYCLOAK_REALM", "tradegateway")
        self.jwks_url = f"{base}/realms/{realm}/protocol/openid-connect/certs"
        self.issuer = f"{base}/realms/{realm}"
        # SW-S2-6: audience + issuer are enforced on every token (fail closed).
        # Set KEYCLOAK_EXPECTED_AUDIENCE to the client id tokens are issued for.
        self.expected_audience = os.getenv("KEYCLOAK_EXPECTED_AUDIENCE", "tradegateway-api")
        self._jwks: Optional[Dict] = None
        self._jwks_lock = threading.Lock()
        self._last_fetch = 0.0
        self._cache_ttl = 3600  # 1 hour

    def fetch_jwks(self) -> Optional[Dict]:
        """Fetch and cache JWKS from Keycloak."""
        now = time.time()
        if self._jwks and (now - self._last_fetch) < self._cache_ttl:
            return self._jwks
        try:
            resp = requests.get(self.jwks_url, timeout=5)
            resp.raise_for_status()
            with self._jwks_lock:
                self._jwks = resp.json()
                self._last_fetch = now
            logger.info(f"[{self.service_name}] JWKS refreshed, keys={len(self._jwks.get('keys', []))}")
            return self._jwks
        except Exception as e:
            logger.warning(f"[{self.service_name}] JWKS fetch failed: {e}")
            return self._jwks  # Return stale cache if available

    def extract_bearer(self, auth_header: str) -> Optional[str]:
        """Extract bearer token from Authorization header."""
        if auth_header and auth_header.startswith("Bearer "):
            return auth_header[7:]
        return None

    def validate_token(self, token: str) -> Optional[Dict]:
        """
        Validate a JWT token against Keycloak JWKS.
        Returns decoded claims on success, None on failure.
        In production: use python-jose or PyJWT with RS256 verification.
        """
        try:
            import jwt  # PyJWT
            jwks = self.fetch_jwks()
            if not jwks:
                logger.warning(f"[{self.service_name}] No JWKS available, rejecting token")
                return None
            # Decode without verification first to get kid
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            # Find matching key
            key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
            if not key:
                logger.warning(f"[{self.service_name}] No matching JWK for kid={kid}")
                return None
            from jwt.algorithms import RSAAlgorithm
            public_key = RSAAlgorithm.from_jwk(key)
            # SW-S2-6: enforce audience and issuer against configured expected
            # values — a token for another audience or issuer is rejected.
            claims = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=self.expected_audience,
                issuer=self.issuer,
            )
            return claims
        except Exception as e:
            logger.warning(f"[{self.service_name}] JWT validation failed: {e}")
            return None

    def get_roles(self, claims: Dict) -> list:
        """Extract realm roles from decoded JWT claims."""
        return claims.get("realm_access", {}).get("roles", [])
