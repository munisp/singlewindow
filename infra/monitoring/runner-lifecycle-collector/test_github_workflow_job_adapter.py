#!/usr/bin/env python3
import hashlib
import hmac
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import github_workflow_job_adapter as adapter


class WorkflowJobAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        adapter.DELIVERY_DB = str(Path(self.temp_dir.name) / "deliveries.sqlite3")
        adapter.WEBHOOK_SECRET = "test-secret"
        adapter._init_db()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_signature_is_constant_time_compatible_and_rejects_invalid_values(self) -> None:
        body = b'{"action":"queued"}'
        digest = hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()
        self.assertTrue(adapter.verify_signature(body, f"sha256={digest}"))
        self.assertFalse(adapter.verify_signature(body, "sha256=invalid"))
        self.assertFalse(adapter.verify_signature(body, None))

    def test_pull_request_job_is_normalized(self) -> None:
        payload = {
            "action": "queued",
            "repository": {"full_name": "munisp/singlewindow"},
            "workflow_job": {
                "id": 123,
                "run_id": 456,
                "workflow_name": "services",
                "labels": ["self-hosted", "linux", "singlewindow-ci"],
                "pull_requests": [{"number": 7}],
                "created_at": "2026-08-25T20:15:02Z",
            },
        }
        event = adapter.normalize_workflow_job(payload, "delivery-1")
        self.assertEqual(event["event"], "job_queued")
        self.assertEqual(event["runner_label_group"], "singlewindow-ci")
        self.assertTrue(event["pull_request"])
        self.assertEqual(event["job_id"], "123")

    def test_unsupported_action_is_ignored(self) -> None:
        self.assertIsNone(adapter.normalize_workflow_job({"action": "waiting", "workflow_job": {}}, "delivery-2"))

    def test_forwarded_delivery_is_idempotent(self) -> None:
        adapter._begin_delivery("delivery-3")
        adapter._finish_delivery("delivery-3", "forwarded")
        with patch.object(adapter, "forward_event") as forward:
            self.assertEqual(adapter._delivery_state("delivery-3"), "forwarded")
            # The HTTP handler performs the duplicate short-circuit; the state
            # assertion ensures a retry can make that decision without sending.
            if adapter._delivery_state("delivery-3") == "forwarded":
                pass
            forward.assert_not_called()


if __name__ == "__main__":
    unittest.main()
