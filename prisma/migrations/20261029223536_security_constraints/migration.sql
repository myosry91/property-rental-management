
-- Prevent negative monetary values.
ALTER TABLE public.leases
  ADD CONSTRAINT leases_monthly_rent_positive
    CHECK (monthly_rent_sen > 0),
  ADD CONSTRAINT leases_deposit_nonnegative
    CHECK (deposit_sen >= 0),
  ADD CONSTRAINT leases_valid_dates
    CHECK (end_date >= start_date);

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_amount_nonnegative
    CHECK (amount_sen >= 0),
  ADD CONSTRAINT invoices_valid_period
    CHECK (
      period_start IS NULL
      OR period_end IS NULL
      OR period_end >= period_start
    );

ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_positive
    CHECK (amount_sen > 0),
  ADD CONSTRAINT payments_unapplied_nonnegative
    CHECK (unapplied_sen >= 0);

ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_amount_positive
    CHECK (amount_sen > 0);

ALTER TABLE public.gateway_bills
  ADD CONSTRAINT gateway_bills_amount_positive
    CHECK (amount_sen > 0);

-- Prevent overlapping lease periods for the same unit.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_no_overlapping_dates
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );

-- Make audit records append-only.
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records cannot be updated or deleted';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_log_mutation();
