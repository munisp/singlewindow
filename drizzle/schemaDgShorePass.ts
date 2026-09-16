// schemaDgShorePass.ts — RE-EXPORT SHIM (Phase 19 F1/H1).
// The dangerous-goods / shore-pass tables moved into the single drizzle
// schema module (drizzle/schema.ts) so drizzle-kit sees one coherent schema
// and a consolidated baseline snapshot (0071). This shim keeps existing
// imports working; new code should import from "./schema".
export {
  imdgSegregationRules,
  dangerousGoodsDeclarations,
  shorePassEvents,
} from "./schema";
