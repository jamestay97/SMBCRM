import { NextRequest, NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth/internal";
import { processDuePaymentFollowups } from "@/lib/leads/payment-followups";
import { processInboundJob, processQueuedJobs } from "@/lib/jobs/process-inbound-job";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!verifyInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { job_id?: string; batch?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    if (body.job_id) {
      await processInboundJob(body.job_id);
      return NextResponse.json({ processed: 1, job_id: body.job_id });
    }

    const inboundCount = await processQueuedJobs(10);
    const followupCount = await processDuePaymentFollowups(20);

    return NextResponse.json({
      processed: inboundCount + followupCount,
      inbound_jobs: inboundCount,
      payment_followups: followupCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
