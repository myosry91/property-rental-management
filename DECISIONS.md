# Technical Decisions

## 1. Why use integer sen instead of floating-point Ringgit?

All monetary values are stored as integer sen to avoid floating-point precision errors. For example, MYR 10.50 is stored as 1050 sen. Input values are validated and converted before database operations.

## 2. How is organization isolation enforced?

The authenticated Supabase user is resolved through database membership records. API queries are scoped by the authenticated organization ID, and database Row Level Security provides an additional security boundary. Client-provided roles are never trusted.

## 3. How are monthly invoices generated?

Invoice generation uses the lease's original start date as the monthly anchor. Calendar dates are clamped when necessary, and partial final periods are prorated using integer arithmetic and half-up rounding.

## 4. How are payments allocated?

Approved payments are allocated to outstanding invoices in due-date order, with deposit invoices prioritized when due dates are equal. Any remaining amount is tracked as unapplied balance. Pending payments are not treated as collected payments.

## 5. How is webhook processing made safe?

The webhook verifies an HMAC SHA-256 signature using a timing-safe comparison. It validates the bill and exact payment amount, then updates the bill, creates the payment, allocates funds, and records an audit event in a database transaction. Duplicate successful callbacks do not create duplicate payments.
