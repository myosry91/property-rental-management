
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export default async function HomePage() {
  const auth = await getAuthContext();

  if (!auth) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between rounded-xl border bg-white p-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Rent Collection
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Welcome, {auth.user.email}
            </p>
          </div>

          <LogoutButton />
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border bg-white p-6">
            <p className="text-sm text-gray-500">Your role</p>
            <p className="mt-2 text-xl font-semibold capitalize">{auth.role}</p>
          </div>

          <div className="rounded-xl border bg-white p-6">
            <p className="text-sm text-gray-500">Organization</p>
            <p className="mt-2 text-xl font-semibold">
              {auth.organization.name}
            </p>
          </div>
        </section>

        {auth.role === "tenant" && (
          <section className="rounded-xl border bg-white p-6">
            <h2 className="font-semibold">Tenant Dashboard</h2>
            <p className="mt-2 text-sm text-gray-500">
              You can access your own leases and payments.
            </p>
          </section>
        )}

        {auth.role === "staff" && (
          <section className="rounded-xl border bg-white p-6">
            <h2 className="font-semibold">Staff Dashboard</h2>
            <p className="mt-2 text-sm text-gray-500">
              You can manage payment submissions and view organization data.
            </p>
          </section>
        )}

        {auth.role === "manager" && (
          <section className="rounded-xl border bg-white p-6">
            <h2 className="font-semibold">Manager Dashboard</h2>
            <p className="mt-2 text-sm text-gray-500">
              You can manage leases, payments, approvals and reports.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
