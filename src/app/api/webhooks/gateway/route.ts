import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function verifySignature(
  fields: Record<string, string>,
  receivedSignature: string,
  secret: string,
) {
  const payload = Object.keys(fields)
    .filter((key) => key !== "x_signature")
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join("|");

  const expected = createHmac("sha256", secret).update(payload).digest();

  let received: Buffer;

  try {
    received = Buffer.from(receivedSignature, "hex");
  } catch {
    return false;
  }

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.GATEWAY_X_SIGNATURE_KEY;

    if (!secret) {
      console.error("Gateway signature key is not configured");
      return error("Gateway configuration error", 500);
    }

    const formData = await request.formData();
    const fields: Record<string, string> = {};

    for (const [key, value] of formData.entries()) {
      if (typeof value !== "string") {
        return error("Invalid webhook field", 400);
      }

      if (fields[key] !== undefined) {
        return error("Duplicate webhook field", 400);
      }

      fields[key] = value;
    }

    const signature = fields.x_signature;

    if (
      !signature ||
      !/^[a-fA-F0-9]{64}$/.test(signature) ||
      !verifySignature(fields, signature, secret)
    ) {
      return error("Invalid signature", 401);
    }

    const billId = fields.id;
    const paid = fields.paid;
    const paidAmount = fields.paid_amount;
    const paidAt = fields.paid_at;

    if (
      !billId ||
      !["true", "false"].includes(paid) ||
      !/^\d+$/.test(paidAmount ?? "")
    ) {
      return error("Invalid webhook data", 400);
    }

    const amountSen = BigInt(paidAmount);

    const result = await prisma.$transaction(
      async (tx) => {
        const bill = await tx.gatewayBill.findUnique({
          where: { id: billId },
        });

        if (!bill) {
          throw new Error("BILL_NOT_FOUND");
        }

        // A paid bill must never create another payment.
        if (bill.status === "paid") {
          return { received: true, duplicate: true };
        }

        // A failed bill remains failed on repeated failure callbacks.
        if (paid === "false") {
          if (bill.status === "pending") {
            await tx.gatewayBill.update({
              where: { id: bill.id },
              data: { status: "failed" },
            });
          }

          return { received: true, duplicate: false };
        }

        if (amountSen !== bill.amountSen) {
          throw new Error("AMOUNT_MISMATCH");
        }

        if (!paidAt || !Number.isFinite(new Date(paidAt).getTime())) {
          throw new Error("INVALID_PAID_AT");
        }

        const receivedAt = new Date(paidAt);

        const invoices = await tx.invoice.findMany({
          where: {
            leaseId: bill.leaseId,
            orgId: bill.orgId,
          },
          include: {
            allocations: {
              select: { amountSen: true },
            },
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

        const payment = await tx.payment.create({
          data: {
            orgId: bill.orgId,
            leaseId: bill.leaseId,
            gatewayBillId: bill.id,
            amountSen,
            unappliedSen: amountSen,
            method: "online",
            status: "approved",
            receivedAt,
          },
        });

        let unapplied = amountSen;

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
              orgId: bill.orgId,
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

        await tx.gatewayBill.update({
          where: { id: bill.id },
          data: { status: "paid" },
        });

        await tx.auditLog.create({
          data: {
            orgId: bill.orgId,
            // System-generated webhook has no authenticated user.
            actorId: "00000000-0000-0000-0000-000000000000",
            action: "gateway.payment_received",
            entityId: payment.id,
            details: {
              gatewayBillId: bill.id,
              amountSen: Number(amountSen),
              transactionId: fields.transaction_id ?? null,
            },
          },
        });

        return { received: true, duplicate: false };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "BILL_NOT_FOUND") {
        return error("Gateway bill not found", 404);
      }

      if (err.message === "AMOUNT_MISMATCH") {
        return error("Paid amount does not match bill amount", 422);
      }

      if (err.message === "INVALID_PAID_AT") {
        return error("Invalid paid_at date", 400);
      }
    }

    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2034"
    ) {
      return error("Concurrent webhook. Retry later.", 409);
    }

    console.error("Gateway webhook processing error:", err);
    return error("Internal server error", 500);
  }
}
