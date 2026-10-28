import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return Response.json(
    {
      id: req.nextUrl.searchParams.get("id") || "",
      status: "completed",
      result: { ok: true },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
