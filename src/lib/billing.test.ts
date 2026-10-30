import { describe, expect, it } from "vitest";
import { generateSchedule, invoiceStatus, parseRinggitToSen } from "./billing";

describe("generateSchedule", () => {
  it("generates the correct prorated final invoice for Aisyah", () => {
    const invoices = generateSchedule({
      startDate: "2026-01-31",
      endDate: "2026-07-15",
      monthlyRentSen: 150000,
      depositSen: 300000,
    });

    // expect(invoices).toHaveLength(8);
    expect(invoices).toHaveLength(7);
    expect(invoices[0]).toMatchObject({
      kind: "deposit",
      dueDate: "2026-01-31",
      amountSen: 300000,
    });

    expect(invoices.at(-1)).toMatchObject({
      kind: "rent",
      //   periodIndex: 6,
      periodIndex: 5,
      periodStart: "2026-06-30",
      periodEnd: "2026-07-15",
      amountSen: 77419,
    });
  });

  it("anchors monthly periods to the original start date", () => {
    const invoices = generateSchedule({
      startDate: "2026-01-31",
      endDate: "2026-04-30",
      monthlyRentSen: 100000,
      depositSen: 0,
    });

    expect(invoices.map((invoice) => invoice.periodStart)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("rejects invalid dates and invalid rent", () => {
    expect(() =>
      generateSchedule({
        startDate: "2026-02-30",
        endDate: "2026-07-15",
        monthlyRentSen: 150000,
        depositSen: 0,
      }),
    ).toThrow();

    expect(() =>
      generateSchedule({
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        monthlyRentSen: 0,
        depositSen: 0,
      }),
    ).toThrow();
  });
});

describe("invoiceStatus", () => {
  it("marks an invoice overdue using Malaysia calendar date", () => {
    expect(
      invoiceStatus(
        {
          dueDate: "2026-03-01",
          amountSen: 10000,
          paidSen: 0,
        },
        new Date("2026-03-01T16:00:00.000Z"),
      ),
    ).toBe("overdue");
  });

  it("prioritizes fully paid invoices", () => {
    expect(
      invoiceStatus(
        {
          dueDate: "2026-01-01",
          amountSen: 10000,
          paidSen: 10000,
        },
        new Date("2026-03-01T00:00:00.000Z"),
      ),
    ).toBe("paid");
  });
});

describe("parseRinggitToSen", () => {
  it.each([
    ["1,500.50", 150050],
    ["1.15", 115],
    ["7", 700],
    [" 10.5 ", 1050],
  ])("parses %s into sen", (input, expected) => {
    expect(parseRinggitToSen(input)).toBe(expected);
  });

  it.each(["", "-5", "1.234", "1e3", "RM 10", "1,23"])(
    "rejects invalid amount %s",
    (input) => {
      expect(() => parseRinggitToSen(input)).toThrow();
    },
  );
});
