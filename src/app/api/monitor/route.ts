import { NextRequest } from "next/server";
import { handleMonitorFallback } from "@/lib/uk-hourly-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return handleMonitorFallback(req);
}

export async function POST(req: NextRequest) {
  return handleMonitorFallback(req);
}
