import { NextRequest, NextResponse } from "next/server";

export function verifyInternalSecret(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-internal-secret");
  return header === secret;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
