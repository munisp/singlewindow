"""
list_loader.py — Real sanctions list loading for sanctions-service (SW-8/SW-M6)

Loads the actual public sanctions lists at boot and versions them:
  - OFAC SDN list (CSV)         — OFAC_LIST_URL or $SANCTIONS_LIST_DIR/sdn.csv
  - UN SC Consolidated list (XML) — UN_LIST_URL or $SANCTIONS_LIST_DIR/consolidated.xml

Fail-closed contract:
  * If a list cannot be loaded (network, parse error, missing file), the
    registry records the error and `is_available()` is False — the screening
    endpoint MUST refuse to screen (503) rather than silently screening
    against a 5-name hardcoded stub or nothing at all.
  * `is_stale()` flags lists older than SANCTIONS_MAX_AGE_HOURS (default 24h)
    so a dead upstream cannot serve ancient data indefinitely.
  * Every screening result embeds `list_version` so the compliance audit trail
    records EXACTLY which bytes were screened against.

Only lists that actually loaded are reported in `lists_loaded` — the service
description never claims coverage it does not have.
"""
from __future__ import annotations

import csv
import hashlib
import io
import logging
import os
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

OFAC_SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv"
UN_CONSOLIDATED_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"


def parse_ofac_sdn_csv(text: str) -> list[dict]:
    """Parse OFAC SDN CSV. Columns: ent_num, name, sdn_type, program, ..."""
    entries = []
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if len(row) < 3:
            continue
        ent_num, name, sdn_type = row[0].strip(), row[1].strip(), row[2].strip()
        if not ent_num.isdigit() or not name:
            continue
        entries.append({
            "id": f"OFAC-{ent_num}",
            "name": name,
            "list": "OFAC-SDN",
            "type": (sdn_type or "unknown").lower(),
        })
    return entries


def parse_un_consolidated_xml(text: str) -> list[dict]:
    """Parse UN SC Consolidated XML (individuals + entities)."""
    entries = []
    root = ET.fromstring(text)

    def name_of(elem) -> str:
        parts = []
        for tag in ("FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"):
            node = elem.find(tag)
            if node is not None and node.text:
                parts.append(node.text.strip())
        return " ".join(parts).strip()

    for path, kind in ((".//INDIVIDUAL", "individual"), (".//ENTITY", "entity")):
        for elem in root.findall(path):
            dataid = elem.findtext("DATAID") or ""
            name = name_of(elem)
            if not dataid or not name:
                continue
            entries.append({
                "id": f"UN-{dataid.strip()}",
                "name": name,
                "list": "UN-SC",
                "type": kind,
            })
    return entries


@dataclass
class LoadedList:
    source: str
    entries: list[dict]
    version: str
    loaded_at: float = field(default_factory=time.time)


class SanctionsListRegistry:
    """Holds the loaded lists + version metadata; fail-closed availability."""

    def __init__(self) -> None:
        self._lists: dict[str, LoadedList] = {}
        self._errors: dict[str, str] = {}

    # ── Loading ────────────────────────────────────────────────────────────

    def load_from_dir(self, directory: str) -> None:
        """Load lists from local files (deterministic; used by tests and
        offline/air-gapped deployments)."""
        self._lists, self._errors = {}, {}
        sdn_path = os.path.join(directory, "sdn.csv")
        un_path = os.path.join(directory, "consolidated.xml")
        if os.path.exists(sdn_path):
            try:
                with open(sdn_path, "r", encoding="utf-8", errors="replace") as fh:
                    self._add("OFAC-SDN", parse_ofac_sdn_csv(fh.read()), sdn_path)
            except Exception as e:  # parse/IO failure → fail closed
                self._errors["OFAC-SDN"] = str(e)
                logger.error(f"[sanctions] OFAC file parse failed: {e}")
        else:
            self._errors["OFAC-SDN"] = f"file not found: {sdn_path}"
        if os.path.exists(un_path):
            try:
                with open(un_path, "r", encoding="utf-8", errors="replace") as fh:
                    self._add("UN-SC", parse_un_consolidated_xml(fh.read()), un_path)
            except Exception as e:
                self._errors["UN-SC"] = str(e)
                logger.error(f"[sanctions] UN file parse failed: {e}")
        else:
            self._errors["UN-SC"] = f"file not found: {un_path}"

    def load_from_urls(self, ofac_url: str = OFAC_SDN_URL, un_url: str = UN_CONSOLIDATED_URL,
                       timeout: int = 60) -> None:
        """Fetch + parse the public lists. Network failure → recorded error,
        never a partial silent success."""
        import requests  # deferred so unit tests need no network stack

        self._lists, self._errors = {}, {}
        for list_name, url, parser in (
            ("OFAC-SDN", ofac_url, parse_ofac_sdn_csv),
            ("UN-SC", un_url, parse_un_consolidated_xml),
        ):
            if not url:
                self._errors[list_name] = "no URL configured"
                continue
            try:
                resp = requests.get(url, timeout=timeout)
                resp.raise_for_status()
                self._add(list_name, parser(resp.text), url)
            except Exception as e:
                self._errors[list_name] = str(e)
                logger.error(f"[sanctions] {list_name} fetch/parse failed: {e}")

    def _add(self, list_name: str, entries: list[dict], source: str) -> None:
        if not entries:
            self._errors[list_name] = f"parsed 0 entries from {source} (fail closed)"
            return
        digest = hashlib.sha256(
            "\n".join(f"{e['id']}|{e['name']}" for e in entries).encode("utf-8")
        ).hexdigest()[:16]
        self._lists[list_name] = LoadedList(source=source, entries=entries, version=digest)
        logger.info(f"[sanctions] {list_name}: loaded {len(entries)} entries (version {digest}) from {source}")

    # ── Status ─────────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        """True only when at least one REAL list loaded with entries."""
        return len(self._lists) > 0

    def is_stale(self, max_age_hours: float = 24.0) -> bool:
        if not self._lists:
            return True
        oldest = min(l.loaded_at for l in self._lists.values())
        return (time.time() - oldest) > max_age_hours * 3600

    @property
    def errors(self) -> dict[str, str]:
        return dict(self._errors)

    @property
    def lists_loaded(self) -> list[str]:
        return sorted(self._lists.keys())

    def list_version(self) -> str:
        """Composite version across loaded lists — embedded in every screening log."""
        if not self._lists:
            return "NO_LISTS_LOADED"
        return "+".join(f"{name}:{self._lists[name].version}" for name in sorted(self._lists))

    def all_entries(self) -> list[dict]:
        out: list[dict] = []
        for loaded in self._lists.values():
            out.extend(loaded.entries)
        return out

    def status(self) -> dict:
        return {
            "listsLoaded": self.lists_loaded,
            "listVersion": self.list_version(),
            "entryCounts": {name: len(l.entries) for name, l in self._lists.items()},
            "loadErrors": self.errors,
            "loadedAt": {name: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(l.loaded_at))
                         for name, l in self._lists.items()},
        }


def build_registry_from_env() -> SanctionsListRegistry:
    """Boot wiring: SANCTIONS_LIST_DIR (offline/air-gapped) wins; otherwise
    fetch from OFAC_LIST_URL / UN_LIST_URL (public downloads)."""
    registry = SanctionsListRegistry()
    list_dir = os.getenv("SANCTIONS_LIST_DIR", "").strip()
    if list_dir:
        registry.load_from_dir(list_dir)
    else:
        registry.load_from_urls(
            ofac_url=os.getenv("OFAC_LIST_URL", OFAC_SDN_URL),
            un_url=os.getenv("UN_LIST_URL", UN_CONSOLIDATED_URL),
        )
    return registry
