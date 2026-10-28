import { NextRequest } from "next/server";
import { fetchAllUKHourlyJobs, getStoredPreferences, passesHardFilters, scoreJob } from "@/lib/uk-hourly-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let checking = false;
      let interval: ReturnType<typeof setInterval> | undefined;
      cleanup = () => { closed = true; if (interval) clearInterval(interval); };
      const abort = () => { cleanup(); try { controller.close(); } catch { /* already closed */ } };
      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) { abort(); return; }
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      send({ type: "connected", ts: new Date().toISOString() });

      const check = async () => {
        if (closed || checking) return;
        checking = true;
        try {
          const [{ jobs, fetchedAt }, prefs] = await Promise.all([fetchAllUKHourlyJobs(), getStoredPreferences()]);
          send({
            type: "heartbeat",
            checkedAt: fetchedAt,
            totalJobs: jobs.length,
          });
          const matching = jobs.filter(job => passesHardFilters(job, prefs)).map(job => ({ ...job, matchScore: scoreJob(job, prefs), autoApply: Boolean(prefs.autoApplyEnabled) }));
          const fresh = matching.filter(job => !seen.has(`${job.id}:${job.scheduleId}`));
          for (const job of matching) seen.add(`${job.id}:${job.scheduleId}`);
          if (fresh.length) send({ type: "new_jobs", checkedAt: fetchedAt, jobs: fresh });
        } catch {
          // ignore
        } finally { checking = false; }
      };
      await check();
      if (!closed) interval = setInterval(() => { void check(); }, 20_000);
    },
    cancel() { cleanup(); },
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
