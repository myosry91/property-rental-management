import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [
    organizations,
    memberships,
    units,
    tenants,
    leases,
    invoices,
    payments,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.membership.count(),
    prisma.unit.count(),
    prisma.tenant.count(),
    prisma.lease.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
  ]);

  console.table({
    organizations,
    memberships,
    units,
    tenants,
    leases,
    invoices,
    payments,
  });

  const lease = await prisma.lease.findUnique({
    where: {
      id: "30000000-0000-4000-8000-000000000001",
    },
    include: {
      invoices: {
        orderBy: [{ dueDate: "asc" }, { kind: "asc" }],
      },
      payments: {
        include: { allocations: true },
      },
    },
  });

  console.log("\nAisyah invoices:");
  console.table(
    lease?.invoices.map((invoice) => ({
      kind: invoice.kind,
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      amountSen: invoice.amountSen.toString(),
      periodIndex: invoice.periodIndex,
    })),
  );

  console.log("\nAisyah payments:");
  console.table(
    lease?.payments.map((payment) => ({
      method: payment.method,
      status: payment.status,
      amountSen: payment.amountSen.toString(),
      receivedAt: payment.receivedAt.toISOString(),
      allocations: payment.allocations.length,
    })),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
