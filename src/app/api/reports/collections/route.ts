import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isValidMonth(value: string | null): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthDate(month: string) {
  return new Date(`${month}-01T00:00:00+08:00`);
}

function nextMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  let current = from;

  while (current <= to) {
    months.push(current);
    current = nextMonth(current);
  }

  return months;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext();

    if (!auth) return error("Unauthorized", 401);

    if (auth.role !== "manager" && auth.role !== "staff") {
      return error("Forbidden", 403);
    }

    const searchParams = request.nextUrl.searchParams;
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!isValidMonth(from) || !isValidMonth(to) || from > to) {
      return error("Invalid from/to month. Use YYYY-MM.", 400);
    }

    const months = monthsBetween(from, to);

    if (months.length > 24) {
      return error("Maximum report range is 24 months", 400);
    }

    const startDate = monthDate(from);
    const endDate = monthDate(nextMonth(to));

    const payments = await prisma.payment.findMany({
      where: {
        orgId: auth.orgId,
        status: "approved",
        receivedAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      select: {
        amountSen: true,
        receivedAt: true,
      },
    });

    const totals = new Map<string, bigint>();

    for (const month of months) {
      totals.set(month, BigInt(0));
    }

    for (const payment of payments) {
      // Convert UTC timestamp to Malaysia time (UTC+8).
      const malaysiaDate = new Date(
        payment.receivedAt.getTime() + 8 * 60 * 60 * 1000,
      );

      const month = `${malaysiaDate.getUTCFullYear()}-${String(
        malaysiaDate.getUTCMonth() + 1,
      ).padStart(2, "0")}`;

      totals.set(month, (totals.get(month) ?? BigInt(0)) + payment.amountSen);
    }

    return NextResponse.json({
      currency: "MYR",
      timezone: "Asia/Kuala_Lumpur",
      months: months.map((month) => ({
        month,
        totalSen: Number(totals.get(month) ?? BigInt(0)),
      })),
    });
  } catch (err) {
    console.error("Collections report error:", err);
    return error("Internal server error", 500);
  }
}
