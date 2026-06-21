import Link from "next/link";
import { ExternalLink, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCallDuration } from "@/lib/vapi/parse-call";
import { formatDate } from "@/lib/utils";
import type { VoiceCall } from "@/types/database";

function statusLabel(status: VoiceCall["status"]): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In progress";
    case "failed":
      return "Failed";
    case "busy":
      return "Busy";
    case "no_answer":
      return "No answer";
    default:
      return status;
  }
}

export function CallHistoryCard({ calls }: { calls: VoiceCall[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Call history</CardTitle>
        <CardDescription>
          Synced from Vapi when customers call your business number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No calls yet. Point Vapi to{" "}
            <code className="text-xs">/api/vapi/webhook</code> and assign your
            business phone in Settings.
          </p>
        ) : (
          calls.map((call) => (
            <div key={call.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{call.customer_phone}</p>
                    <p className="text-xs text-muted-foreground">
                      {call.started_at
                        ? formatDate(call.started_at)
                        : formatDate(call.created_at)}
                      {" · "}
                      {formatCallDuration(call.duration_seconds)}
                    </p>
                  </div>
                </div>
                <Badge variant={call.status === "completed" ? "default" : "secondary"}>
                  {statusLabel(call.status)}
                </Badge>
              </div>

              {call.summary ? (
                <p className="mt-2 text-muted-foreground">{call.summary}</p>
              ) : null}

              {call.transcript ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-primary">
                    View transcript
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">
                    {call.transcript}
                  </pre>
                </details>
              ) : null}

              {call.recording_url ? (
                <Link
                  href={call.recording_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Listen to recording
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : null}

              {call.ended_reason ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Ended: {call.ended_reason}
                </p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
