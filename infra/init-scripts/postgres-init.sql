-- TradeGateway NGSWTP — PostgreSQL Initialization
-- Creates schemas for application isolation

CREATE SCHEMA IF NOT EXISTS keycloak;
CREATE SCHEMA IF NOT EXISTS temporal;
CREATE SCHEMA IF NOT EXISTS permify;
CREATE SCHEMA IF NOT EXISTS app;

-- Grant keycloak schema to app user
GRANT ALL PRIVILEGES ON SCHEMA keycloak TO tradegateway;
GRANT ALL PRIVILEGES ON SCHEMA temporal TO tradegateway;
GRANT ALL PRIVILEGES ON SCHEMA permify TO tradegateway;
GRANT ALL PRIVILEGES ON SCHEMA app TO tradegateway;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
