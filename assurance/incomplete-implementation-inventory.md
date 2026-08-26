# Incomplete-Implementation Inventory

**Assessment revision:** `7ee8b7081a9b7d1d03285652c4630f65373fc306` on a dirty working tree.
**Raw evidence:** `/home/ubuntu/singlewindow-audit/incomplete-implementation-markers.log` and `critical-marker-extract.log`.

The raw lexical scan produced **739 lines**. A lexical marker is not automatically a defect: tests, generated code, explicit optional-resource lookups, and documented safe rejections can contain `null`, `TODO`, or `unimplemented` text. The following classifications distinguish observed evidence from unverified assumptions.

| ID | Classification | Severity | Evidence | Impact / required action |
| --- | --- | --- | --- | --- |
| INC-001 | Confirmed reachable-interface gap | **High** | Four commented gRPC registration calls: declaration, payment, OGA, and profile Go service servers. | The generated public contracts may not be served by deployed binaries. Either register and test every method with authorization/error semantics, or explicitly retire/de-scope the gRPC interfaces and remove their discoverability. Do not re-enable blindly without contract tests. |
| INC-002 | Confirmed evidence gap | **High** | `SW-PAY-001`, `SW-DECL-001`, and release-drill adapters have no executed real staging/provider evidence. | Prevents proof of money/trade state atomicity, idempotency, reconciliation, or unknown-outcome recovery. The release gate remains blocked. |
| INC-003 | Partially remediated upstream-fallback behavior | Medium pending contract review | `server/routers/cost.ts` now emits structured warning diagnostics for non-success and transport failures before falling back to durable cost records; the synthetic random seed path was removed. | Observability remediation is complete locally. Product ownership must still document whether the upstream is optional and define the error/SLO contract; if it is mandatory, replace the fallback with a typed unavailable error and verify it against the real service. |
| INC-004 | Test-only handling requiring isolation review | Medium | Multiple `VITEST` / `NODE_ENV=test` `null` branches in `server/db.ts`. | Verify that each branch is unreachable in production builds and not used as integration/release evidence for durable database behavior. |
| INC-005 | Generated forward-compatibility implementation | Informational pending server registration decision | `UnimplementedDeclarationServiceServer` embed comment in generated/proto-associated Go code. | Not a defect by itself; classify with INC-001 after service exposure decision. |
| INC-006 | Broad unclassified marker population | Medium | Remaining raw TODO/null/placeholder markers across a large polyglot tree. | Assign owners and classify each reachable production marker before release. The attached assurance policy prohibits treating this scan as complete merely because high-risk examples were sampled. |

## Explicit non-conclusion

This inventory is a **starting classification register**, not proof that all reachable placeholders, mocks, no-op branches, or silent failures have been remediated. Completion requires semantic review of each raw match, caller/deployment trace, authorization/durability impact, a documented disposition, and regression evidence.
