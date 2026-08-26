#!/usr/bin/env python3
import unittest

import collector


class CollectorContractTests(unittest.TestCase):
    def setUp(self) -> None:
        with collector._lock:
            collector._jobs.clear()
            collector._workspaces.clear()
            collector._runner_requests.clear()

    def test_job_queue_lifecycle_records_wait_and_clears_depth(self) -> None:
        collector.handle_event({
            "event": "job_queued",
            "job_id": "job-queue-1",
            "repository": "munisp/singlewindow",
            "workflow": "services",
            "runner_label_group": "singlewindow-ci",
            "timestamp": 100,
        })
        collector.handle_event({
            "event": "job_in_progress",
            "job_id": "job-queue-1",
            "pull_request": True,
            "timestamp": 220,
        })
        output = collector.generate_latest(collector.REGISTRY).decode()
        self.assertIn('ci_job_queue_wait_seconds_count{event="pull_request",repository="munisp/singlewindow",runner_label_group="singlewindow-ci",workflow="services"} 1.0', output)
        self.assertIn('ci_queue_depth{repository="munisp/singlewindow",runner_label_group="singlewindow-ci"} 0.0', output)

    def test_runner_provisioning_and_failure_metrics(self) -> None:
        collector.handle_event({
            "event": "runner_requested",
            "runner_name": "runner-1",
            "timestamp": 100,
        })
        collector.handle_event({
            "event": "runner_online",
            "runner_name": "runner-1",
            "runner_mode": "ephemeral",
            "image_version": "2.336.0",
            "timestamp": 160,
        })
        collector.handle_event({
            "event": "runner_registration_failed",
            "failure_class": "token_request_denied",
        })
        output = collector.generate_latest(collector.REGISTRY).decode()
        self.assertIn('runner_provision_seconds_count{image_version="2.336.0",repository="munisp/singlewindow",runner_mode="ephemeral"} 1.0', output)
        self.assertIn('runner_registration_failure_total{failure_class="token_request_denied",repository="munisp/singlewindow"} 1.0', output)

    def test_workspace_cleanup_and_harness_metrics(self) -> None:
        collector.handle_event({
            "event": "workspace_created",
            "compose_project": "test-project-1",
            "host": "runner-host-1",
            "timestamp": 1_000,
        })
        collector.handle_event({
            "event": "harness_stage",
            "stage": "migration",
            "duration_seconds": 4,
        })
        collector.handle_event({
            "event": "harness_failure",
            "stage": "seed",
        })
        collector.handle_event({
            "event": "workspace_removed",
            "compose_project": "test-project-1",
            "host": "runner-host-1",
        })
        output = collector.generate_latest(collector.REGISTRY).decode()
        self.assertNotIn('compose_project="test-project-1"', output)
        self.assertIn('ci_postgres_harness_stage_seconds_count{repository="munisp/singlewindow",stage="migration"} 1.0', output)
        self.assertIn('ci_postgres_harness_setup_failures_total{repository="munisp/singlewindow",stage="seed"} 1.0', output)

    def test_release_drill_events_record_duration_outcome_and_evidence(self) -> None:
        collector.handle_event({"event": "drill_started", "drill_id": "drill-test-1", "scenario_id": "RD-2", "timestamp": 1_700_000_000})
        collector.handle_event({"event": "drill_completed", "drill_id": "drill-test-1", "scenario_id": "RD-2", "result": "passed", "timestamp": 1_700_000_012, "evidence_classes": ["database", "audit", "outbox"]})
        output = collector.generate_latest(collector.REGISTRY).decode()
        self.assertIn('release_drill_active{repository="munisp/singlewindow",scenario_id="RD-2"} 0.0', output)
        self.assertIn('release_drill_runs_total{repository="munisp/singlewindow",result="passed",scenario_id="RD-2"} 1.0', output)
        self.assertIn('release_drill_evidence_present{evidence_class="database",repository="munisp/singlewindow",scenario_id="RD-2"} 1.0', output)

    def test_log_heartbeat_and_image_staleness(self) -> None:
        collector.handle_event({"event": "log_heartbeat", "timestamp": 1_700_000_000})
        collector.handle_event({"event": "image_stale", "image_version": "2.335.0", "stale": True})
        output = collector.generate_latest(collector.REGISTRY).decode()
        self.assertIn('runner_last_log_timestamp_seconds{repository="munisp/singlewindow"} 1.7e+09', output)
        self.assertIn('runner_image_stale{image_version="2.335.0",repository="munisp/singlewindow"} 1.0', output)


if __name__ == "__main__":
    unittest.main()
