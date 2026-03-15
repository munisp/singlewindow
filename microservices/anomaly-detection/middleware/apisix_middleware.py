"""
apisix_middleware.py — APISIX Admin API route registration for Python AI services.
Each AI service registers its routes in APISIX on startup with Keycloak JWT auth,
Prometheus metrics, and response headers.

Route mappings:
  - risk-ai:           /api/v1/risk/*
  - hs-classifier:     /api/v1/hs-classify/*
  - sanctions-service: /api/v1/sanctions/*
  - anomaly-detection: /api/v1/anomaly/*
  - gnn-risk:          /api/v1/gnn-risk/*
  - vision-service:    /api/v1/vision/analyze/*
"""
import logging
import os
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


# Route definitions per AI service
AI_SERVICE_ROUTES: Dict[str, Dict] = {
    "risk-ai": {
        "id": "risk-ai-api",
        "uri": "/api/v1/risk/*",
        "port": 8085,
    },
    "hs-classifier": {
        "id": "hs-classifier-api",
        "uri": "/api/v1/hs-classify/*",
        "port": 8086,
    },
    "sanctions-service": {
        "id": "sanctions-service-api",
        "uri": "/api/v1/sanctions/*",
        "port": 8087,
    },
    "anomaly-detection": {
        "id": "anomaly-detection-api",
        "uri": "/api/v1/anomaly/*",
        "port": 8088,
    },
    "gnn-risk": {
        "id": "gnn-risk-api",
        "uri": "/api/v1/gnn-risk/*",
        "port": 8089,
    },
    "vision-service": {
        "id": "vision-service-api",
        "uri": "/api/v1/vision/analyze/*",
        "port": 8090,
    },
}


class APISIXMiddleware:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.admin_url = os.getenv("APISIX_ADMIN_URL", "http://apisix:9180")
        self.admin_key = os.getenv("APISIX_ADMIN_KEY", "edd1c9f034335f136f87ad84b625c8f1")
        self.keycloak_url = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
        self.keycloak_realm = os.getenv("KEYCLOAK_REALM", "tradegateway")
        self.session = requests.Session()
        self.session.timeout = 5
        self.session.headers.update({"X-API-KEY": self.admin_key, "Content-Type": "application/json"})

    def register_routes(self, service_host: Optional[str] = None, service_port: Optional[int] = None) -> bool:
        """
        Register this service's routes in APISIX.
        service_host defaults to the service_name (Docker DNS).
        service_port defaults to the port defined in AI_SERVICE_ROUTES.
        """
        route_def = AI_SERVICE_ROUTES.get(self.service_name)
        if not route_def:
            logger.warning(f"[{self.service_name}] No APISIX route definition found")
            return False

        host = service_host or self.service_name
        port = service_port or route_def["port"]

        route = {
            "id": route_def["id"],
            "name": self.service_name,
            "uri": route_def["uri"],
            "methods": ["GET", "POST"],
            "upstream": {
                "type": "roundrobin",
                "nodes": {f"{host}:{port}": 1},
            },
            "plugins": {
                "openid-connect": {
                    "client_id": "tradegateway-api",
                    "client_secret": os.getenv("KEYCLOAK_CLIENT_SECRET", ""),
                    "discovery": (
                        f"{self.keycloak_url}/realms/{self.keycloak_realm}"
                        "/.well-known/openid-configuration"
                    ),
                    "bearer_only": True,
                    "realm": self.keycloak_realm,
                    "introspection_endpoint_auth_method": "client_secret_post",
                },
                "prometheus": {},
                "response-rewrite": {
                    "headers": {"X-Service": self.service_name},
                },
                "limit-req": {
                    "rate": 100,
                    "burst": 200,
                    "key": "consumer_name",
                },
            },
        }

        url = f"{self.admin_url}/apisix/admin/routes/{route_def['id']}"
        try:
            resp = self.session.put(url, json=route)
            if resp.status_code < 300:
                logger.info(
                    f"[{self.service_name}] APISIX route registered: "
                    f"{route_def['uri']} → {host}:{port}"
                )
                return True
            logger.warning(
                f"[{self.service_name}] APISIX route registration non-2xx: {resp.status_code}"
            )
            return False
        except Exception as e:
            logger.warning(f"[{self.service_name}] APISIX route registration failed (non-fatal): {e}")
            return False

    def deregister_routes(self) -> bool:
        """Deregister this service's routes from APISIX on shutdown."""
        route_def = AI_SERVICE_ROUTES.get(self.service_name)
        if not route_def:
            return False
        url = f"{self.admin_url}/apisix/admin/routes/{route_def['id']}"
        try:
            resp = self.session.delete(url)
            logger.info(f"[{self.service_name}] APISIX route deregistered")
            return resp.status_code < 300
        except Exception as e:
            logger.warning(f"[{self.service_name}] APISIX deregister failed: {e}")
            return False
