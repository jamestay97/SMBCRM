# AI Autonomous Sales Rep

Production-ready B2B SaaS infrastructure for AI-driven lead engagement, multi-tenant Supabase storage, and Stripe deposit collection.

## Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/ui
- **Backend:** Supabase (Auth, Postgres, RLS)
- **Payments:** Stripe Checkout Sessions + Payment Intents
- **AI:** Ollama (local chat API + tool calls)
- **Comms:** Twilio SMS + Vapi voice webhooks

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

3. **Apply database schema**

Run `supabase/schema.sql` in the Supabase SQL Editor.

4. **Start Ollama and pull a tool-capable model**

```bash
ollama serve
ollama pull llama3.1
```

Set in `.env.local`:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
```

Models with tool-calling support include `llama3.1`, `mistral-nemo`, and `qwen2.5`.

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

In production, schedule the same request on a cron (e.g. every 5 minutes).

7. **Run locally**

```bash
npm run dev
```

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
| `POST /api/twilio/[orgId]/inbound` | Inbound SMS |
| `POST /api/vapi/[orgId]/webhook` | Voice transcripts |

## Multi-tenant safety

All tenant tables are scoped by `org_id` with Supabase RLS. Webhook and ingestion paths use the service role only where RLS cannot apply (Stripe/Twilio server callbacks).
