import { NextRequest } from "next/server";
import { handleAgentFallback } from "@/lib/uk-hourly-fallback";
import { authenticatedToolUser } from "@/lib/tool-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to access your candidate profile." }, { status: 401 });
  return handleAgentFallback(req);
}

async function mutate(req: NextRequest) {
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to save your candidate profile." }, { status: 401 });
  const rawBody = await req.text();
  return handleAgentFallback(req, rawBody);
}

export const POST = mutate;
export const PUT = mutate;
export const PATCH = mutate;
