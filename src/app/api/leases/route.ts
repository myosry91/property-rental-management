import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSchedule } from "@/lib/billing";

type CreateLeaseBody = {
  unitId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
};

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isValidAmount(value: unknown, allowZero: boolean): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (allowZero ? value >= 0 : value > 0)
  );
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext();

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (auth.role !== "manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: CreateLeaseBody;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen } =
      body;

    if (
      typeof unitId !== "string" ||
      typeof tenantId !== "string" ||
      !isValidDate(startDate) ||
      !isValidDate(endDate) ||
      endDate < startDate ||
      !isValidAmount(monthlyRentSen, false) ||
      !isValidAmount(depositSen, true)
    ) {
      return NextResponse.json(
        { error: "Invalid lease data" },
        { status: 400 },
      );
    }

    // Both records must belong to the manager's organization.
    const [unit, tenant] = await Promise.all([
      prisma.unit.findFirst({
        where: {
          id: unitId,
          orgId: auth.orgId,
        },
      }),
      prisma.tenant.findFirst({
        where: {
          id: tenantId,
          orgId: auth.orgId,
        },
      }),
    ]);

    if (!unit || !tenant) {
      return NextResponse.json(
        { error: "Unit or tenant not found" },
        { status: 404 },
      );
    }

    const schedule = generateSchedule({
      startDate,
      endDate,
      monthlyRentSen,
      depositSen,
    });

    const lease = await prisma.$transaction(async (tx) => {
      // Inclusive overlap: existing.start <= new.end
      // and existing.end >= new.start.
      const overlappingLease = await tx.lease.findFirst({
        where: {
          orgId: auth.orgId,
          unitId,
          startDate: { lte: new Date(`${endDate}T00:00:00.000Z`) },
          endDate: { gte: new Date(`${startDate}T00:00:00.000Z`) },
        },
        select: { id: true },
      });

      if (overlappingLease) {
        throw new Error("LEASE_OVERLAP");
      }

      const createdLease = await tx.lease.create({
        data: {
          orgId: auth.orgId,
          unitId,
          tenantId,
          startDate: new Date(`${startDate}T00:00:00.000Z`),
          endDate: new Date(`${endDate}T00:00:00.000Z`),
          monthlyRentSen: BigInt(monthlyRentSen),
          depositSen: BigInt(depositSen),
        },
      });

      await tx.invoice.createMany({
        data: schedule.map((item) => ({
          orgId: auth.orgId,
          leaseId: createdLease.id,
          kind: item.kind,
          periodIndex: item.periodIndex,
          periodStart: item.periodStart
            ? new Date(`${item.periodStart}T00:00:00.000Z`)
            : null,
          periodEnd: item.periodEnd
            ? new Date(`${item.periodEnd}T00:00:00.000Z`)
            : null,
          dueDate: new Date(`${item.dueDate}T00:00:00.000Z`),
          amountSen: BigInt(item.amountSen),
        })),
      });

      await tx.auditLog.create({
        data: {
          orgId: auth.orgId,
          actorId: auth.userId,
          action: "lease.created",
          entityId: createdLease.id,
          details: {
            unitId,
            tenantId,
            startDate,
            endDate,
            monthlyRentSen,
            depositSen,
          },
        },
      });

      return createdLease;
    });

    return NextResponse.json({ id: lease.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "LEASE_OVERLAP") {
      return NextResponse.json(
        { error: "This unit already has a lease during the selected dates" },
        { status: 409 },
      );
    }

    // PostgreSQL exclusion/unique constraints can also reject
    // concurrent overlapping lease creations.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2004" || error.code === "P2002")
    ) {
      return NextResponse.json(
        { error: "Lease conflicts with an existing record" },
        { status: 409 },
      );
    }

    console.error("POST lease error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
