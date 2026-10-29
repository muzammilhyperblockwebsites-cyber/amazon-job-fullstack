import { NextRequest } from "next/server";
import { authenticatedToolUser } from "@/lib/tool-session";
import { browserTask, browserTasks, desktopCapability, startBrowserApplication, stopBrowserTask } from "@/lib/desktop-browser";
import { handleAgentFallback, handleJobApplyFallback, markScheduleUnavailable } from "@/lib/uk-hourly-fallback";
import { usesWorker } from "@/lib/automation-store";
import { handleWorkerRequest } from "@/lib/automation-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function GET(req: NextRequest) {
  if (usesWorker()) return handleWorkerRequest(req);
  if (req.nextUrl.searchParams.get("capability") === "1") return Response.json(desktopCapability(), { headers });
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to view application progress." }, { status: 401, headers });
  const id = req.nextUrl.searchParams.get("id");
  const task = id ? browserTask(id) : null;
  if (id && !task) return Response.json({ error: "Application task not found. It may have ended when the local server restarted." }, { status: 404, headers });
  return Response.json(id ? { task } : { ...desktopCapability(), tasks: browserTasks() }, { headers });
}
export async function POST(req: NextRequest) {
  if (usesWorker()) return handleWorkerRequest(req);
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to start the Amazon browser." }, { status: 401, headers });
  if (!desktopCapability().available) return Response.json({ error: desktopCapability().message, localUrl: desktopCapability().localUrl }, { status: 503, headers });
  try {
    const body = await req.json();
    const agent = await (await handleAgentFallback(new NextRequest(req.url, { method: "GET" }))).json();
    const profile = agent.profile || {};
    if (profile.cvFileName && !profile.cvBase64) return Response.json({ error: "Re-upload and save your CV; its contents were not stored by the old version." }, { status: 400, headers });
    if (profile.aiFormFillerEnabled === false || profile.autoClickNextEnabled === false) return Response.json({ error: "Enable form filling and automatic Next in your candidate profile." }, { status: 400, headers });
    const prepared = await handleJobApplyFallback(req, JSON.stringify(body));
    if (!prepared.ok) return prepared;
    const result = await prepared.json();
    const task = await startBrowserApplication({ jobId: result.jobId, scheduleId: result.scheduleId, applyUrl: result.applyUrl, title: result.job.title, profile }, () => markScheduleUnavailable(result.jobId, result.scheduleId));
    return Response.json({ task, message: task.message }, { status: 202, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Application could not start.";
    return Response.json({ error: message }, { status: message.includes("already running") ? 409 : 503, headers });
  }
}
export async function DELETE(req: NextRequest) {
  if (usesWorker()) return handleWorkerRequest(req);
  if (!authenticatedToolUser(req)) return Response.json({ error: "Sign in to stop automation." }, { status: 401, headers });
  const id = req.nextUrl.searchParams.get("id") || "";
  const task = await stopBrowserTask(id);
  return Response.json(task ? { task } : { error: "Application task not found." }, { status: task ? 200 : 404, headers });
}
