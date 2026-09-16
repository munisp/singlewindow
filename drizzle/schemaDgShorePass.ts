/**
 * schemaDgShorePass.ts — Phase 19 (F5a) drizzle tables.
 *
 * Phase 19 (F1, H1): the table definitions now live in the central
 * drizzle/schema.ts so `drizzle-kit generate` sees the full schema and the
 * snapshot chain can be consolidated. This module re-exports them so existing
 * imports (server/routers/dangerousGoods.ts, server/routers/shorePass.ts)
 * keep working unchanged.
 */
export {
  declarationDgItems,
  shorePassApplications,
  shorePassEvents,
} from "./schema";
export type {
  DeclarationDgItem,
  InsertDeclarationDgItem,
  ShorePassApplication,
  InsertShorePassApplication,
  ShorePassEvent,
  InsertShorePassEvent,
} from "./schema";
