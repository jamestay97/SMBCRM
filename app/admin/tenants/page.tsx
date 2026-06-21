import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { TenantWithRelations } from "@/types/database";

export default async function AdminTenantsPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select(`*, tenant_subscriptions (*), tenant_phone_numbers (*)`)
    .order("created_at", { ascending: false });

  const tenants = (data ?? []) as TenantWithRelations[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tenants</h1>
          <p className="text-muted-foreground">All businesses on the platform.</p>
        </div>
        <Button asChild>
          <Link href="/admin/tenants/new">Onboard tenant</Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No tenants yet.
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((tenant) => {
                const sub = Array.isArray(tenant.tenant_subscriptions)
                  ? tenant.tenant_subscriptions[0]
                  : tenant.tenant_subscriptions;
                const primaryPhone =
                  tenant.tenant_phone_numbers?.find((p) => p.is_primary) ??
                  tenant.tenant_phone_numbers?.[0];

                return (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <Link
                        href={`/admin/tenants/${tenant.id}`}
                        className="font-medium hover:underline"
                      >
                        {tenant.business_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={tenant.status === "active" ? "success" : "warning"}>
                        {tenant.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{sub?.plan_id ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {primaryPhone?.phone_number ?? "—"}
                    </TableCell>
                    <TableCell>{formatDate(tenant.created_at)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
