"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { UnreadSummary } from "@/lib/leads/conversation-unread";

const EMPTY_SUMMARY: UnreadSummary = {
  total: 0,
  leads: [],
  byLeadId: {},
};

const POLL_INTERVAL_MS = 30_000;

type UnreadMessagesContextValue = {
  summary: UnreadSummary;
  refreshUnread: () => Promise<void>;
  markLeadRead: (leadId: string) => Promise<void>;
};

const UnreadMessagesContext = createContext<UnreadMessagesContextValue>({
  summary: EMPTY_SUMMARY,
  refreshUnread: async () => {},
  markLeadRead: async () => {},
});

export function useUnreadMessages() {
  return useContext(UnreadMessagesContext);
}

export function UnreadMessagesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [summary, setSummary] = useState<UnreadSummary>(EMPTY_SUMMARY);
  const summaryRef = useRef(summary);
  const knownInboundAtRef = useRef<Record<string, string>>({});
  const initializedRef = useRef(false);
  const markingReadRef = useRef<Set<string>>(new Set());
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  const refreshUnread = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const request = (async () => {
      try {
        const response = await fetch("/api/leads/unread", {
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as UnreadSummary;
        setSummary(data);
        summaryRef.current = data;

        if (!initializedRef.current) {
          for (const lead of data.leads) {
            knownInboundAtRef.current[lead.leadId] = lead.lastMessageAt;
          }
          initializedRef.current = true;
          return;
        }

        for (const lead of data.leads) {
          const previousAt = knownInboundAtRef.current[lead.leadId];
          if (previousAt && lead.lastMessageAt > previousAt) {
            toast.message(`New message from ${lead.leadName}`, {
              description: lead.preview || "Open the conversation to reply.",
              action: {
                label: "View",
                onClick: () => {
                  window.location.href = `/dashboard/leads/${lead.leadId}`;
                },
              },
            });
          }
          knownInboundAtRef.current[lead.leadId] = lead.lastMessageAt;
        }

        for (const leadId of Object.keys(knownInboundAtRef.current)) {
          if (!data.byLeadId[leadId]) {
            delete knownInboundAtRef.current[leadId];
          }
        }
      } catch {
        // Network blips during dev reloads are expected — fail quietly.
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = request;
    return request;
  }, []);

  const markLeadRead = useCallback(
    async (leadId: string) => {
      if (!leadId || markingReadRef.current.has(leadId)) {
        return;
      }

      const unread = summaryRef.current.byLeadId[leadId];
      if (!unread) {
        return;
      }

      markingReadRef.current.add(leadId);

      const lastAt = unread.lastMessageAt;
      if (lastAt) {
        knownInboundAtRef.current[leadId] = lastAt;
      }

      setSummary((current) => {
        const leads = current.leads.filter((lead) => lead.leadId !== leadId);
        const byLeadId = { ...current.byLeadId };
        delete byLeadId[leadId];
        const next = {
          total: leads.reduce((sum, lead) => sum + lead.unreadCount, 0),
          leads,
          byLeadId,
        };
        summaryRef.current = next;
        return next;
      });

      try {
        const response = await fetch(`/api/leads/${leadId}/read`, {
          method: "POST",
        });
        if (!response.ok) {
          await refreshUnread();
        }
      } catch {
        await refreshUnread();
      } finally {
        markingReadRef.current.delete(leadId);
      }
    },
    [refreshUnread]
  );

  useEffect(() => {
    void refreshUnread();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshUnread();
    }, POLL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshUnread();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshUnread]);

  return (
    <UnreadMessagesContext.Provider
      value={{ summary, refreshUnread, markLeadRead }}
    >
      {children}
    </UnreadMessagesContext.Provider>
  );
}

export function UnreadNavBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function UnreadLeadDot({ leadId }: { leadId: string }) {
  const { summary } = useUnreadMessages();
  const unread = summary.byLeadId[leadId];

  if (!unread) return null;

  return (
    <span
      className="inline-flex h-2 w-2 shrink-0 rounded-full bg-red-500"
      title={`${unread.unreadCount} unread message${unread.unreadCount === 1 ? "" : "s"}`}
    />
  );
}

export function OverviewUnreadBadge({ leadId }: { leadId: string }) {
  const { summary } = useUnreadMessages();
  const unread = summary.byLeadId[leadId];

  if (!unread) return null;

  return (
    <Badge variant="warning" className="font-normal">
      {unread.unreadCount} new
    </Badge>
  );
}

export function UnreadMessagesBanner() {
  const { summary } = useUnreadMessages();

  if (summary.total === 0) return null;

  const topLead = summary.leads[0];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p>
        <span className="font-semibold">{summary.total} unread</span>
        {summary.leads.length === 1
          ? ` message from ${topLead.leadName}`
          : ` messages across ${summary.leads.length} leads`}
      </p>
      {topLead && (
        <Link
          href={`/dashboard/leads/${topLead.leadId}`}
          className="font-medium text-amber-900 underline-offset-2 hover:underline"
        >
          View latest
        </Link>
      )}
    </div>
  );
}
