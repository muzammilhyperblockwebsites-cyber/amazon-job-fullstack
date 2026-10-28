import { NextRequest } from "next/server";
import { handleJobsFallback, removeUnavailableStoredJobs } from "@/lib/uk-hourly-fallback";
import { authenticatedToolUser } from "@/lib/tool-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return handleJobsFallback(req);
}

export async function DELETE(req: NextRequest) {
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to remove unavailable saved jobs." }, { status: 401 });
  try { return Response.json(await removeUnavailableStoredJobs(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Cleanup failed. No unverified jobs were removed." }, { status: 503 }); }
}
