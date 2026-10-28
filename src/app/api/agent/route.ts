import { NextRequest } from "next/server";
import { handleAgentFallback } from "@/lib/uk-hourly-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return handleAgentFallback(req);
}

async function mutate(req: NextRequest) {
  const rawBody = await req.text();
  return handleAgentFallback(req, rawBody);
}

export const POST = mutate;
export const PUT = mutate;
export const PATCH = mutate;
