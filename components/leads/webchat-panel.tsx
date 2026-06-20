"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUnreadMessages } from "@/components/dashboard/unread-messages-provider";
import type { TranscriptEntry } from "@/types/database";
import { cn } from "@/lib/utils";

export function WebchatPanel({
  leadId,
  transcript,
  className,
}: {
  leadId: string;
  transcript: TranscriptEntry[];
  className?: string;
}) {
  const router = useRouter();
  const { markLeadRead } = useUnreadMessages();
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState(transcript);
  const [loading, setLoading] = useState(false);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) return;
    setEntries(transcript);
  }, [transcript, loading]);

  useEffect(() => {
    void markLeadRead(leadId);
  }, [leadId, markLeadRead]);

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, loading]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || loading) return;

    const userEntry: TranscriptEntry = {
      role: "user",
      content: trimmed,
      channel: "webchat",
      at: new Date().toISOString(),
    };

    const previousEntries = entries;
    const previousMessage = message;

    setEntries((prev) => [...prev, userEntry]);
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("/api/ai/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, message: userEntry.content }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Message failed");
      }

      const assistantEntry: TranscriptEntry = {
        role: "assistant",
        content: data.reply,
        channel: "webchat",
        at: new Date().toISOString(),
      };

      setEntries((prev) => [...prev, assistantEntry]);
      setLoading(false);

      void markLeadRead(leadId);
      void router.refresh();

      if (data.paymentUrl) {
        toast.success("Deposit link generated", {
          description: data.paymentUrl,
        });
      }
    } catch (err) {
      setEntries(previousEntries);
      setMessage(previousMessage);
      toast.error(err instanceof Error ? err.message : "AI reply failed");
    } finally {
      setLoading(false);
    }
  }

  const visibleEntries = entries.filter((entry) => entry.role !== "system");

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white",
        className
      )}
    >
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {visibleEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          visibleEntries.map((entry, index) => (
            <div
              key={`${entry.at}-${index}`}
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                entry.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-slate-100"
              )}
            >
              {entry.content}
            </div>
          ))
        )}
        {loading && (
          <div className="max-w-[85%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-muted-foreground">
            Assistant is typing...
          </div>
        )}
        <div ref={bottomAnchorRef} />
      </div>
      <form onSubmit={sendMessage} className="flex shrink-0 gap-2 border-t p-4">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type as the lead..."
          disabled={loading}
        />
        <Button type="submit" disabled={loading || !message.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
