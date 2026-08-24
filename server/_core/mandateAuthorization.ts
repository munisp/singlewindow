import { TRPCError } from "@trpc/server";
import { getActiveStakeholderMandate } from "../db";

const DECLARATION_CREATION_OVERRIDE_ROLES = new Set([
  "admin",
  "customs_officer",
]);

const PAYMENT_OPERATIONAL_OVERRIDE_ROLES = new Set([
  "admin",
  "finance",
  "customs_officer",
]);

export async function requireActiveAgentMandate(
  principalUserId: number,
  agentUserId: number,
  at = new Date(),
) {
  try {
    const mandate = await getActiveStakeholderMandate(principalUserId, agentUserId, at);
    if (!mandate) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "An active mandate from the principal is required.",
      });
    }
    return mandate;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Mandate authorization is unavailable.",
      cause: error,
    });
  }
}

export async function resolveActingPrincipal(
  principalUserId: number | undefined,
  actor: { id: number; role: string },
) {
  if (!principalUserId || principalUserId === actor.id) {
    return { principalUserId: actor.id, actingAgentId: null };
  }

  if (DECLARATION_CREATION_OVERRIDE_ROLES.has(actor.role)) {
    return { principalUserId, actingAgentId: null };
  }

  await requireActiveAgentMandate(principalUserId, actor.id);
  return { principalUserId, actingAgentId: actor.id };
}

export async function requireDeclarationActor(
  declaration: { traderId: number; principalId?: number | null; actingAgentId?: number | null },
  actor: { id: number; role: string },
  options?: { allowOperationalOverride?: boolean },
) {
  const principalUserId = declaration.principalId ?? declaration.traderId;
  if (principalUserId === actor.id) {
    return { principalUserId, actingAgentId: null };
  }
  if (options?.allowOperationalOverride && PAYMENT_OPERATIONAL_OVERRIDE_ROLES.has(actor.role)) {
    return { principalUserId, actingAgentId: null };
  }
  if (declaration.actingAgentId !== actor.id) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  await requireActiveAgentMandate(principalUserId, actor.id);
  return { principalUserId, actingAgentId: actor.id };
}
