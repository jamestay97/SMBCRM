export function formatAppointmentWindow(
  startsAt: string,
  endsAt: string,
  timeZone = "America/New_York"
): string {
  const startLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startsAt));

  const endLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(endsAt));

  return `${startLabel} – ${endLabel}`;
}

export function formatDepositAmount(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function buildAppointmentConfirmationMessage(params: {
  businessName: string;
  serviceReason?: string | null;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  depositCents?: number;
}): string {
  const when = formatAppointmentWindow(
    params.startsAt,
    params.endsAt,
    params.timeZone
  );
  const service = params.serviceReason?.trim()
    ? ` for ${params.serviceReason.trim()}`
    : "";
  const deposit = params.depositCents
    ? ` A deposit of ${formatDepositAmount(params.depositCents)} secures your spot.`
    : "";

  return `${params.businessName} appointment${service} on ${when}.${deposit}`;
}
