import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProfileByUserId, createProfile, updateProfile,
  getPendingProfiles, getAllProfiles, logAuditEvent,
  createNotification, getUserById, getAllUsers
} from "../db";

export const profilesRouter = router({
  // Get current user's profile
  me: protectedProcedure.query(async ({ ctx }) => {
    return getProfileByUserId(ctx.user.id);
  }),

  // Create or update stakeholder profile (onboarding)
  upsert: protectedProcedure
    .input(z.object({
      stakeholderType: z.enum([
        "trader", "customs_officer", "oga_officer", "freight_forwarder",
        "bank_officer", "port_authority", "system_admin", "auditor"
      ]),
      organizationName: z.string().min(2).max(255),
      organizationCode: z.string().max(64).optional(),
      licenseNumber: z.string().max(128).optional(),
      taxId: z.string().max(64).optional(),
      country: z.string().length(2),
      phone: z.string().max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProfileByUserId(ctx.user.id);
      if (existing) {
        // Can update if pending or rejected
        if (existing.status === "approved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Approved profiles cannot be modified. Contact an administrator."
          });
        }
        const updated = await updateProfile(existing.id, {
          ...input,
          status: "pending",
          rejectionReason: null,
        });
        await logAuditEvent({
          entityType: "user",
          entityId: ctx.user.id,
          action: "profile_updated",
          actorId: ctx.user.id,
          actorType: "trader",
          newState: updated,
        });
        return updated;
      }
      const profile = await createProfile({
        userId: ctx.user.id,
        ...input,
        status: "pending",
      });
      await logAuditEvent({
        entityType: "user",
        entityId: ctx.user.id,
        action: "profile_created",
        actorId: ctx.user.id,
        actorType: input.stakeholderType,
        newState: profile,
      });
      return profile;
    }),

  // Admin: list all pending profiles
  pending: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    return getPendingProfiles();
  }),

  // Admin: list all profiles
  all: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllProfiles(input.limit, input.offset);
    }),

  // Admin: approve a profile
  approve: protectedProcedure
    .input(z.object({ profileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const updated = await updateProfile(input.profileId, {
        status: "approved",
        approvedBy: ctx.user.id,
        approvedAt: new Date(),
        rejectionReason: null,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      await logAuditEvent({
        entityType: "user",
        entityId: updated.userId,
        action: "profile_approved",
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { status: "approved" },
      });
      await createNotification({
        userId: updated.userId,
        type: "aeo_status_update",
        title: "Profile Approved",
        message: `Your ${updated.stakeholderType.replace(/_/g, " ")} profile for ${updated.organizationName} has been approved. You can now access all platform features.`,
        entityType: "user",
        entityId: updated.userId,
      });
      return updated;
    }),

  // Admin: reject a profile
  reject: protectedProcedure
    .input(z.object({ profileId: z.number(), reason: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const updated = await updateProfile(input.profileId, {
        status: "rejected",
        rejectionReason: input.reason,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      await logAuditEvent({
        entityType: "user",
        entityId: updated.userId,
        action: "profile_rejected",
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { status: "rejected", reason: input.reason },
      });
      await createNotification({
        userId: updated.userId,
        type: "aeo_status_update",
        title: "Profile Rejected",
        message: `Your profile application was rejected. Reason: ${input.reason}. Please update your information and resubmit.`,
        entityType: "user",
        entityId: updated.userId,
      });
      return updated;
    }),

  // Admin: suspend a profile
  suspend: protectedProcedure
    .input(z.object({ profileId: z.number(), reason: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const updated = await updateProfile(input.profileId, {
        status: "suspended",
        rejectionReason: input.reason,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  // Admin: get all users with their profiles
  usersWithProfiles: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const users = await getAllUsers(input.limit, input.offset);
      const profiles = await getAllProfiles(input.limit, input.offset);
      const profileMap = new Map(profiles.map(p => [p.userId, p]));
      return users.map(u => ({ ...u, profile: profileMap.get(u.id) ?? null }));
    }),
});
