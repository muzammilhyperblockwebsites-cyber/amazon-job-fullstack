import { readApiResponse } from "./api-response";

type LaunchJob = { id: string; scheduleId?: string; title: string; location: string; category?: string; jobType?: string; matchScore?: number };

function helperRequest(type: string, detail: Record<string, unknown> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Install or update the Amazon application helper, then reload this dashboard."));
    }, 2500);
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.channel !== "amazon-monitor-helper" || event.data?.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve();
    }
    window.addEventListener("message", receive);
    window.postMessage({ channel: "amazon-monitor", type, requestId, ...detail }, window.location.origin);
  });
}

// Open the blank tab synchronously in the click handler; navigate only after validation.
export async function launchApplication(job: LaunchJob, tab: Window | null): Promise<string> {
  if (!tab || tab.closed) throw new Error("Allow pop-ups for this dashboard, then click Apply again.");
  try {
    tab.opener = null;
    await helperRequest("ping");
    const agent = await readApiResponse(await fetch("/api/agent", { cache: "no-store" }));
    const profile = agent.profile || {};
    if (profile.aiFormFillerEnabled === false || profile.autoClickNextEnabled === false) {
      throw new Error("Enable form filling and automatic Next in your candidate profile first.");
    }
    if (!profile.firstName || !profile.lastName || !profile.phone || !profile.postcode) {
      throw new Error("Save your name, phone and postcode in Candidate Profile first.");
    }
    if (profile.cvFileName && !profile.cvBase64) {
      throw new Error("Re-upload and save your CV. The previous helper saved its filename without the file contents.");
    }
    const result = await readApiResponse(await fetch("/api/jobs/apply", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job),
    }));
    const url = new URL(result.applyUrl);
    if (url.origin !== "https://www.jobsatamazon.co.uk" || !result.scheduleId) throw new Error("A verified Amazon shift is required.");
    const launchId = crypto.randomUUID();
    await helperRequest("launch", { launchId, jobId: job.id, scheduleId: result.scheduleId, profile });
    const [path, query = ""] = url.hash.split("?");
    const params = new URLSearchParams(query);
    params.set("agmLaunch", launchId);
    url.hash = `${path}?${params}`;
    tab.location.href = url.toString();
    window.dispatchEvent(new CustomEvent("stats-refresh"));
    return "Application helper started. Continue in the Amazon tab; it stops at assessment or a step needing your input.";
  } catch (error) {
    tab.close();
    throw error;
  }
}
