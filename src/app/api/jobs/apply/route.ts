import { NextRequest } from "next/server";
import { handleJobApplyFallback } from "@/lib/uk-hourly-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return handleJobApplyFallback(req);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  return handleJobApplyFallback(req, rawBody);
}
