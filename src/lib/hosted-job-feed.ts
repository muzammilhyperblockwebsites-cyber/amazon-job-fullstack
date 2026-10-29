import type { HourlyJob } from "./uk-hourly-fallback";

export function dashboardUrl() {
  const configured = process.env.WORKER_DASHBOARD_URL || process.env.APP_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("WORKER_DASHBOARD_URL must use HTTPS (or local HTTP).");
  if (url.username || url.password) throw new Error("Dashboard URL must not contain credentials.");
  return url.origin;
}
export async function readResponse(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`Dashboard returned an unexpected response (${response.status}).`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Dashboard request failed (${response.status}).`);
  return data;
}
export async function fetchHostedJobs(origin: string): Promise<{ jobs: HourlyJob[]; fetchedAt: string; unverifiedJobs: number }> {
  const jobs = new Map<string, HourlyJob>();
  let fetchedAt = new Date().toISOString(), unverifiedJobs = 0;
  for (let page = 1; page <= 5; page++) {
    const data = await readResponse(await fetch(`${origin}/api/jobs?filterOverride=1&limit=100&page=${page}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(55_000) }));
    const checkedAt = Date.parse(data.jobFeed?.fetchedAt);
    if (data.source !== "live" || data.jobFeed?.provider !== "jobsatamazon.co.uk" || data.jobFeed?.stale !== false || !Number.isFinite(checkedAt) || Math.abs(Date.now() - checkedAt) > 120_000 || !Array.isArray(data.jobs)) throw new Error("Dashboard did not return a fresh verified Amazon job feed.");
    fetchedAt = new Date(Math.min(Date.parse(fetchedAt), checkedAt)).toISOString();
    unverifiedJobs = Math.max(unverifiedJobs, Number(data.jobFeed.unverifiedJobs) || 0);
    for (const job of data.jobs) {
      if (!/^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/.test(job.id) || !/^[A-Za-z0-9_-]{1,160}$/.test(job.scheduleId)) throw new Error("Dashboard returned a job without a verified shift.");
      jobs.set(`${job.id}:${job.scheduleId}`, job);
    }
    if (page >= (data.totalPages || 1)) break;
  }
  return { jobs: [...jobs.values()], fetchedAt, unverifiedJobs };
}
