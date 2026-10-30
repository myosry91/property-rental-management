# Property Rental Management System

A full-stack property rental management system built with Next.js, TypeScript, Supabase, and Prisma.

The application provides organization-based property management, lease administration, invoice generation, payment tracking, and collection reporting.

## Features

- Authentication with Supabase.
- Organization-based access control.
- Role-based permissions for managers, staff, and tenants.
- Property units and lease management.
- Automatic monthly invoice generation.
- Prorated final rent calculations.
- Payment recording and verification workflows.
- Payment allocation across outstanding invoices.
- Online payment gateway webhook integration.
- Idempotent payment webhook processing.
- Monthly collection reports.
- Audit logging.
- Database security using PostgreSQL Row Level Security (RLS).

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- Supabase (Authentication and PostgreSQL)
- Prisma ORM
- PostgreSQL
- Vitest

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/myosry91/property-rental-management.git
cd property-rental-management
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and provide the required values.

```bash
cp .env.example .env
```

Never commit your actual `.env` file or expose service-role keys.

### 4. Start local Supabase

```bash
npx supabase start
```

Configure the local Supabase credentials in `.env`.

### 5. Apply database migrations

```bash
npx supabase db reset
```

### 6. Generate Prisma Client

```bash
npx prisma generate
```

### 7. Seed the database

```bash
npx tsx scripts/seed.ts
```

### 8. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

Run the unit tests:

```bash
npx vitest run
```

Run TypeScript checks:

```bash
npx tsc --noEmit
```

Run database lint:

```bash
npx supabase db lint
```

Build for production:

```bash
npm run build
```

## Test Accounts

The seed script creates test users for the following roles:

- Manager: `manager@northwind.test`
- Staff: `staff@northwind.test`
- Tenant: `aisyah@northwind.test`
- Tenant: `ben@northwind.test`

The test password is configured through `SEED_PASSWORD`.

## Project Structure

```text
src/
  app/
    api/
    login/
  components/
  lib/
    supabase/
    billing.ts
    auth.ts
    prisma.ts

prisma/
  schema.prisma
  migrations/

supabase/
  migrations/

scripts/
  seed.ts
  verify-seed.ts
  test-webhook.ts
```

## Security Notes

- Keep secrets in environment variables.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- Enforce organization-level access control.
- Validate payment gateway signatures.
- Keep payment processing transactional and idempotent.
- Use private storage for payment slips.

## License

This project was developed as a property rental management assessment project.
