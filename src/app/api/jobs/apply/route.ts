import { NextRequest } from "next/server";
import { handleJobApplyFallback } from "@/lib/uk-hourly-fallback";
import { authenticatedToolUser } from "@/lib/tool-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  void req;
  return Response.json({ error: "Use POST to prepare an application." }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(req: NextRequest) {
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to prepare an application." }, { status: 401 });
  const rawBody = await req.text();
  return handleJobApplyFallback(req, rawBody);
}
