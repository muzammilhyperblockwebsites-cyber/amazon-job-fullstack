import type { BrowserContext, Page } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Stage = "starting" | "running" | "needs_input" | "waiting_login" | "shift_unavailable" | "assessment_ready" | "failed" | "stopped";
export type BrowserTask = { id: string; jobId: string; scheduleId: string; title: string; stage: Stage; message: string; shiftReserved: boolean; applicationId?: string; updatedAt: string };
type InternalTask = BrowserTask & { page?: Page; timer?: ReturnType<typeof setInterval>; busy?: boolean; startedAt: number; loginResumes?: number; leaseExpiresAt?: number };
type Launch = { jobId: string; scheduleId: string; title: string; applyUrl: string; profile: Record<string, unknown>; leaseExpiresAt?: number };
type State = { context?: BrowserContext; opening?: Promise<BrowserContext>; starting: boolean; tasks: Map<string, InternalTask> };
const globals = globalThis as typeof globalThis & { amazonDesktopBrowser?: State };
const state: State = globals.amazonDesktopBrowser ??= { starting: false, tasks: new Map<string, InternalTask>() };
const terminal = new Set<Stage>(["shift_unavailable", "assessment_ready", "failed", "stopped"]);

export function desktopCapability() {
  return { service: "amazon-job-monitor", available: !process.env.VERCEL, mode: "desktop", localUrl: "http://127.0.0.1:3111", message: process.env.VERCEL ? "Open the desktop tool to launch its Amazon browser. This hosted server cannot open a window on your computer." : "The tool opens its own Amazon browser. No extension or userscript is required." };
}

function snapshot(task: InternalTask): BrowserTask {
  const { id, jobId, scheduleId, title, stage, message, shiftReserved, applicationId, updatedAt } = task;
  return { id, jobId, scheduleId, title, stage, message, shiftReserved, applicationId, updatedAt };
}
export function browserTasks(): BrowserTask[] { return [...state.tasks.values()].map(snapshot).reverse(); }
export function browserTask(id: string): BrowserTask | null { const task = state.tasks.get(id); return task ? snapshot(task) : null; }
function update(task: InternalTask, stage: Stage, message: string) {
  task.stage = stage; task.message = message; task.updatedAt = new Date().toISOString();
  if (terminal.has(stage) && task.timer) { clearInterval(task.timer); task.timer = undefined; }
}

async function browser(): Promise<BrowserContext> {
  if (state.context) return state.context;
  if (state.opening) return state.opening;
  state.opening = (async () => {
    // Loading the desktop driver at route startup can crash serverless deployments.
    // Hosted capability/status requests must never initialize Playwright.
    const { chromium } = await import("playwright-core");
    const candidates = process.platform === "win32" ? [
      path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
      path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    ] : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"] : ["/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
    const executablePath = candidates.find(candidate => existsSync(candidate));
    if (!executablePath) throw new Error("Install Microsoft Edge or Google Chrome, then retry. No extension is needed.");
    const context = await chromium.launchPersistentContext(path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.AMAZON_BROWSER_PROFILE || ".amazon-session/desktop"), {
      executablePath, headless: false, viewport: null, locale: "en-GB", timeout: 30000,
    });
    context.on("close", () => {
      state.context = undefined;
      for (const task of state.tasks.values()) if (!terminal.has(task.stage)) update(task, "stopped", "Amazon browser closed. Click Apply to reopen your saved session.");
    });
    state.context = context;
    return context;
  })();
  try { return await state.opening; } finally { state.opening = undefined; }
}

// Only successful Amazon responses with the exact selected job/shift can confirm acceptance.
export function acceptedApplication(value: unknown, jobId: string, scheduleId: string): string | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.errorCode || data.errorMessage || data.errors) return null;
  const selected = data.jobScheduleSelected as Record<string, unknown> | undefined;
  if (typeof data.applicationId === "string" && selected?.jobId === jobId && selected?.scheduleId === scheduleId) return data.applicationId;
  for (const key of ["application", "applicationData", "data", "result"]) {
    const found = acceptedApplication(data[key], jobId, scheduleId); if (found) return found;
  }
  return null;
}

export async function startBrowserApplication(input: Launch, onUnavailable?: () => void): Promise<BrowserTask> {
  if (!desktopCapability().available) throw new Error(desktopCapability().message);
  if (state.starting || [...state.tasks.values()].some(task => !terminal.has(task.stage))) throw new Error("An Amazon application is already running. Complete it or stop it in Application Progress before starting another.");
  const url = new URL(input.applyUrl);
  if (url.origin !== "https://www.jobsatamazon.co.uk") throw new Error("An official Amazon UK application link is required.");
  state.starting = true;
  const task: InternalTask = { id: randomUUID(), jobId: input.jobId, scheduleId: input.scheduleId, title: input.title, stage: "starting", message: "Opening the tool's Amazon browser…", shiftReserved: false, updatedAt: new Date().toISOString(), startedAt: Date.now() };
  state.tasks.set(task.id, task);
  for (const [id, old] of state.tasks) if (terminal.has(old.stage) && Date.now() - old.startedAt > 24 * 60 * 60 * 1000) state.tasks.delete(id);
  try {
    const context = await browser();
    const page = await context.newPage();
    task.page = page;
    page.on("close", () => { if (!terminal.has(task.stage)) update(task, "stopped", "Application tab closed. Your Amazon session is saved."); });
    page.on("response", async response => {
      try {
        const responseUrl = new URL(response.url());
        if (responseUrl.origin !== "https://www.jobsatamazon.co.uk" || !responseUrl.pathname.startsWith("/application/api/") || !/create-application|update-application|get-application/.test(responseUrl.pathname) || !response.ok() || terminal.has(task.stage)) return;
        const applicationId = acceptedApplication(await response.json(), task.jobId, task.scheduleId);
        if (applicationId) { task.applicationId = applicationId; task.shiftReserved = true; update(task, "running", "Amazon accepted the selected shift. Continuing to assessment…"); }
      } catch { /* Non-JSON responses are not reservation evidence. */ }
    });
    const source = readFileSync(path.join(process.cwd(), "browser-helper/content.js"), "utf8");
    const launch = { ...input, leaseId: task.id, expiresAt: Date.now() + 30 * 60 * 1000 };
    task.leaseExpiresAt = input.leaseExpiresAt;
    if (input.leaseExpiresAt) await page.exposeFunction("__amazonMonitorWorkerLease", () => task.leaseExpiresAt);
    await page.addInitScript({ content: `(async function(managedLaunch){if(managedLaunch.leaseExpiresAt){try{managedLaunch.leaseExpiresAt=await window.__amazonMonitorWorkerLease();}catch{return;}}${source}\n})(${JSON.stringify(launch)});` });
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.bringToFront();
    update(task, "running", "Amazon browser opened. The tool will click I Agree and continue. Sign in once if Amazon asks.");
    task.timer = setInterval(async () => {
      if (task.busy || terminal.has(task.stage)) return;
      task.busy = true;
      try {
        if (Date.now() - task.startedAt > 30 * 60 * 1000) { await stopBrowserTask(task.id); return; }
        const current = new URL(page.url());
        if (task.stage === "waiting_login" && current.origin === "https://www.jobsatamazon.co.uk" && current.pathname.startsWith("/app") && !/login|signin|sign-in/.test(current.hash) && (task.loginResumes || 0) < 3) {
          const signedIn = await page.evaluate(() => Boolean(localStorage.getItem("accessToken")));
          if (signedIn) { task.loginResumes = (task.loginResumes || 0) + 1; await page.goto(input.applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 }); }
        }
        const status = await page.locator("#amazon-monitor-helper-status").evaluate(element => ({ stage: (element as HTMLElement).dataset.stage, message: element.textContent || "" }), { timeout: 3000 }).catch(() => null);
        if (status?.message) {
          update(task, (status.stage as Stage) || "running", status.message);
          if (task.stage === "shift_unavailable") onUnavailable?.();
        }
        else if (/\/login|\/signin|\/sign-in/.test(page.url())) update(task, "waiting_login", "Sign in or complete OTP in the Amazon browser. Automation resumes afterwards.");
      } catch { /* Navigation can briefly detach the page. */ }
      finally { task.busy = false; }
    }, 1000);
    return snapshot(task);
  } catch (error) {
    update(task, "failed", error instanceof Error ? error.message : "Amazon browser could not start.");
    if (task.page && !task.page.isClosed()) await task.page.close().catch(() => {});
    throw error;
  } finally { state.starting = false; }
}

export async function stopBrowserTask(id: string): Promise<BrowserTask | null> {
  const task = state.tasks.get(id); if (!task) return null;
  update(task, "stopped", "Automation stopped. No Amazon application was withdrawn.");
  if (task.page && !task.page.isClosed()) {
    await task.page.evaluate(() => { window.dispatchEvent(new Event("amazon-monitor-stop")); }).catch(() => {});
  }
  return snapshot(task);
}

export async function renewBrowserLease(expiresAt: number) {
  for (const task of state.tasks.values()) if (task.leaseExpiresAt && !terminal.has(task.stage)) task.leaseExpiresAt = expiresAt;
  if (!state.context) return;
  await Promise.all(state.context.pages().map(page => page.evaluate(deadline => {
    const scope = globalThis as typeof globalThis & { __amazonWorkerLeaseKey?: string };
    if (scope.__amazonWorkerLeaseKey) sessionStorage.setItem(scope.__amazonWorkerLeaseKey, String(deadline));
  }, expiresAt).catch(() => {})));
}

export async function closeBrowser() {
  for (const task of state.tasks.values()) if (!terminal.has(task.stage)) await stopBrowserTask(task.id);
  const context = state.context || await state.opening?.catch(() => undefined);
  await context?.close();
}
