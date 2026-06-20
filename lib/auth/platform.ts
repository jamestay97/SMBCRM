import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data);
}

export async function requirePlatformAdmin(): Promise<{
  userId: string;
  email: string | undefined;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHORIZED");
  }

  const admin = await isPlatformAdmin(user.id);
  if (!admin) {
    throw new Error("FORBIDDEN");
  }

  return { userId: user.id, email: user.email };
}

export function isEmailAllowedBootstrap(email: string): boolean {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(email.toLowerCase());
}
