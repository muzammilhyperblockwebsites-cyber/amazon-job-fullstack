import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { NextRequest } from "next/server";
import { acquireWorker, automationDb, enqueueApplication, initializeAutomation, renewWorker, TASKS, WORKERS, type AutomationTask, type WorkerRecord } from "./automation-store";
import { browserTask, closeBrowser, renewBrowserLease, startBrowserApplication, stopBrowserTask } from "./desktop-browser";
import { fetchAllUKHourlyJobs, getStoredPreferences, handleAgentFallback, handleJobApplyFallback, markScheduleUnavailable, passesHardFilters, scoreJob } from "./uk-hourly-fallback";

export class AutomationWorker {
  readonly owner = randomUUID();
  private localTask?: { queueId: string; browserId: string };
  private leaseUntil = 0;
  private stopped = false;
  private checking = false;
  private heartbeatBusy = false;
  private lastPoll = 0;
  private status: Pick<WorkerRecord, "message" | "lastChecked" | "autoEnabled"> = { message: "Worker ready. Enable automatic preparation in the dashboard.", autoEnabled: false };
  constructor(private db: Db) {}

  async start() {
    await initializeAutomation(this.db);
    const lease = await acquireWorker(this.db, this.owner);
    if (!lease) throw new Error("Another PC worker is already connected. Stop it before starting this one.");
    this.leaseUntil = lease.leaseUntil.getTime();
    // Never repeat a browser action whose outcome became unknown during a crash.
    await this.db.collection<AutomationTask>(TASKS).updateMany({ active: true, stage: { $ne: "queued" } }, { $set: {
      stage: "interrupted", message: "Worker restarted. Review the saved Amazon application before releasing this task with Stop automation.", owner: this.owner, updatedAt: new Date().toISOString(),
    } });
  }
  async heartbeat() {
    if (this.stopped || this.heartbeatBusy) return;
    this.heartbeatBusy = true;
    try {
      const lease = await renewWorker(this.db, this.owner, this.status);
      if (!lease) throw new Error("Worker ownership expired.");
      this.leaseUntil = lease.leaseUntil.getTime();
      await renewBrowserLease(this.leaseUntil - 10_000);
    } catch {
      // Fail closed: do not allow a second worker and an old browser to click together.
      this.stopped = true;
      await closeBrowser();
      throw new Error("Worker database connection lost. Browser closed; restart the worker to review progress.");
    } finally { this.heartbeatBusy = false; }
  }
  async cycle() {
    if (this.stopped || this.checking) return;
    this.checking = true;
    const tasks = this.db.collection<AutomationTask>(TASKS);
    try {
      let active = await tasks.findOne({ active: true });
      if (active?.stopRequested) {
        if (this.localTask?.queueId === active.id) await stopBrowserTask(this.localTask.browserId);
        await tasks.updateOne({ _id: active.id, active: true }, { $set: { active: false, stage: "stopped", message: "Automation stopped. No application was withdrawn.", updatedAt: new Date().toISOString() } });
        this.localTask = undefined;
        return;
      }
      if (this.localTask) {
        const snapshot = browserTask(this.localTask.browserId);
        if (snapshot) {
          const { id: _browserId, ...progress } = snapshot;
          void _browserId;
          const finished = ["failed", "stopped", "shift_unavailable"].includes(progress.stage);
          await tasks.updateOne({ _id: this.localTask.queueId, owner: this.owner, active: true, stopRequested: false }, { $set: { ...progress, active: !finished } });
          // Assessment remains active until explicitly released, preventing another application.
          if (finished) this.localTask = undefined;
        }
        return;
      }
      if (active?.stage === "queued") {
        active = await tasks.findOneAndUpdate({ _id: active.id, active: true, stage: "queued", stopRequested: false }, { $set: { stage: "starting", owner: this.owner, message: "PC worker is checking the selected shift.", updatedAt: new Date().toISOString() } }, { returnDocument: "after" });
        if (active) await this.launch(active);
        return;
      }
      if (active || Date.now() - this.lastPoll < 12_000) return;
      this.lastPoll = Date.now();
      const prefs = await getStoredPreferences();
      this.status.autoEnabled = Boolean(prefs.autoApplyEnabled);
      if (!prefs.autoApplyEnabled) { this.status.message = "PC worker connected. Automatic preparation is disabled."; return; }
      const { jobs } = await fetchAllUKHourlyJobs();
      this.status.lastChecked = new Date().toISOString();
      const minimum = Math.max(0, Math.min(100, prefs.autoApplyMinScore ?? 100));
      const matching = jobs.filter(job => passesHardFilters(job, prefs) && scoreJob(job, prefs) >= minimum)
        .sort((a, b) => scoreJob(b, prefs) - scoreJob(a, prefs));
      for (const job of matching) {
        // Persisted attempts survive worker/dashboard restarts. Manual Apply allows an intentional retry.
        if (await tasks.findOne({ jobId: job.id, scheduleId: job.scheduleId })) continue;
        // Re-read the switch after the potentially slow availability check.
        if (this.stopped || !(await getStoredPreferences()).autoApplyEnabled) return;
        await enqueueApplication(this.db, job, "automatic");
        this.status.message = "Matching shift queued for the PC browser.";
        return;
      }
      this.status.message = "Monitoring on this PC every 12 seconds. No unattempted matching shift available.";
    } catch (error) {
      this.status.message = error instanceof Error ? error.message : "Worker check failed; retrying.";
      console.error(this.status.message);
    } finally { this.checking = false; }
  }
  private async launch(task: AutomationTask) {
    const tasks = this.db.collection<AutomationTask>(TASKS);
    try {
      if (task.source === "automatic" && !(await getStoredPreferences()).autoApplyEnabled) {
        await tasks.updateOne({ _id: task.id, owner: this.owner }, { $set: { stage: "stopped", active: false, message: "Automatic preparation was disabled before this task started.", updatedAt: new Date().toISOString() } });
        return;
      }
      if (Date.now() - Date.parse(task.createdAt) > 10 * 60_000) throw new Error("Queued request expired. Refresh availability and click Apply again.");
      const req = new NextRequest("http://localhost/api/desktop");
      const agent = await (await handleAgentFallback(req)).json();
      const profile = agent.profile || {};
      if (profile.aiFormFillerEnabled === false || profile.autoClickNextEnabled === false) throw new Error("Enable form filling and automatic Next in your candidate profile.");
      if (profile.cvFileName && !profile.cvBase64) throw new Error("Re-upload and save your CV before starting automation.");
      const prepared = await handleJobApplyFallback(req, JSON.stringify(task.job));
      const result = await prepared.json();
      if (!prepared.ok) throw new Error(result.error || "Shift could not be verified.");
      const current = await tasks.findOne({ _id: task.id, active: true, stopRequested: false, owner: this.owner });
      if (!current || this.stopped || Date.now() >= this.leaseUntil - 10_000) return;
      const browser = await startBrowserApplication({ jobId: task.jobId, scheduleId: task.scheduleId, title: task.title, applyUrl: result.applyUrl, profile, leaseExpiresAt: this.leaseUntil - 10_000 }, () => markScheduleUnavailable(task.jobId, task.scheduleId));
      if (this.stopped) { await closeBrowser(); return; }
      this.localTask = { queueId: task.id, browserId: browser.id };
    } catch (error) {
      await tasks.updateOne({ _id: task.id, owner: this.owner }, { $set: { stage: "failed", active: false, message: error instanceof Error ? error.message : "Browser launch failed.", updatedAt: new Date().toISOString() } });
    }
  }
  async stop() {
    this.stopped = true;
    await closeBrowser();
    await this.db.collection<WorkerRecord>(WORKERS).updateOne({ _id: "browser", owner: this.owner }, { $set: { leaseUntil: new Date(0), message: "PC worker stopped.", updatedAt: new Date().toISOString() } });
  }
}

export async function runWorker() {
  if (process.env.VERCEL) throw new Error("Run this worker on your PC, outside Vercel.");
  process.env.AMAZON_BROWSER_PROFILE ||= ".amazon-session/worker";
  const worker = new AutomationWorker(await automationDb());
  await worker.start();
  console.log("PC worker connected. Keep this PC awake. Amazon login/OTP and assessment happen in its browser.");
  const heartbeat = setInterval(() => { void worker.heartbeat().catch(async error => { console.error(error.message); clearInterval(cycle); clearInterval(heartbeat); await worker.stop().catch(() => {}); process.exit(1); }); }, 5000);
  const cycle = setInterval(() => { void worker.cycle(); }, 1000);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    clearInterval(cycle); clearInterval(heartbeat);
    void worker.stop().finally(() => process.exit(0));
  });
  await worker.cycle();
}
