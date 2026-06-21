import Link from "next/link";
import { redirect } from "next/navigation";
import { BootstrapAdminCard } from "@/components/admin/bootstrap-admin-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  isEmailAllowedBootstrap,
  isPlatformAdmin,
} from "@/lib/auth/platform";
import { createClient } from "@/lib/supabase/server";

export default async function SetupAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/setup-admin");
  }

  if (await isPlatformAdmin(user.id)) {
    redirect("/admin");
  }

  const emailAllowed = user.email
    ? isEmailAllowedBootstrap(user.email)
    : false;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Platform admin setup
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          One-time step after your email is added to{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            PLATFORM_ADMIN_EMAILS
          </code>{" "}
          in Vercel.
        </p>
      </div>

      {emailAllowed ? (
        <>
          <BootstrapAdminCard email={user.email ?? undefined} />
          <p className="text-center text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{user.email}</span>
          </p>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Email not allowlisted</CardTitle>
            <CardDescription>
              Your account is not in the platform admin allowlist yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Signed in as{" "}
              <span className="font-medium text-foreground">{user.email}</span>
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                In Vercel → Project → Settings → Environment Variables, set{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  PLATFORM_ADMIN_EMAILS
                </code>{" "}
                to your exact login email.
              </li>
              <li>Redeploy the app so the new value is picked up.</li>
              <li>Return here and click &quot;Become platform admin&quot;.</li>
            </ol>
            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
