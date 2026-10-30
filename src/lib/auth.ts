import { prisma } from "./prisma";
import { createSupabaseServerClient } from "./supabase/server";


export async function getAuthContext() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  // Staff and managers are identified through memberships.
  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
    },
    include: {
      organization: true,
    },
  });

  if (membership) {
    return {
      user,
      userId: user.id,
      orgId: membership.orgId,
      organization: membership.organization,
      role: membership.role,
      tenantId: null,
    } as const;
  }

  // Tenants are identified through their tenant database record.
  const tenant = await prisma.tenant.findUnique({
    where: {
      userId: user.id,
    },
    include: {
      organization: true,
    },
  });

  if (tenant) {
    return {
      user,
      userId: user.id,
      orgId: tenant.orgId,
      organization: tenant.organization,
      role: "tenant" as const,
      tenantId: tenant.id,
    };
  }

  // Authenticated user without an application role.
  return null;
}
