#!/usr/bin/env node
/**
 * Replay a completed Vapi voice webhook without placing a phone call.
 *
 * Usage:
 *   npm run replay:voice
 *   npm run replay:voice -- --url http://localhost:3000
 *   npm run replay:voice -- --production
 *   npm run replay:voice -- --call-id my-test-001 --fixture ./scripts/fixtures/voice-call-ended.sample.json
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_ORG_ID = "0183140d-dff2-40a2-9162-ced390e47719";
const DEFAULT_FIXTURE = join(__dirname, "fixtures", "voice-call-ended.sample.json");
const PRODUCTION_BASE = "https://smbcrm.vercel.app";

function printHelp() {
  console.log(`
Replay a Vapi end-of-call webhook payload (no Vapi credits used).

Options:
  --url <origin>       App origin (default: http://localhost:3000)
  --production         Shorthand for --url https://smbcrm.vercel.app
  --org <uuid>         SMBCRM org id (default: ${DEFAULT_ORG_ID})
  --call-id <id>       Vapi call id in payload (default: new uuid each run)
  --fixture <path>     JSON fixture file (default: scripts/fixtures/voice-call-ended.sample.json)
  --caller <e164>      Override customer phone in payload
  --dry-run            Print payload URL only, do not POST
  -h, --help           Show this help

Examples:
  npm run replay:voice
  npm run replay:voice -- --production
  npm run replay:voice -- --url http://localhost:3000 --call-id replay-sink-001
`);
}

function parseArgs(argv) {
  const options = {
    url: "http://localhost:3000",
    orgId: DEFAULT_ORG_ID,
    callId: `replay-${randomUUID()}`,
    fixture: DEFAULT_FIXTURE,
    caller: null,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--production":
        options.url = PRODUCTION_BASE;
        break;
      case "--url":
        options.url = argv[++i];
        break;
      case "--org":
        options.orgId = argv[++i];
        break;
      case "--call-id":
        options.callId = argv[++i];
        break;
      case "--fixture":
        options.fixture = resolve(argv[++i]);
        break;
      case "--caller":
        options.caller = argv[++i];
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        options.help = true;
    }
  }

  return options;
}

function loadPayload(fixturePath, callId, caller) {
  const raw = readFileSync(fixturePath, "utf8");
  const payload = JSON.parse(raw);

  const message = payload.message ?? payload;
  if (!message?.call) {
    message.call = { id: callId, customer: { number: "+18622004214" } };
  }
  message.call.id = callId;

  const phone = caller ?? message.customer?.number ?? message.call.customer?.number;
  if (phone) {
    message.customer = { number: phone };
    message.call.customer = { number: phone };
  }

  if (payload.message) {
    payload.message = message;
    return payload;
  }

  return { message };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const webhookUrl = `${options.url.replace(/\/$/, "")}/api/vapi/${options.orgId}/webhook`;
  const payload = loadPayload(options.fixture, options.callId, options.caller);

  console.log(`Webhook:  ${webhookUrl}`);
  console.log(`Call ID:  ${options.callId}`);
  console.log(`Fixture:  ${options.fixture}`);

  if (options.dryRun) {
    console.log("\nPayload (dry run):");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SMBCRM-Replay": "true",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  console.log(`\nHTTP ${response.status}`);
  console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));

  if (typeof body === "object" && body?.booking_processed === false) {
    if (body.booking_skipped) {
      console.log(`\nBooking skipped: ${body.booking_skipped}`);
    } else if (body.booking_reply) {
      console.log(`\nBooking ran but no payment URL. Reply: ${body.booking_reply}`);
    } else {
      console.log(
        "\nBooking did not run. Check dev server logs for [vapi/voice-booking]."
      );
    }
  }

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
