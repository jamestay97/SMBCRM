import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getUserOrgMembership } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getUserOrgMembership();

  if (!membership) {
    redirect("/signup?onboard=1");
  }

  return <DashboardShell role={membership.role}>{children}</DashboardShell>;
}
