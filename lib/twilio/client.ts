import twilio from "twilio";

export function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  }

  return twilio(accountSid, authToken);
}

export function getTwilioFromNumber(): string {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) {
    throw new Error("Missing TWILIO_FROM_NUMBER");
  }
  return from;
}

export async function sendSms(params: {
  to: string;
  body: string;
}): Promise<void> {
  const client = getTwilioClient();
  const from = getTwilioFromNumber();

  await client.messages.create({
    to: params.to,
    from,
    body: params.body,
  });
}

export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  if (!signature) return false;

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  return twilio.validateRequest(authToken, signature, url, params);
}
