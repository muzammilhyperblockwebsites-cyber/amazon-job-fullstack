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
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [logs, setLogs] = useState<ApplicationLog[]>([]);
  const [jobs, setJobs] = useState<SSEJobEvent[]>([]);
  const notifiedIds = useRef(new Set<string>());
  const autoOpenedIds = useRef(new Set<string>());
  const { notify, requestPermission } = useNotifications();

  const refresh = useCallback(async () => {
    const [session, agent, prefs] = await Promise.all([
      jsonRequest("/api/auto-apply"),
      jsonRequest("/api/agent"),
      jsonRequest("/api/preferences"),
    ]);
    setConnected(Boolean(session.connected));
    setLogs(agent.logs || []);
    setAutoEnabled(Boolean(prefs.autoApplyEnabled));
    if (prefs.amazonEmail) setEmail(prefs.amazonEmail);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setMessage(error.message));
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useSSE((event) => {
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
        if (
          preOpenedTab &&
          !preOpenedTab.closed &&
          best?.applyUrl &&
          officialUrl(best.applyUrl)
        ) {
          autoOpenedIds.current.add(best.id);
          preOpenedTab.location.href = best.applyUrl;
        } else {
          preOpenedTab?.close();
          if (
            autoEnabled &&
            best?.id &&
            (best.matchScore ?? 0) >= 100 &&
            best.applyUrl &&
            officialUrl(best.applyUrl) &&
            !autoOpenedIds.current.has(best.id)
          ) {
            autoOpenedIds.current.add(best.id);
            window.open(best.applyUrl, "_blank", "noopener,noreferrer");
          }
        }
        if (!isBackground) {
          setMessage(
            `Checked jobs. ${
              result.newJobsCount || 0
            } matching job(s). Auto-advancing 100% matches to Assessment.`
          );
        }
        onNewJobs?.();
        window.dispatchEvent(new CustomEvent("stats-refresh"));
        await refresh();
      } catch (error) {
        preOpenedTab?.close();
        if (!isBackground) {
          setMessage(error instanceof Error ? error.message : "Poll failed");
        }
      } finally {
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

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setConnecting(true);
    setMessage("");
    try {
      const data = await jsonRequest("/api/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect_session",
          email,
          password,
          otp,
        }),
      });
      setConnected(Boolean(data.connected));
      setMessage(
        data.message ||
          (data.connected
            ? "Amazon session verified."
            : "Complete Amazon sign-in and verification.")
      );
      if (data.connected) {
        setPassword("");
        setOtp("");
      }
    } catch (error) {
      setConnected(false);
      setMessage(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function toggleAutoApply() {
    try {
      const data = await jsonRequest("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApplyEnabled: !autoEnabled }),
      });
      setAutoEnabled(Boolean(data.autoApplyEnabled));
      setMessage(
        data.autoApplyEnabled
          ? "Auto-Apply enabled! 100% matching jobs will automatically lock shifts and advance to Assessment."
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
            Full-Stack Next.js Engine • Direct jobsatamazon.co.uk Shift Lock +
            Assessment Flow
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const tab = window.open("about:blank", "_blank");
            void poll(tab, false);
          }}
          disabled={busy}
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Checking & Advancing…" : "⚡ Check & Auto-Apply Now"}
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
            ? "Auto-Apply Active (Every 12s → Assessment)"
            : "Auto-Apply Paused"}
        </span>

        <button
          type="button"
          onClick={() => void toggleAutoApply()}
          className="text-sm underline text-blue-700 cursor-pointer"
        >
          {autoEnabled ? "Disable" : "Enable"} automatic application to
          Assessment
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
          <strong>⚡ Zero-Click &quot;I Agree&quot; → Assessment Helper:</strong>{" "}
          Automatically bypasses Application Integrity Notice (&quot;I
          Agree&quot;), locks the shift, and advances to{" "}
          <code>#/assessment-consent</code>.
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/amazon-uk-auto-agree.user.js"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg"
          >
            Install Tampermonkey Script
          </a>
          <a
            href="/amazon-auto-agree-extension.zip"
            download
            className="bg-gray-800 hover:bg-gray-900 text-white font-semibold px-3 py-1.5 rounded-lg"
          >
            Download Chrome Extension (.zip)
          </a>
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Connect Amazon account ({connected ? "verified" : "not verified"})
        </summary>
        <form onSubmit={connect} className="mt-3 grid gap-2">
          <label className="text-sm">
            Amazon email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block border rounded-lg px-3 py-2 w-full"
            />
          </label>
          <label className="text-sm">
            Amazon password
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block border rounded-lg px-3 py-2 w-full"
            />
          </label>
          <label className="text-sm">
            Verification code, if requested
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="block border rounded-lg px-3 py-2 w-full"
            />
          </label>
          <button
            disabled={connecting}
            className="bg-gray-900 text-white rounded-lg px-3 py-2 disabled:opacity-50 cursor-pointer"
          >
            {connecting ? "Connecting…" : "Connect / verify"}
          </button>
        </form>
      </details>

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
            Application activity ({logs.length} advanced to Assessment)
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
                      <li key={index}>✅ {step}</li>
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
                    Open at Assessment on Amazon ↗
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
