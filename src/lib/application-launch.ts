import { readApiResponse } from "./api-response";

type LaunchJob = { id: string; scheduleId?: string; title: string; location: string; category?: string; jobType?: string; matchScore?: number };

export async function launchApplication(job: LaunchJob): Promise<string> {
  const result = await readApiResponse(await fetch("/api/desktop", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job),
  }));
  window.dispatchEvent(new CustomEvent("application-progress-refresh"));
  window.dispatchEvent(new CustomEvent("stats-refresh"));
  return result.message || "The tool's Amazon browser is opening. No extension is required.";
}
