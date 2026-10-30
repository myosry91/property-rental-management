# Code Review

## 1. Late Fee Calculation

Issues identified:
- Authorization must use the authenticated database membership, not user_metadata.role.
- Organization ownership must be verified before calculating fees.
- Date calculations must use the organization's timezone (Asia/Kuala_Lumpur).
- Monetary calculations should use integer sen or BigInt, avoiding floating-point tolerance checks.
- Invalid dates and unsupported statuses must be rejected.
- Reference generation must be concurrency-safe.
- Related database writes must run inside a transaction.

Recommended improvements:
- Centralize date and money calculations in tested utility functions.
- Validate all inputs at the API boundary.
- Use database transactions and appropriate isolation levels.

## 2. Gateway Webhook

Issues identified:
- Signature verification must use HMAC SHA-256 and timing-safe comparison.
- The signature must cover all fields except x_signature, sorted by key.
- Missing or invalid signatures must be rejected.
- The paid amount must exactly match the bill amount.
- Unknown bills must return 404.
- Failed or pending transactions must not create approved payments.
- Duplicate callbacks must be idempotent.
- Payment creation, bill status updates, allocations, and audit logging must be atomic.
- Sensitive secrets and complete webhook payloads must never be logged.

Recommended improvements:
- Validate transaction_status and paid_at.
- Handle concurrent callbacks safely.
- Keep gateway secrets in environment variables.

## 3. Collections Report

Issues identified:
- The endpoint must authenticate the user.
- Only manager and staff roles may access the report.
- Queries must be scoped to the authenticated organization.
- Month boundaries must use Asia/Kuala_Lumpur.
- The report must include months with zero collections.
- The date range must be validated and limited to 24 months.
- BigInt monetary values must be serialized safely.

## 4. Security and Data Integrity

- Enforce organization isolation through database constraints and Row Level Security.
- Never trust client-provided role or organization identifiers.
- Keep audit logs append-only.
- Validate payment amounts against outstanding balances.
- Use transactions for payment approval and allocation.
- Store payment slips in private organization-scoped storage paths.
