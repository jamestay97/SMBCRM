"use client";

import { createContext, useContext } from "react";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { UnreadMessagesProvider } from "@/components/dashboard/unread-messages-provider";
import type { OrgMemberRole } from "@/types/database";

type DashboardContextValue = {
  role: OrgMemberRole;
  canManage: boolean;
};

const DashboardContext = createContext<DashboardContextValue>({
  role: "member",
  canManage: false,
});

export function useDashboardContext() {
  return useContext(DashboardContext);
}

export function DashboardShell({
  role,
  children,
}: {
  role: OrgMemberRole;
  children: React.ReactNode;
}) {
  const canManage = role === "owner" || role === "admin";

  return (
    <DashboardContext.Provider value={{ role, canManage }}>
      <UnreadMessagesProvider>
        <div className="flex h-dvh flex-col md:flex-row md:overflow-hidden">
          <DashboardNav />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4 sm:p-6 md:p-8">
            {children}
          </main>
        </div>
      </UnreadMessagesProvider>
    </DashboardContext.Provider>
  );
}
