# AI Autonomous Sales Rep

Production-ready B2B SaaS infrastructure for AI-driven lead engagement, multi-tenant Supabase storage, and Stripe deposit collection.

## Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/ui
- **Backend:** Supabase (Auth, Postgres, RLS)
- **Payments:** Stripe Checkout Sessions + Payment Intents
- **AI:** OpenAI GPT-4o (default) or Ollama (local)
- **Comms:** Twilio SMS + Vapi voice webhooks
- **Hosting:** Vercel (required — this app cannot run on GitHub Pages)

## Setup

1. **Install dependencies**

```bash
npm install
```

2. **Configure environment**

Windows (Command Prompt or PowerShell):

```powershell
copy .env.example .env.local
```

macOS/Linux:

```bash
cp .env.example .env.local
```

3. **Apply database migrations**

Run all files in `supabase/migrations/` in order (002 through 012) in the Supabase SQL Editor, or run `supabase/schema.sql` for a fresh install then apply migrations.

4. **Configure OpenAI (production default)**

Set in `.env.local`:

```env
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

5. **Stripe webhook**

Point Stripe to `POST /api/stripe/webhook` and listen for `payment_intent.succeeded`.

For local testing:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

6. **Payment follow-up cron**

While a lead is `payment_pending`, the AI sends deposit reminders at **30 minutes**, **2 hours**, and **24 hours** after the deposit link is created.

Poll the job processor every few minutes (requires `INTERNAL_API_SECRET` in `.env.local`):

```bash
curl -X POST http://localhost:3000/api/jobs/process \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: YOUR_INTERNAL_API_SECRET" \
  -d "{}"
```

In production on Vercel, `vercel.json` runs this every 2 minutes via cron. Set `CRON_SECRET` (or use the same value as `INTERNAL_API_SECRET`).

7. **Run locally**

```bash
npm run dev
```

## Deploy to production (Vercel)

GitHub Pages **will not work** — this app needs a Node.js server for API routes, webhooks, and AI processing.

1. Push the repo to GitHub.
2. Import the project in [Vercel](https://vercel.com) and connect the repo.
3. Add all env vars from `.env.example` in Vercel → Settings → Environment Variables.
4. Set `NEXT_PUBLIC_APP_URL` and `WEBHOOK_BASE_URL` to your Vercel domain (e.g. `https://your-app.vercel.app`).
5. Deploy. Run Supabase migrations if not already applied.
6. Bootstrap platform admin: visit `/admin`, sign in, click bootstrap (email must be in `PLATFORM_ADMIN_EMAILS`).
7. Create tenants at `/admin/tenants/new` — assign each business a Twilio number in E.164 format.
8. In Twilio Console → each phone number → Messaging → set webhook to `POST https://your-app.vercel.app/api/twilio/inbound`.
9. In Stripe Dashboard → webhooks → `POST https://your-app.vercel.app/api/stripe/webhook`.
10. (Optional voice) In Vapi → set server URL to `POST https://your-app.vercel.app/api/vapi/{orgId}/webhook` per tenant.

## Multi-tenant admin

| Step | Where |
|---|---|
| Create business + owner account | `/admin/tenants/new` |
| Assign Twilio phone number | Tenant detail → Twilio numbers |
| Configure services + AI prompt | Owner logs into `/dashboard/settings` |
| View leads & webchat | `/dashboard/leads` |

SMS routing: inbound texts to a tenant number hit `/api/twilio/inbound`, which looks up the org by the **To** number, runs GPT-4o through the booking pipeline, and replies from that tenant's primary number.

## Architecture flow

1. Lead ingested → Ollama conversation created with org `ai_system_prompt` (stored in `transcript_json`)
2. AI engages via SMS / webchat / voice
3. On booking agreement → `create_deposit_payment` tool call → Stripe Checkout URL
4. Stripe webhook → lead `locked_in` + owner email alert

## API routes

| Route | Purpose |
|---|---|
| `POST /api/leads` | Create lead + start AI conversation |
| `POST /api/ai/message` | Send webchat message to AI |
| `POST /api/ai/tools/create-deposit-payment` | Internal tool endpoint (deposit link) |
| `POST /api/stripe/webhook` | Payment success → lock lead |
| `POST /api/twilio/inbound` | Inbound SMS (all tenants — routes by To number) |
| `POST /api/vapi/[orgId]/webhook` | Voice transcripts |
| `GET/POST /api/jobs/process` | Process inbound SMS queue + payment follow-ups |

## Multi-tenant safety

All tenant tables are scoped by `org_id` with Supabase RLS. Webhook and ingestion paths use the service role only where RLS cannot apply (Stripe/Twilio server callbacks).
