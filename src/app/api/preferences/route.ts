import { NextRequest } from "next/server";
import { handlePreferencesRequest } from "@/lib/uk-hourly-fallback";
import { authenticatedToolUser } from "@/lib/tool-session";
import { automationDb, usesWorker } from "@/lib/automation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to view preferences." }, { status: 401 });
  return handlePreferencesRequest(req);
}

async function mutate(req: NextRequest) {
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to change automation settings." }, { status: 401 });
  if (usesWorker()) {
    try { await automationDb(); }
    catch { return Response.json({ error: "Database unavailable. Automation settings were not saved." }, { status: 503 }); }
  }
  const rawBody = await req.text();
  return handlePreferencesRequest(req, rawBody);
}

export const POST = mutate;
export const PUT = mutate;
export const PATCH = mutate;
