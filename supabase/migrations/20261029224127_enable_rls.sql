
-- Helper functions use the authenticated user's database identity.
-- SECURITY DEFINER avoids recursive RLS evaluation on memberships.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_org_member(target_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.org_id = target_org
      AND m.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.has_org_role(
  target_org uuid,
  allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.org_id = target_org
      AND m.user_id = (SELECT auth.uid())
      AND m.role::text = ANY(allowed_roles)
  );
$$;

CREATE OR REPLACE FUNCTION private.is_org_tenant(
  target_org uuid,
  target_tenant uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.org_id = target_org
      AND t.user_id = (SELECT auth.uid())
      AND (target_tenant IS NULL OR t.id = target_tenant)
  );
$$;

REVOKE ALL ON FUNCTION private.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_org_role(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_org_tenant(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_org_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_org_tenant(uuid, uuid) TO authenticated;

-- Enable RLS on all application tables.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Organizations.
CREATE POLICY organizations_read_member
ON public.organizations FOR SELECT TO authenticated
USING (private.is_org_member(id));

-- Memberships: members can read memberships within their own organization.
CREATE POLICY memberships_read_member
ON public.memberships FOR SELECT TO authenticated
USING (private.is_org_member(org_id));

-- Units: staff/managers can read all org units; tenants only units
-- belonging to their own leases.
CREATE POLICY units_read_org_staff
ON public.units FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager', 'staff']));

CREATE POLICY units_read_tenant_lease
ON public.units FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.leases l
    JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.unit_id = units.id
      AND t.user_id = (SELECT auth.uid())
      AND t.org_id = units.org_id
  )
);

-- Tenants: tenants may read their own row and update their phone only.
CREATE POLICY tenants_read_self
ON public.tenants FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY tenants_read_org_staff
ON public.tenants FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager', 'staff']));

CREATE POLICY tenants_update_self
ON public.tenants FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

-- Leases.
CREATE POLICY leases_read_org_staff
ON public.leases FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager', 'staff']));

CREATE POLICY leases_read_tenant
ON public.leases FOR SELECT TO authenticated
USING (private.is_org_tenant(org_id, tenant_id));

-- Invoices.
CREATE POLICY invoices_read_org_staff
ON public.invoices FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager', 'staff']));

CREATE POLICY invoices_read_tenant
ON public.invoices FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.leases l
    WHERE l.id = invoices.lease_id
      AND private.is_org_tenant(l.org_id, l.tenant_id)
  )
);

-- Payments.
CREATE POLICY payments_read_org_staff
ON public.payments FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager', 'staff']));

CREATE POLICY payments_read_tenant
ON public.payments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.leases l
    WHERE l.id = payments.lease_id
      AND private.is_org_tenant(l.org_id, l.tenant_id)
  )
);

-- Allocations.
CREATE POLICY allocations_read_org_staff
ON public.payment_allocations FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager', 'staff']));

CREATE POLICY allocations_read_tenant
ON public.payment_allocations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.invoices i
    JOIN public.leases l ON l.id = i.lease_id
    WHERE i.id = payment_allocations.invoice_id
      AND private.is_org_tenant(l.org_id, l.tenant_id)
  )
);

-- Gateway bills.
CREATE POLICY gateway_bills_read_org_staff
ON public.gateway_bills FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager', 'staff']));

CREATE POLICY gateway_bills_read_tenant
ON public.gateway_bills FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.leases l
    WHERE l.id = gateway_bills.lease_id
      AND private.is_org_tenant(l.org_id, l.tenant_id)
  )
);

-- Audit logs: managers only, read-only through the Data API.
CREATE POLICY audit_log_read_manager
ON public.audit_log FOR SELECT TO authenticated
USING (private.has_org_role(org_id, ARRAY['manager']));

-- Remove direct writes through Supabase's Data API.
-- All writes must go through trusted server-side application code.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON public.organizations,
   public.memberships,
   public.units,
   public.tenants,
   public.leases,
   public.invoices,
   public.payments,
   public.payment_allocations,
   public.gateway_bills,
   public.audit_log
FROM anon, authenticated;

-- Allow tenants to update only their phone through the Data API.
GRANT UPDATE (phone) ON public.tenants TO authenticated;
