"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Calendar, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  UnreadNavBadge,
  useUnreadMessages,
} from "@/components/dashboard/unread-messages-provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/leads", label: "Leads", icon: Users, showUnread: true },
  { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { summary } = useUnreadMessages();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-full shrink-0 flex-col border-b bg-slate-50 md:h-dvh md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 px-4 py-4 md:px-6 md:py-5">
        <Bot className="h-6 w-6 shrink-0 text-primary" />
        <span className="font-semibold">AI Sales Rep</span>
        {summary.total > 0 && (
          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white md:hidden">
            {summary.total > 99 ? "99+" : summary.total}
          </span>
        )}
      </div>
      <Separator />
      <nav className="flex gap-1 overflow-x-auto p-3 md:flex-1 md:flex-col md:overflow-visible md:p-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors md:gap-3",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-slate-700 hover:bg-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {item.showUnread && (
                <UnreadNavBadge count={summary.total} />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="hidden p-4 md:block">
        <Button variant="outline" className="w-full" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
