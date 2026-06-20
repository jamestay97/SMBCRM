const VAPI_BASE_URL = "https://api.vapi.ai";

export type VapiWebhookMessage = {
  type: string;
  call?: {
    id: string;
    customer?: { number?: string };
  };
  message?: {
    role: string;
    content: string;
  };
  transcript?: string;
};

export function getVapiApiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    throw new Error("Missing VAPI_API_KEY");
  }
  return key;
}

export async function createVapiOutboundCall(params: {
  assistantId: string;
  phoneNumber: string;
  customerNumber: string;
  metadata?: Record<string, string>;
}): Promise<{ callId: string }> {
  const response = await fetch(`${VAPI_BASE_URL}/call/phone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getVapiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId: params.assistantId,
      phoneNumberId: params.phoneNumber,
      customer: { number: params.customerNumber },
      metadata: params.metadata,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vapi call failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id: string };
  return { callId: data.id };
}

export function parseVapiWebhookPayload(body: unknown): VapiWebhookMessage {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid Vapi webhook payload");
  }
  return body as VapiWebhookMessage;
}
