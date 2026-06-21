import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isEmailAllowedBootstrap,
  isPlatformAdmin,
} from "@/lib/auth/platform";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isEmailAllowedBootstrap(user.email))) {
    return NextResponse.json(
      { error: "Email not in PLATFORM_ADMIN_EMAILS" },
      { status: 403 }
    );
  }

  if (await isPlatformAdmin(user.id)) {
    return NextResponse.json({ message: "Already a platform admin" });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("platform_admins").insert({
    user_id: user.id,
    role: "super_admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Platform admin granted" }, { status: 201 });
}
