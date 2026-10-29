import { NextRequest } from "next/server";
import { fetchAllUKHourlyJobs, handleJobApplyFallback, type HourlyJob } from "./uk-hourly-fallback";
import type { QueuedJob } from "./automation-store";
import { dashboardUrl, fetchHostedJobs, readResponse } from "./hosted-job-feed";

let sessionCookie = "";
let sessionExpires = 0;
async function login(origin: string) {
  if (!process.env.TOOL_LOGIN_EMAIL || !process.env.TOOL_LOGIN_PASSWORD) throw new Error("Configure TOOL_LOGIN_EMAIL and TOOL_LOGIN_PASSWORD on the PC worker to prepare applications through the dashboard.");
  const response = await fetch(origin + "/api/auth", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.TOOL_LOGIN_EMAIL, password: process.env.TOOL_LOGIN_PASSWORD }),
  });
  await readResponse(response);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("amazon_monitor_session=")) throw new Error("Dashboard login did not establish a tool session.");
  sessionCookie = cookie;
  sessionExpires = Date.now() + 7 * 60 * 60_000;
}

export async function workerJobs(): Promise<{ jobs: HourlyJob[] }> {
  const origin = dashboardUrl();
  return origin ? fetchHostedJobs(origin) : fetchAllUKHourlyJobs();
}

export async function prepareWorkerApplication(job: QueuedJob) {
  const origin = dashboardUrl();
  if (!origin) return readResponse(await handleJobApplyFallback(new NextRequest("http://localhost/api/jobs/apply"), JSON.stringify(job)));
  if (!sessionCookie || Date.now() >= sessionExpires) await login(origin);
  const send = () => fetch(origin + "/api/jobs/apply", {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(55_000),
    headers: { "Content-Type": "application/json", Cookie: sessionCookie, Origin: origin }, body: JSON.stringify(job),
  });
  let response = await send();
  if (response.status === 401) { await response.body?.cancel(); sessionCookie = ""; await login(origin); response = await send(); }
  const result = await readResponse(response);
  if (result.jobId !== job.id || result.scheduleId !== job.scheduleId) throw new Error("Dashboard prepared a different job or shift. No browser was opened.");
  return result;
}
