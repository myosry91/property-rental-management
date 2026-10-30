import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { generateSchedule } from "../src/lib/billing";
import { createHash } from "node:crypto";

function createInvoiceId(
  leaseId: string,
  kind: string,
  periodIndex: number | null,
): string {
  const hash = createHash("sha256")
    .update(`${leaseId}:${kind}:${periodIndex ?? "deposit"}`)
    .digest("hex")
    .slice(0, 32);

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

const prisma = new PrismaClient();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const seedPassword = process.env.SEED_PASSWORD;

if (!supabaseUrl || !serviceRoleKey || !seedPassword) {
  throw new Error(
    "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SEED_PASSWORD in .env",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const ids = {
  northwind: "00000000-0000-4000-8000-000000000001",
  beta: "00000000-0000-4000-8000-000000000002",

  units: {
    aisyah: "10000000-0000-4000-8000-000000000001",
    ben: "10000000-0000-4000-8000-000000000002",
    probe: "10000000-0000-4000-8000-000000000003",
    empty: "10000000-0000-4000-8000-000000000004",
    chen: "10000000-0000-4000-8000-000000000005",
  },

  tenants: {
    aisyah: "20000000-0000-4000-8000-000000000001",
    ben: "20000000-0000-4000-8000-000000000002",
    probe: "20000000-0000-4000-8000-000000000003",
    chen: "20000000-0000-4000-8000-000000000004",
  },

  leases: {
    aisyah: "30000000-0000-4000-8000-000000000001",
    ben: "30000000-0000-4000-8000-000000000002",
    probe: "30000000-0000-4000-8000-000000000003",
    chen: "30000000-0000-4000-8000-000000000004",
  },

  payments: {
    aisyahCash: "40000000-0000-4000-8000-000000000001",
    aisyahBank: "40000000-0000-4000-8000-000000000002",
  },
};

const accounts = [
  { email: "manager@northwind.test", name: "Northwind Manager" },
  { email: "staff@northwind.test", name: "Northwind Staff" },
  { email: "aisyah@northwind.test", name: "Aisyah Rahman" },
  { email: "ben@northwind.test", name: "Ben Lim" },
  { email: "probe@northwind.test", name: "Probe Tenant" },
  { email: "manager@beta.test", name: "Beta Manager" },
  { email: "chen@beta.test", name: "Chen Wei" },
];

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// Convert Malaysia local time (UTC+8) into a UTC instant.
function malaysiaTime(value: string): Date {
  return new Date(`${value}+08:00`);
}

async function getOrCreateAuthUser(email: string, name: string) {
  const { data: listData, error: listError } =
    await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  if (listError) throw listError;

  const existing = listData.users.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(
      existing.id,
      {
        password: seedPassword,
        email_confirm: true,
        user_metadata: { full_name: name },
      },
    );

    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: seedPassword,
    email_confirm: true,
    user_metadata: { full_name: name },
  });

  if (error) throw error;
  return data.user;
}

async function main() {
  console.log("Creating Supabase Auth users...");

  const users: Record<string, string> = {};

  for (const account of accounts) {
    const user = await getOrCreateAuthUser(account.email, account.name);
    if (!user) throw new Error(`Could not create ${account.email}`);
    users[account.email] = user.id;
    console.log(`  Auth user ready: ${account.email}`);
  }

  console.log("Creating organizations...");

  await prisma.organization.upsert({
    where: { id: ids.northwind },
    update: { name: "Northwind Properties" },
    create: { id: ids.northwind, name: "Northwind Properties" },
  });

  await prisma.organization.upsert({
    where: { id: ids.beta },
    update: { name: "Beta Realty" },
    create: { id: ids.beta, name: "Beta Realty" },
  });

  console.log("Creating memberships...");

  const memberships = [
    {
      userId: users["manager@northwind.test"],
      orgId: ids.northwind,
      role: "manager" as const,
    },
    {
      userId: users["staff@northwind.test"],
      orgId: ids.northwind,
      role: "staff" as const,
    },
    {
      userId: users["manager@beta.test"],
      orgId: ids.beta,
      role: "manager" as const,
    },
  ];

  for (const membership of memberships) {
    await prisma.membership.upsert({
      where: {
        userId_orgId: {
          userId: membership.userId,
          orgId: membership.orgId,
        },
      },
      update: { role: membership.role },
      create: membership,
    });
  }

  console.log("Creating units...");

  const units = [
    { id: ids.units.aisyah, orgId: ids.northwind, name: "A-12-3" },
    { id: ids.units.ben, orgId: ids.northwind, name: "B-05-1" },
    { id: ids.units.probe, orgId: ids.northwind, name: "C-01-7" },
    { id: ids.units.empty, orgId: ids.northwind, name: "D-03-2" },
    { id: ids.units.chen, orgId: ids.beta, name: "KL-1" },
  ];

  for (const unit of units) {
    await prisma.unit.upsert({
      where: {
        orgId_name: { orgId: unit.orgId, name: unit.name },
      },
      update: {},
      create: unit,
    });
  }

  console.log("Creating tenants...");

  const tenants = [
    {
      id: ids.tenants.aisyah,
      orgId: ids.northwind,
      userId: users["aisyah@northwind.test"],
      fullName: "Aisyah Rahman",
      email: "aisyah@northwind.test",
      phone: null,
    },
    {
      id: ids.tenants.ben,
      orgId: ids.northwind,
      userId: users["ben@northwind.test"],
      fullName: "Ben Lim",
      email: "ben@northwind.test",
      phone: null,
    },
    {
      id: ids.tenants.probe,
      orgId: ids.northwind,
      userId: users["probe@northwind.test"],
      fullName: "Probe Tenant",
      email: "probe@northwind.test",
      phone: null,
    },
    {
      id: ids.tenants.chen,
      orgId: ids.beta,
      userId: users["chen@beta.test"],
      fullName: "Chen Wei",
      email: "chen@beta.test",
      phone: null,
    },
  ];

  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: {
        orgId: tenant.orgId,
        userId: tenant.userId,
        fullName: tenant.fullName,
        email: tenant.email,
      },
      create: tenant,
    });
  }

  console.log("Creating leases and invoices...");

  const leaseDefinitions = [
    {
      id: ids.leases.aisyah,
      orgId: ids.northwind,
      unitId: ids.units.aisyah,
      tenantId: ids.tenants.aisyah,
      startDate: "2026-01-31",
      endDate: "2026-07-15",
      monthlyRentSen: 150000,
      depositSen: 300000,
    },
    {
      id: ids.leases.ben,
      orgId: ids.northwind,
      unitId: ids.units.ben,
      tenantId: ids.tenants.ben,
      startDate: "2026-01-01",
      endDate: "2026-04-15",
      monthlyRentSen: 100029,
      depositSen: 0,
    },
    {
      id: ids.leases.probe,
      orgId: ids.northwind,
      unitId: ids.units.probe,
      tenantId: ids.tenants.probe,
      startDate: "2026-02-28",
      endDate: "2027-02-27",
      monthlyRentSen: 200000,
      depositSen: 400000,
    },
    {
      id: ids.leases.chen,
      orgId: ids.beta,
      unitId: ids.units.chen,
      tenantId: ids.tenants.chen,
      startDate: "2026-03-15",
      endDate: "2027-03-14",
      monthlyRentSen: 220000,
      depositSen: 440000,
    },
  ];

  for (const definition of leaseDefinitions) {
    const lease = await prisma.lease.upsert({
      where: { id: definition.id },
      update: {},
      create: {
        id: definition.id,
        orgId: definition.orgId,
        unitId: definition.unitId,
        tenantId: definition.tenantId,
        startDate: date(definition.startDate),
        endDate: date(definition.endDate),
        monthlyRentSen: BigInt(definition.monthlyRentSen),
        depositSen: BigInt(definition.depositSen),
      },
    });

    const schedule = generateSchedule({
      startDate: definition.startDate,
      endDate: definition.endDate,
      monthlyRentSen: definition.monthlyRentSen,
      depositSen: definition.depositSen,
    });

    for (const item of schedule) {
      //   const invoiceId =
      //     item.kind === "deposit"
      //       ? `${lease.id.slice(0, 8)}-0000-4000-8000-000000000001`
      //       : `${lease.id.slice(0, 8)}-${String(item.periodIndex ?? 0).padStart(
      //           4,
      //           "0",
      //         )}-4000-8000-000000000001`;
    //   const sequence = item.kind === "deposit" ? 9999 : (item.periodIndex ?? 0);

      // const invoiceId = `${lease.id.slice(0, 8)}-${String(sequence).padStart(4, "0")}-4000-8000-000000000001`;
      const invoiceId = createInvoiceId(lease.id, item.kind, item.periodIndex);
      await prisma.invoice.upsert({
        where: { id: invoiceId },
        update: {
          amountSen: BigInt(item.amountSen),
          dueDate: date(item.dueDate),
        },
        create: {
          id: invoiceId,
          orgId: definition.orgId,
          leaseId: lease.id,
          kind: item.kind,
          periodIndex: item.periodIndex,
          periodStart: item.periodStart ? date(item.periodStart) : null,
          periodEnd: item.periodEnd ? date(item.periodEnd) : null,
          dueDate: date(item.dueDate),
          amountSen: BigInt(item.amountSen),
        },
      });
    }
  }

  console.log("Creating Aisyah's payments...");

  const aisyahInvoices = await prisma.invoice.findMany({
    where: { leaseId: ids.leases.aisyah },
    orderBy: [{ dueDate: "asc" }, { kind: "asc" }, { periodIndex: "asc" }],
  });

  const depositInvoice = aisyahInvoices.find(
    (invoice) => invoice.kind === "deposit",
  );

  const rentInvoices = aisyahInvoices
    .filter((invoice) => invoice.kind === "rent")
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  if (!depositInvoice || rentInvoices.length === 0) {
    throw new Error("Aisyah's invoices were not generated correctly.");
  }

  await prisma.payment.upsert({
    where: { id: ids.payments.aisyahCash },
    update: {},
    create: {
      id: ids.payments.aisyahCash,
      orgId: ids.northwind,
      leaseId: ids.leases.aisyah,
      amountSen: BigInt(300000),
      unappliedSen: BigInt(0),
      method: "cash",
      status: "approved",
      receivedAt: malaysiaTime("2026-01-31T10:00:00"),
      allocations: {
        create: {
          orgId: ids.northwind,
          invoiceId: depositInvoice.id,
          amountSen: BigInt(300000),
        },
      },
    },
  });

  await prisma.payment.upsert({
    where: { id: ids.payments.aisyahBank },
    update: {},
    create: {
      id: ids.payments.aisyahBank,
      orgId: ids.northwind,
      leaseId: ids.leases.aisyah,
      amountSen: BigInt(200000),
      unappliedSen: BigInt(0),
      method: "bank_transfer",
      status: "approved",
      receivedAt: malaysiaTime("2026-03-01T00:30:00"),
      slipPath: null,
      allocations: {
        create: [
          {
            orgId: ids.northwind,
            invoiceId: rentInvoices[0].id,
            amountSen: BigInt(150000),
          },
          {
            orgId: ids.northwind,
            invoiceId: rentInvoices[1].id,
            amountSen: BigInt(50000),
          },
        ],
      },
    },
  });

  console.log("Seed completed successfully.");
  console.log(`Shared test password: ${seedPassword}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
