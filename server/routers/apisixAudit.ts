/**
 * apisixAuditRouter — v89: APISIX route change audit trail.
 */
import { z } from "zod";
import { router, keycloakAdminProcedure } from "../_core/trpc";

export const apisixAuditRouter = router({
  /**
   * v89: Get APISIX route audit log entries.
   * Admin-only: gateway route configuration is internal infrastructure detail.
   */
  getRouteAudit: keycloakAdminProcedure
    .input(z.object({ routeId: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const { getApisixRouteAuditLog } = await import("../db");
      return getApisixRouteAuditLog({ routeId: input.routeId, limit: input.limit });
    }),

  /**
   * v89: Record a new APISIX route change event.
   */
  recordChange: keycloakAdminProcedure
    .input(z.object({
      routeId: z.string().min(1),
      routeName: z.string().optional(),
      operation: z.enum(["create", "update", "delete", "enable", "disable"]),
      previousConfig: z.record(z.string(), z.unknown()).optional(),
      newConfig: z.record(z.string(), z.unknown()).optional(),
      changeReason: z.string().max(500).optional(),
      apisixVersion: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { insertApisixRouteAuditEntry } = await import("../db");
      return insertApisixRouteAuditEntry({
        ...input,
        actorId: ctx.user.id,
        previousConfig: input.previousConfig as object | undefined,
        newConfig: input.newConfig as object | undefined,
      });
    }),

  /**
   * v89: Get distinct route IDs for filter dropdown.
   */
  getRouteIds: keycloakAdminProcedure.query(async () => {
    const { getApisixRouteAuditLog } = await import("../db");
    const rows = await getApisixRouteAuditLog({ limit: 500 });
    const ids = [...new Set(rows.map(r => r.routeId))].sort();
    return ids;
  }),
});
