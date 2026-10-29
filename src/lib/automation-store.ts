import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { getDb } from "./uk-hourly-fallback";
import type { BrowserTask } from "./desktop-browser";

export const LEASE_MS = 60_000;
export const TASKS = "AutomationTask";
export const WORKERS = "AutomationWorker";
export type QueuedJob = { id: string; scheduleId: string; title: string; location: string; category?: string; jobType?: string };
export type AutomationTask = Omit<BrowserTask, "stage"> & {
  _id: string; stage: BrowserTask["stage"] | "queued" | "interrupted";
  active: boolean; stopRequested: boolean; source: "manual" | "automatic";
  job: QueuedJob; createdAt: string; owner?: string;
};
export type WorkerRecord = {
  _id: string; owner: string; leaseUntil: Date; updatedAt: string;
  message: string; lastChecked?: string; autoEnabled?: boolean;
};

export function usesWorker() { return Boolean(process.env.VERCEL) || process.env.AUTOMATION_MODE === "worker"; }
export async function automationDb(): Promise<Db> {
  if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL on both the dashboard and worker.");
  const db = await getDb();
  if (!db) throw new Error("Automation database unavailable. No application was queued.");
  return db;
}
export async function initializeAutomation(db: Db) {
  // One active application across dashboard requests, worker cycles and restarts.
  await db.collection<AutomationTask>(TASKS).createIndex({ active: 1 }, { unique: true, partialFilterExpression: { active: true } });
  await db.collection<AutomationTask>(TASKS).createIndex({ jobId: 1, scheduleId: 1 });
}
export function publicTask(task: AutomationTask) {
  const { id, jobId, scheduleId, title, stage, message, shiftReserved, applicationId, updatedAt, active, stopRequested } = task;
  return { id, jobId, scheduleId, title, stage, message, shiftReserved, applicationId, updatedAt, active, stopRequested };
}
export async function workerStatus(db: Db) {
  const worker = await db.collection<WorkerRecord>(WORKERS).findOne({ _id: "browser" });
  const available = Boolean(worker && worker.leaseUntil.getTime() > Date.now());
  return { service: "amazon-job-monitor", mode: "worker", available, backgroundMonitoring: true,
    message: available ? worker!.message : "PC worker is offline. Run Start Amazon Worker.cmd on your PC and keep it awake.",
    lastSeen: worker?.updatedAt || null, lastChecked: worker?.lastChecked || null, autoEnabled: worker?.autoEnabled || false };
}
export async function enqueueApplication(db: Db, job: QueuedJob, source: AutomationTask["source"]) {
  if (!/^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/.test(job.id) || !/^[A-Za-z0-9_-]{1,160}$/.test(job.scheduleId)) throw new Error("A valid job and selected schedule are required.");
  const tasks = db.collection<AutomationTask>(TASKS);
  const existing = await tasks.findOne({ active: true });
  if (existing) {
    if (existing.jobId === job.id && existing.scheduleId === job.scheduleId) return existing;
    throw new Error("An application is already running or awaiting your review. Stop it in Application Progress before starting another.");
  }
  const id = randomUUID(), now = new Date().toISOString();
  const task: AutomationTask = { _id: id, id, jobId: job.id, scheduleId: job.scheduleId, title: job.title,
    stage: "queued", message: "Queued for the PC worker. The Amazon browser opens on that PC.",
    shiftReserved: false, active: true, stopRequested: false, source, job, updatedAt: now, createdAt: now };
  try { await tasks.insertOne(task); }
  catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const concurrent = await tasks.findOne({ active: true });
    if (concurrent?.jobId === job.id && concurrent.scheduleId === job.scheduleId) return concurrent;
    throw new Error("An application is already running. Review Application Progress.");
  }
  return task;
}
export async function requestTaskStop(db: Db, id: string) {
  const tasks = db.collection<AutomationTask>(TASKS);
  // A queued task has never opened Amazon and can be cancelled immediately.
  await tasks.updateOne({ _id: id, active: true, stage: "queued" }, { $set: {
    stage: "stopped", active: false, stopRequested: true, message: "Queued application cancelled.", updatedAt: new Date().toISOString(),
  } });
  await tasks.updateOne({ _id: id, active: true }, { $set: { stopRequested: true, message: "Stop requested. Waiting for the PC worker to confirm.", updatedAt: new Date().toISOString() } });
  return tasks.findOne({ _id: id });
}

export async function acquireWorker(db: Db, owner: string) {
  const now = new Date();
  try {
    return await db.collection<WorkerRecord>(WORKERS).findOneAndUpdate(
      { _id: "browser", $or: [{ owner }, { leaseUntil: { $lte: now } }] },
      { $set: { owner, leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now.toISOString(), message: "PC worker connected." } },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) { if ((error as { code?: number }).code === 11000) return null; throw error; }
}
export async function renewWorker(db: Db, owner: string, status: Pick<WorkerRecord, "message" | "lastChecked" | "autoEnabled">) {
  const now = new Date();
  return db.collection<WorkerRecord>(WORKERS).findOneAndUpdate(
    { _id: "browser", owner, leaseUntil: { $gt: now } },
    { $set: { ...status, leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now.toISOString() } },
    { returnDocument: "after" },
  );
}
