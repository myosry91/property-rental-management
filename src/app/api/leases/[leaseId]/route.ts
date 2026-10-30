import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invoiceStatus } from "@/lib/billing";

type RouteContext = {
  params: Promise<{ leaseId: string }>;
};

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const auth = await getAuthContext();

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leaseId } = await params;

    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        invoices: {
          include: {
            allocations: true,
          },
          orderBy: [
            { dueDate: "asc" },
            { kind: "asc" },
            { periodIndex: "asc" },
          ],
        },
        payments: {
          orderBy: { receivedAt: "desc" },
        },
      },
    });

    // A missing lease and a lease belonging to another organization
    // intentionally return the same response.
    if (!lease || lease.orgId !== auth.orgId) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }

    if (auth.role === "tenant" && lease.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }

    if (!["manager", "staff", "tenant"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const invoices = lease.invoices.map((invoice) => {
      const paidSen = invoice.allocations.reduce(
        (total, allocation) => total + allocation.amountSen,
        BigInt(0),
      );

      const amountSen = invoice.amountSen;

      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.periodIndex,
        periodStart: invoice.periodStart ? dateOnly(invoice.periodStart) : null,
        periodEnd: invoice.periodEnd ? dateOnly(invoice.periodEnd) : null,
        dueDate: dateOnly(invoice.dueDate),
        amountSen: Number(amountSen),
        paidSen: Number(paidSen),
        status: invoiceStatus(
          {
            dueDate: dateOnly(invoice.dueDate),
            amountSen: Number(amountSen),
            paidSen: Number(paidSen),
          },
          new Date(),
        ),
      };
    });

    const payments = lease.payments.map((payment) => ({
      id: payment.id,
      amountSen: Number(payment.amountSen),
      unappliedSen: Number(payment.unappliedSen),
      method: payment.method,
      status: payment.status,
      receivedAt: payment.receivedAt.toISOString(),
    }));

    return NextResponse.json({
      lease: {
        id: lease.id,
        unitId: lease.unitId,
        tenantId: lease.tenantId,
        startDate: dateOnly(lease.startDate),
        endDate: dateOnly(lease.endDate),
        monthlyRentSen: Number(lease.monthlyRentSen),
        depositSen: Number(lease.depositSen),
      },
      invoices,
      payments,
    });
  } catch (error) {
    console.error("GET lease error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
