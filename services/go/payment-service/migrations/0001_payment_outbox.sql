-- payment-service migrations — 0001_payment_outbox.sql
-- Phase-9 WP-B: durable transactional outbox for payment lifecycle events.
-- Domain writes and outbox inserts happen in ONE transaction; an idempotent
-- drainer publishes to Kafka at-least-once with idempotent keys. Poisoned
-- records land on the DLQ topic after the attempt budget is exhausted.

CREATE TABLE IF NOT EXISTS payment_outbox (
    id              BIGSERIAL PRIMARY KEY,
    topic           TEXT        NOT NULL,
    event_key       TEXT        NOT NULL,           -- idempotent Kafka key
    payload         JSON       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,                    -- NULL = pending
    attempts        INT         NOT NULL DEFAULT 0,
    last_error      TEXT,                           -- last publish failure (no payload echo)
    failed_at       TIMESTAMPTZ                     -- set when routed to DLQ
);

CREATE INDEX IF NOT EXISTS payment_outbox_pending_idx
    ON payment_outbox (id)
    WHERE published_at IS NULL AND failed_at IS NULL;
