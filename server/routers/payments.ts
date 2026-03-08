import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createPayment, updatePayment, getPaymentsByDeclaration,
  getDeclarationById, updateDeclaration, logAuditEvent, createNotification
} from "../db";
import { nanoid } from "nanoid";

export const paymentsRouter = router({
  // Initiate payment for a declaration
  initiate: protectedProcedure
    .input(z.object({
      declarationId: z.number(),
      paymentMethod: z.enum(["bank_transfer", "mobile_money", "card", "bond"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      if (decl.traderId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (!["under_assessment", "payment_pending"].includes(decl.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Declaration is not ready for payment." });
      }

      const payment = await createPayment({
        declarationId: input.declarationId,
        traderId: ctx.user.id,
        amount: decl.totalDue ?? "0",
        currency: decl.invoiceCurrency ?? "USD",
        paymentMethod: input.paymentMethod,
        status: "pending",
        reference: `PAY-${nanoid(12).toUpperCase()}`,
      });

      await updateDeclaration(input.declarationId, { status: "payment_pending" });
      return payment;
    }),

  // Confirm payment (simulates Mojaloop callback)
  confirm: protectedProcedure
    .input(z.object({ paymentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const payments = await getPaymentsByDeclaration(0); // We need to look up by id
      // Simplified: update payment status to confirmed
      const updated = await updatePayment(input.paymentId, {
        status: "confirmed",
        confirmedAt: new Date(),
        mojalooopTransferId: `MJL-${nanoid(16).toUpperCase()}`,
      });

      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });

      // Update declaration to examination stage
      await updateDeclaration(updated.declarationId, { status: "payment_confirmed" });

      await logAuditEvent({
        entityType: "payment",
        entityId: input.paymentId,
        action: "payment_confirmed",
        actorId: ctx.user.id,
        actorType: "system",
        newState: { status: "confirmed" },
      });

      await createNotification({
        userId: updated.traderId,
        type: "payment_confirmed",
        title: "Payment Confirmed",
        message: `Payment of ${updated.amount} ${updated.currency} confirmed. Your declaration is now queued for examination.`,
        entityType: "payment",
        entityId: input.paymentId,
      });

      return updated;
    }),

  // Get payments for a declaration
  byDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      if (decl.traderId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getPaymentsByDeclaration(input.declarationId);
    }),
});
