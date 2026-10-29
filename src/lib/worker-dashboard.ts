import { NextRequest } from "next/server";
import { fetchAllUKHourlyJobs, handleJobApplyFallback, type HourlyJob } from "./uk-hourly-fallback";
import type { QueuedJob } from "./automation-store";

let sessionCookie = "";
let sessionExpires = 0;
function dashboardUrl() {
  const configured = process.env.WORKER_DASHBOARD_URL || process.env.APP_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("WORKER_DASHBOARD_URL must use HTTPS (or local HTTP).");
  if (url.username || url.password) throw new Error("Dashboard URL must not contain credentials.");
  return url.origin;
}
async function readResponse(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`Dashboard returned an unexpected response (${response.status}).`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Dashboard request failed (${response.status}).`);
  return data;
}
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
  if (!origin) return fetchAllUKHourlyJobs();
  const jobs: HourlyJob[] = [];
  // The existing hosted feed performs public availability checks; the PC still
  // performs Amazon's signed-in ACTIVE check before application actions.
  for (let page = 1; page <= 5; page++) {
    const data = await readResponse(await fetch(`${origin}/api/jobs?filterOverride=1&limit=100&page=${page}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(55_000) }));
    const checkedAt = Date.parse(data.jobFeed?.fetchedAt);
    if (data.source !== "live" || data.jobFeed?.provider !== "jobsatamazon.co.uk" || data.jobFeed?.stale !== false || !Number.isFinite(checkedAt) || Math.abs(Date.now() - checkedAt) > 120_000 || !Array.isArray(data.jobs)) throw new Error("Dashboard did not return a fresh verified Amazon job feed.");
    for (const job of data.jobs) {
      if (!/^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/.test(job.id) || !/^[A-Za-z0-9_-]{1,160}$/.test(job.scheduleId)) throw new Error("Dashboard returned a job without a verified shift.");
      jobs.push(job);
    }
    if (page >= (data.totalPages || 1)) return { jobs };
  }
  return { jobs };
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
