export type InvoiceKind = "deposit" | "rent";

export type ScheduledInvoice = {
  kind: InvoiceKind;
  periodIndex: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  amountSen: number;
};

export type InvoiceStatus = "paid" | "overdue" | "partially_paid" | "unpaid";

type LeaseScheduleInput = {
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
};

type InvoiceStatusInput = {
  dueDate: string;
  amountSen: number;
  paidSen: number;
};

const DAY_MS = 86_400_000;
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1_000;

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must use YYYY-MM-DD format");
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Invalid calendar date");
  }

  return timestamp;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function addMonthsFromAnchor(startDate: string, monthOffset: number): string {
  const [year, month, day] = startDate.split("-").map(Number);
  const absoluteMonth = year * 12 + month - 1 + monthOffset;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth - targetYear * 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return formatDate(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const two = BigInt(2);
  return (numerator * two + denominator) / (two * denominator);
}

export function generateSchedule(
  lease: LeaseScheduleInput,
): ScheduledInvoice[] {
  const start = parseDate(lease.startDate);
  const end = parseDate(lease.endDate);

  if (end < start) {
    throw new Error("Lease end date must not precede start date");
  }

  if (
    !Number.isSafeInteger(lease.monthlyRentSen) ||
    lease.monthlyRentSen <= 0
  ) {
    throw new Error("Monthly rent must be a positive safe integer");
  }

  if (!Number.isSafeInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error("Deposit must be a non-negative safe integer");
  }

  const invoices: ScheduledInvoice[] = [];

  if (lease.depositSen > 0) {
    invoices.push({
      kind: "deposit",
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: lease.startDate,
      amountSen: lease.depositSen,
    });
  }

  for (let index = 0; ; index++) {
    const periodStart = addMonthsFromAnchor(lease.startDate, index);
    const periodStartMs = parseDate(periodStart);

    if (periodStartMs > end) break;

    const nextAnchor = addMonthsFromAnchor(lease.startDate, index + 1);
    const nextAnchorMs = parseDate(nextAnchor);
    const fullPeriodDays = (nextAnchorMs - periodStartMs) / DAY_MS;
    const periodEndMs = Math.min(nextAnchorMs - DAY_MS, end);
    const usedDays = (periodEndMs - periodStartMs) / DAY_MS + 1;

    const fullRent = BigInt(lease.monthlyRentSen);
    const amount =
      usedDays === fullPeriodDays
        ? fullRent
        : roundHalfUp(fullRent * BigInt(usedDays), BigInt(fullPeriodDays));

    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Invoice amount exceeds safe integer range");
    }

    invoices.push({
      kind: "rent",
      periodIndex: index,
      periodStart,
      periodEnd: formatDate(periodEndMs),
      dueDate: periodStart,
      amountSen: Number(amount),
    });
  }

  return invoices;
}

export function invoiceStatus(
  invoice: InvoiceStatusInput,
  now: Date,
): InvoiceStatus {
  parseDate(invoice.dueDate);

  if (
    !Number.isSafeInteger(invoice.amountSen) ||
    invoice.amountSen < 0 ||
    !Number.isSafeInteger(invoice.paidSen) ||
    invoice.paidSen < 0 ||
    Number.isNaN(now.getTime())
  ) {
    throw new Error("Invalid invoice status input");
  }

  if (invoice.paidSen >= invoice.amountSen) return "paid";

  const malaysiaToday = formatDate(
    Date.UTC(
      new Date(now.getTime() + MALAYSIA_OFFSET_MS).getUTCFullYear(),
      new Date(now.getTime() + MALAYSIA_OFFSET_MS).getUTCMonth(),
      new Date(now.getTime() + MALAYSIA_OFFSET_MS).getUTCDate(),
    ),
  );

  if (malaysiaToday > invoice.dueDate) return "overdue";
  if (invoice.paidSen > 0) return "partially_paid";

  return "unpaid";
}

export function parseRinggitToSen(input: string): number {
  const value = input.trim();

  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Invalid Ringgit amount");
  }

  const normalized = value.replace(/,/g, "");
  const [whole, fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));

  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount exceeds safe integer range");
  }

  return Number(amount);
}
