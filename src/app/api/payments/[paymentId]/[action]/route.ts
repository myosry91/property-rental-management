import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth";

type Action = "approve" | "reject" | "void";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string; action: string }> },
) {
  try {
    const auth = await getAuthContext();

    if (!auth) return error("Unauthorized", 401);
    if (auth.role !== "manager") return error("Forbidden", 403);

    const { paymentId, action } = await params;

    if (!["approve", "reject", "void"].includes(action)) {
      return error("Invalid action", 404);
    }

    const typedAction = action as Action;
    let body: { reason?: string } = {};

    if (typedAction !== "approve") {
      try {
        body = await request.json();
      } catch {
        return error("Invalid JSON body", 400);
      }

      if (typeof body?.reason !== "string" || body.reason.trim().length < 5) {
        return error("A reason of at least 5 characters is required", 400);
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findFirst({
          where: {
            id: paymentId,
            orgId: auth.orgId,
          },
        });

        if (!payment) throw new Error("PAYMENT_NOT_FOUND");

        if (typedAction === "approve" || typedAction === "reject") {
          if (payment.status !== "pending_verification") {
            throw new Error("PAYMENT_NOT_PENDING");
          }
        }

        if (typedAction === "void" && payment.status !== "approved") {
          throw new Error("PAYMENT_NOT_APPROVED");
        }

        if (typedAction === "approve") {
          const invoices = await tx.invoice.findMany({
            where: {
              leaseId: payment.leaseId,
              orgId: auth.orgId,
            },
            include: {
              allocations: {
                select: { amountSen: true },
              },
            },
          });

          const outstanding = invoices.reduce((total, invoice) => {
            const allocated = invoice.allocations.reduce(
              (sum, allocation) => sum + allocation.amountSen,
              BigInt(0),
            );

            const remaining = invoice.amountSen - allocated;
            return total + (remaining > BigInt(0) ? remaining : BigInt(0));
          }, BigInt(0));

          const otherPending = await tx.payment.aggregate({
            where: {
              leaseId: payment.leaseId,
              orgId: auth.orgId,
              status: "pending_verification",
              id: { not: payment.id },
            },
            _sum: { amountSen: true },
          });

          const otherPendingAmount = otherPending._sum.amountSen ?? BigInt(0);

          if (payment.amountSen > outstanding - otherPendingAmount) {
            throw new Error("PAYMENT_EXCEEDS_BALANCE");
          }

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "approved",
              unappliedSen: payment.amountSen,
            },
          });

          const orderedInvoices = invoices.sort((a, b) => {
            const dateDifference = a.dueDate.getTime() - b.dueDate.getTime();

            if (dateDifference !== 0) return dateDifference;
            if (a.kind !== b.kind) {
              return a.kind === "deposit" ? -1 : 1;
            }

            return (a.periodIndex ?? -1) - (b.periodIndex ?? -1);
          });

          let unapplied = payment.amountSen;

          for (const invoice of orderedInvoices) {
            if (unapplied <= BigInt(0)) break;

            const allocated = invoice.allocations.reduce(
              (sum, allocation) => sum + allocation.amountSen,
              BigInt(0),
            );

            const remaining = invoice.amountSen - allocated;
            if (remaining <= BigInt(0)) continue;

            const allocationAmount =
              unapplied < remaining ? unapplied : remaining;

            await tx.paymentAllocation.create({
              data: {
                orgId: auth.orgId,
                paymentId: payment.id,
                invoiceId: invoice.id,
                amountSen: allocationAmount,
              },
            });

            unapplied -= allocationAmount;
          }

          await tx.payment.update({
            where: { id: payment.id },
            data: { unappliedSen: unapplied },
          });
        }

        if (typedAction === "reject") {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "rejected",
              unappliedSen: payment.amountSen,
            },
          });
        }

        if (typedAction === "void") {
          await tx.paymentAllocation.deleteMany({
            where: {
              paymentId: payment.id,
              orgId: auth.orgId,
            },
          });

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "voided",
              unappliedSen: payment.amountSen,
            },
          });
        }

        const newStatus =
          typedAction === "approve"
            ? "approved"
            : typedAction === "reject"
              ? "rejected"
              : "voided";

        await tx.auditLog.create({
          data: {
            orgId: auth.orgId,
            actorId: auth.userId,
            action: `payment.${typedAction}`,
            entityId: payment.id,
            details: {
              reason: body.reason?.trim() ?? null,
              previousStatus: payment.status,
              newStatus,
            },
          },
        });

        return { status: newStatus };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "PAYMENT_NOT_FOUND") {
        return error("Payment not found", 404);
      }

      if (err.message === "PAYMENT_NOT_PENDING") {
        return error("Payment is not pending verification", 409);
      }

      if (err.message === "PAYMENT_NOT_APPROVED") {
        return error("Payment is not approved", 409);
      }

      if (err.message === "PAYMENT_EXCEEDS_BALANCE") {
        return error("Payment exceeds the remaining balance", 422);
      }
    }

    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2034"
    ) {
      return error("Concurrent update. Please retry.", 409);
    }

    console.error("Payment action error:", err);
    return error("Internal server error", 500);
  }
}
