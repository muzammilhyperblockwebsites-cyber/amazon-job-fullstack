import { NextRequest } from "next/server";
import { handleMarkSeenRequest } from "@/lib/uk-hourly-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  return handleMarkSeenRequest(rawBody);
}
