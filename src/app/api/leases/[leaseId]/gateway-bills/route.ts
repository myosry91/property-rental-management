import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function malaysiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((part) => part.type === type)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  try {
    const auth = await getAuthContext();

    if (!auth) return error("Unauthorized", 401);

    if (auth.role !== "tenant" || !auth.tenantId) {
      return error("Forbidden", 403);
    }

    const { leaseId } = await params;
    const today = malaysiaToday();
    const todayDate = new Date(`${today}T00:00:00.000Z`);

    const result = await prisma.$transaction(async (tx) => {
      const lease = await tx.lease.findFirst({
        where: {
          id: leaseId,
          orgId: auth.orgId,
          tenantId: auth.tenantId,
        },
        select: { id: true },
      });

      if (!lease) throw new Error("LEASE_NOT_FOUND");

      const invoices = await tx.invoice.findMany({
        where: {
          leaseId,
          orgId: auth.orgId,
          dueDate: { lte: todayDate },
        },
        include: {
          allocations: {
            select: { amountSen: true },
          },
        },
        orderBy: [{ dueDate: "asc" }, { kind: "asc" }],
      });

      const amountSen = invoices.reduce((total, invoice) => {
        const allocated = invoice.allocations.reduce(
          (sum, allocation) => sum + allocation.amountSen,
          BigInt(0),
        );

        const remaining = invoice.amountSen - allocated;
        return total + (remaining > BigInt(0) ? remaining : BigInt(0));
      }, BigInt(0));

      if (amountSen <= BigInt(0)) {
        throw new Error("NOTHING_DUE");
      }

      const bill = await tx.gatewayBill.create({
        data: {
          orgId: auth.orgId,
          leaseId,
          amountSen,
          status: "pending",
        },
      });

      return {
        billId: bill.id,
        amountSen: Number(bill.amountSen),
        currency: "MYR",
        timezone: "Asia/Kuala_Lumpur",
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "LEASE_NOT_FOUND") {
        return error("Lease not found", 404);
      }

      if (err.message === "NOTHING_DUE") {
        return error("There are no outstanding invoices due today", 422);
      }
    }

    console.error("Create gateway bill error:", err);
    return error("Internal server error", 500);
  }
}
