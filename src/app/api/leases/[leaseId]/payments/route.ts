import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth";

type PaymentMethod = "cash" | "bank_transfer";

type RequestBody = {
  amountSen?: number;
  method?: PaymentMethod;
  receivedAt?: string;
  slipPath?: string;
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  try {
    const auth = await getAuthContext();

    if (!auth) return error("Unauthorized", 401);

    if (auth.role !== "manager" && auth.role !== "staff") {
      return error("Forbidden", 403);
    }

    const { leaseId } = await params;

    let body: RequestBody;

    try {
      body = await request.json();
    } catch {
      return error("Invalid JSON body", 400);
    }

    if (!body || typeof body !== "object") {
      return error("Invalid request body", 400);
    }

    const { amountSen, method, receivedAt, slipPath } = body;

    if (
      typeof amountSen !== "number" ||
      !Number.isSafeInteger(amountSen) ||
      amountSen <= 0
    ) {
      return error("amountSen must be a positive integer", 400);
    }

    if (method !== "cash" && method !== "bank_transfer") {
      return error("Invalid payment method", 400);
    }

    if (
      receivedAt !== undefined &&
      (typeof receivedAt !== "string" ||
        !Number.isFinite(new Date(receivedAt).getTime()))
    ) {
      return error("Invalid receivedAt date", 400);
    }

    if (method === "bank_transfer") {
      if (
        typeof slipPath !== "string" ||
        !slipPath.startsWith(`${auth.orgId}/`)
      ) {
        return error("A valid bank transfer slip is required", 400);
      }
    }

    if (method === "cash" && slipPath) {
      return error("Cash payments must not include a slip", 400);
    }

    const amount = BigInt(amountSen);
    const paymentStatus =
      auth.role === "manager" ? "approved" : "pending_verification";

    const payment = await prisma.$transaction(
      async (tx) => {
        const lease = await tx.lease.findFirst({
          where: {
            id: leaseId,
            orgId: auth.orgId,
          },
          select: { id: true },
        });

        if (!lease) {
          throw new Error("LEASE_NOT_FOUND");
        }

        const invoices = await tx.invoice.findMany({
          where: {
            leaseId,
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

        const pendingPayments = await tx.payment.aggregate({
          where: {
            leaseId,
            orgId: auth.orgId,
            status: "pending_verification",
          },
          _sum: { amountSen: true },
        });

        const pendingAmount = pendingPayments._sum.amountSen ?? BigInt(0);
        const available = outstanding - pendingAmount;

        if (amount > available) {
          throw new Error("PAYMENT_EXCEEDS_BALANCE");
        }

        const created = await tx.payment.create({
          data: {
            orgId: auth.orgId,
            leaseId,
            amountSen: amount,
            unappliedSen: amount,
            method,
            status: paymentStatus,
            receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
            slipPath: method === "bank_transfer" ? slipPath! : null,
          },
        });

        let unapplied = amount;

        if (paymentStatus === "approved") {
          const orderedInvoices = invoices.sort((a, b) => {
            const dateDifference = a.dueDate.getTime() - b.dueDate.getTime();

            if (dateDifference !== 0) return dateDifference;
            if (a.kind !== b.kind) {
              return a.kind === "deposit" ? -1 : 1;
            }

            return (a.periodIndex ?? -1) - (b.periodIndex ?? -1);
          });

          for (const invoice of orderedInvoices) {
            if (unapplied <= BigInt(0)) break;

            const alreadyAllocated = invoice.allocations.reduce(
              (sum, allocation) => sum + allocation.amountSen,
              BigInt(0),
            );

            const remaining = invoice.amountSen - alreadyAllocated;
            if (remaining <= BigInt(0)) continue;

            const allocationAmount =
              unapplied < remaining ? unapplied : remaining;

            await tx.paymentAllocation.create({
              data: {
                orgId: auth.orgId,
                paymentId: created.id,
                invoiceId: invoice.id,
                amountSen: allocationAmount,
              },
            });

            unapplied -= allocationAmount;
          }

          await tx.payment.update({
            where: { id: created.id },
            data: { unappliedSen: unapplied },
          });
        }

        await tx.auditLog.create({
          data: {
            orgId: auth.orgId,
            actorId: auth.userId,
            action: "payment.created",
            entityId: created.id,
            details: {
              leaseId,
              amountSen,
              method,
              status: paymentStatus,
            },
          },
        });

        return {
          id: created.id,
          status: paymentStatus,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "LEASE_NOT_FOUND") {
        return error("Lease not found", 404);
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

    console.error("Create payment error:", err);
    return error("Internal server error", 500);
  }
}
