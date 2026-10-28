import { NextRequest } from "next/server";
import { fetchAllUKHourlyJobs } from "@/lib/uk-hourly-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      send({ type: "connected", ts: new Date().toISOString() });

      try {
        const { jobs, fetchedAt } = await fetchAllUKHourlyJobs();
        send({
          type: "heartbeat",
          checkedAt: fetchedAt,
          totalJobs: jobs.length,
        });
      } catch {
        // ignore initial fetch error
      }

      const interval = setInterval(async () => {
        try {
          const { jobs, fetchedAt } = await fetchAllUKHourlyJobs();
          send({
            type: "heartbeat",
            checkedAt: fetchedAt,
            totalJobs: jobs.length,
          });
        } catch {
          // ignore
        }
      }, 20_000);

      req.signal.addEventListener(
        "abort",
        () => {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            // ignore
          }
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
