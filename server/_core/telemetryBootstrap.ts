/**
 * telemetryBootstrap.ts — MUST be the first server module imported (after
 * dotenv/config) in server/_core/index.ts. Starting the SDK here, before
 * express/pg/ioredis/kafkajs are loaded, lets the auto-instrumentation
 * require hooks patch those modules. With OTEL_EXPORTER_OTLP_ENDPOINT unset
 * this is a no-op and boot is completely unaffected.
 */
import { initTelemetry } from "./telemetry";

initTelemetry();
