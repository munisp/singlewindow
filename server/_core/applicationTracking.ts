import { TRPCError } from "@trpc/server";
import {
  getPublicDeclarationTracking,
  getPublicPermitTracking,
  getStakeholderRegistrationByReference,
} from "../db";

export async function lookupPublicApplication(referenceNumber: string) {
  const registration = await getStakeholderRegistrationByReference(referenceNumber);
  if (registration) {
    return {
      referenceNumber: registration.referenceNumber,
      type: registration.stakeholderType,
      status: registration.status,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
      approvedAt: registration.approvedAt,
    };
  }

  const declaration = await getPublicDeclarationTracking(referenceNumber);
  if (declaration) {
    return {
      referenceNumber: declaration.declarationNumber,
      type: declaration.declarationType,
      status: declaration.status,
      createdAt: declaration.createdAt,
      updatedAt: declaration.updatedAt,
      submittedAt: declaration.submittedAt,
      clearedAt: declaration.clearedAt,
    };
  }

  const permit = await getPublicPermitTracking(referenceNumber);
  if (permit) {
    return {
      referenceNumber: permit.permitNumber,
      type: permit.permitType ?? "oga_permit",
      status: permit.status,
      createdAt: permit.createdAt,
      updatedAt: permit.updatedAt,
      respondedAt: permit.respondedAt,
      expiresAt: permit.expiresAt,
    };
  }

  throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
}
