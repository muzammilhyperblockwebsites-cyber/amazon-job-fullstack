"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { readApiResponse } from "@/lib/api-response";
import { useSSE, type SSEJobEvent } from "@/hooks/useSSE";
import { useNotifications } from "@/hooks/useNotifications";
import { launchApplication } from "@/lib/application-launch";
import ApplicationProgress from "./ApplicationProgress";

export interface MonitorControlHandle {
  pollAndAutoOpenBestMatch: (
    preOpenedTab?: Window | null,
    isBackground?: boolean
  ) => Promise<void>;
}

interface ApplicationLog {
  jobId: string;
  title: string;
  status: string;
  applyUrl: string;
  steps?: string[];
  shiftReserved?: boolean;
  stage?: string;
}

function officialUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.jobsatamazon.co.uk" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await readApiResponse(response);
  if (!response.ok)
    throw new Error(data.error || data.message || "Request failed. Please retry.");
  if (response.status === 202 && data.taskId) {
    for (let attempt = 0; attempt < 300; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const poll = await fetch(
        "/api/tasks?id=" + encodeURIComponent(data.taskId),
        { cache: "no-store" }
      );
      if (!poll.ok)
        throw new Error(
          "Task status unavailable. Review activity before retrying."
        );
      const task = await readApiResponse(poll);
      if (task.status === "completed") return task.result;
      if (task.status === "failed")
        throw new Error(task.result?.error || "Worker task failed");
    }
    throw new Error(
      "Task is still running. Check application activity before retrying."
    );
  }
  return data;
}

const MonitorControl = forwardRef<
  MonitorControlHandle,
  { onNewJobs?: () => void }
>(function MonitorControl({ onNewJobs }, ref) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [logs, setLogs] = useState<ApplicationLog[]>([]);
  const [jobs, setJobs] = useState<SSEJobEvent[]>([]);
  const notifiedIds = useRef(new Set<string>());
  const autoOpenedIds = useRef(new Set<string>());
  const polling = useRef(false);
  const { notify, requestPermission } = useNotifications();

  const refresh = useCallback(async () => {
    const [agent, prefs] = await Promise.all([
      jsonRequest("/api/agent"),
      jsonRequest("/api/preferences"),
    ]);
    setLogs(agent.logs || []);
    setAutoEnabled(Boolean(prefs.autoApplyEnabled));
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setMessage(error.message));
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useSSE((event) => {
    if (event.type === "heartbeat") { onNewJobs?.(); return; }
    if (event.type !== "new_jobs") return;
    setJobs(event.jobs);
    onNewJobs?.();
    const fresh = event.jobs.filter((job) => !notifiedIds.current.has(job.id));
    for (const job of fresh) notifiedIds.current.add(job.id);
    if (fresh[0])
      notify(`${fresh.length} matching Amazon job(s)`, {
        body: `${fresh[0].title} — ${fresh[0].location}`,
        url: fresh[0].applyUrl,
        tag: `job-${fresh[0].id}`,
      });
  });

  const poll = useCallback(
    async (preOpenedTab?: Window | null, isBackground = false) => {
      if (polling.current) { preOpenedTab?.close(); return; }
      polling.current = true;
      if (!isBackground) {
        setBusy(true);
        setMessage("");
      }
      try {
        const result = await jsonRequest("/api/monitor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        setJobs(result.jobs || []);
        const best = result.bestMatchJob;
        preOpenedTab?.close();
        const shouldStart = best?.id && (!isBackground || (autoEnabled && (best.matchScore ?? 0) >= 100 && !autoOpenedIds.current.has(`${best.id}:${best.scheduleId}`)));
        if (shouldStart) {
          setMessage(await launchApplication(best));
          autoOpenedIds.current.add(`${best.id}:${best.scheduleId}`);
        }
        if (!best) setMessage("No matching live shifts are available. Monitoring will keep checking.");
        onNewJobs?.();
        window.dispatchEvent(new CustomEvent("stats-refresh"));
        await refresh();
      } catch (error) {
        preOpenedTab?.close();
        setMessage(error instanceof Error ? error.message : "Poll failed");
      } finally {
        polling.current = false;
        if (!isBackground) setBusy(false);
      }
    },
    [autoEnabled, onNewJobs, refresh]
  );

  // Automatic background polling when Auto-Apply is enabled
  useEffect(() => {
    if (!autoEnabled) return;
    const interval = setInterval(() => {
      void poll(null, true);
    }, 12_000);
    return () => clearInterval(interval);
  }, [autoEnabled, poll]);

  useImperativeHandle(ref, () => ({ pollAndAutoOpenBestMatch: poll }), [poll]);

  async function toggleAutoApply() {
    try {
      const data = await jsonRequest("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApplyEnabled: !autoEnabled }),
      });
      setAutoEnabled(Boolean(data.autoApplyEnabled));
      if (data.autoApplyEnabled) {
        autoOpenedIds.current.clear();
      }
      setMessage(
        data.autoApplyEnabled
          ? "Automatic preparation enabled. The first 100% match starts in the tool's Amazon browser."
          : "Automatic preparation disabled."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Preferences were not saved"
      );
    }
  }

  return (
    <section className="bg-white border border-gray-100 rounded-xl p-4 space-y-4 mb-4">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div>
          <h2 className="font-bold text-gray-900">
            Job Monitor &amp; Auto-Advance to Assessment
          </h2>
          <p className="text-xs text-gray-500">
            Saved details and CV → Amazon forms → pause at assessment
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void poll(null, false);
          }}
          disabled={busy}
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Checking & preparing…" : "Check & Apply to Assessment"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            autoEnabled
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              autoEnabled ? "bg-green-500 animate-pulse" : "bg-gray-400"
            }`}
          />
          {autoEnabled
            ? "Monitoring active (every 12s)"
            : "Auto-Apply Paused"}
        </span>

        <button
          type="button"
          onClick={() => void toggleAutoApply()}
          className="text-sm underline text-blue-700 cursor-pointer"
        >
          {autoEnabled ? "Disable" : "Enable"} automatic preparation
        </button>

        <button
          type="button"
          onClick={() => void requestPermission()}
          className="text-sm underline text-blue-700 cursor-pointer"
        >
          Enable browser alerts
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong>Built-in Amazon browser:</strong>{" "}
          No extension or userscript installation. Save your profile, then click Apply.
          The tool checks the shift, clicks I Agree and continues to assessment.
          Sign in once in its Amazon browser if requested. OTP/CAPTCHA and unknown
          questions pause automation.
        </div>
      </div>

      <ApplicationProgress />

      {message && (
        <p role="status" className="text-sm text-gray-700">
          {message}
        </p>
      )}
      {jobs.length > 0 && (
        <p className="text-sm text-gray-600">
          {jobs.length} matching job(s) found. View the feed below for details.
        </p>
      )}
      {logs.length > 0 && (
        <details open>
          <summary className="cursor-pointer font-medium text-sm">
            Application activity ({logs.length} prepared)
          </summary>
          <ul className="mt-3 space-y-3">
            {logs.map((log) => (
              <li key={log.jobId} className="border rounded-lg p-3 text-sm">
                <p className="font-medium">{log.title}</p>
                <p className="text-green-700 font-medium">
                  Status: {log.status.replaceAll("_", " ")}
                </p>
                <p>
                  Shift reservation:{" "}
                  {log.shiftReserved
                    ? "confirmed & locked"
                    : "not yet confirmed"}
                </p>
                {log.steps?.length ? (
                  <ul className="text-xs text-gray-600 mt-2 space-y-1">
                    {log.steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ul>
                ) : null}
                {officialUrl(log.applyUrl) && (
                  <a
                    href={log.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-blue-700 underline font-medium"
                  >
                    Review on Amazon ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
});

export default MonitorControl;
