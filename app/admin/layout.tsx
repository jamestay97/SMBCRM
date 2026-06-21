import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { createClient } from "@/lib/supabase/server";
import {
  isEmailAllowedBootstrap,
  isPlatformAdmin,
} from "@/lib/auth/platform";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/admin");
  }

  const admin = await isPlatformAdmin(user.id);
  if (!admin) {
    if (user.email && isEmailAllowedBootstrap(user.email)) {
      redirect("/setup-admin");
    }
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen">
      <AdminNav />
      <main className="flex-1 overflow-y-auto bg-slate-50 p-8">{children}</main>
    </div>
  );
}
