"use client";
import { useCallback, useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api-response";
type Task = { id: string; title: string; stage: string; message: string; shiftReserved: boolean; active?: boolean; stopRequested?: boolean };
export default function ApplicationProgress() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState("");
  const [worker, setWorker] = useState<{ message: string; lastSeen: string | null; lastChecked: string | null } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await readApiResponse(await fetch("/api/desktop", { cache: "no-store" }));
      setAvailable(data.available); setTasks(data.tasks || []); setError("");
      setWorker(data.mode === "worker" ? { message: data.message, lastSeen: data.lastSeen, lastChecked: data.lastChecked } : null);
    } catch (error) { setError(error instanceof Error ? error.message : "Application progress unavailable"); }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => { void refresh(); }, 2000);
    window.addEventListener("application-progress-refresh", refresh);
    return () => { clearInterval(timer); window.removeEventListener("application-progress-refresh", refresh); };
  }, [refresh]);
  async function stop(id: string) {
    try { await readApiResponse(await fetch(`/api/desktop?id=${encodeURIComponent(id)}`, { method: "DELETE" })); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not stop automation"); }
  }
  return <div className="space-y-2">
    {worker && <div role="status" className={`rounded-lg p-3 text-sm ${available ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
      <p className="font-semibold">PC worker {available ? "connected" : "offline"}</p>
      <p>{worker.message}</p>
      {worker.lastSeen && <p>Last heartbeat: {new Date(worker.lastSeen).toLocaleString()}</p>}
      {worker.lastChecked && <p>Last job check: {new Date(worker.lastChecked).toLocaleString()}</p>}
      <p>Login, OTP and assessment are completed in the Amazon browser on the worker PC.</p>
    </div>}
    {!available && !worker && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Run <strong>Start Amazon Tool.cmd</strong> on your computer, then <a href="http://127.0.0.1:3111" className="underline">open the desktop tool</a>.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {tasks.length > 0 && <h3 className="text-sm font-semibold">Application Progress</h3>}
    {tasks.slice(0, 5).map(task => <div key={task.id} className="rounded-lg border p-3 text-sm space-y-1">
      <p className="font-medium">{task.title}</p><p role="status">{task.message}</p>
      <p className={task.shiftReserved ? "text-green-700" : "text-amber-800"}>{task.shiftReserved ? "Selected shift accepted by Amazon" : "Shift acceptance not yet confirmed by Amazon"}</p>
      {(task.active ?? !["assessment_ready", "shift_unavailable", "failed", "stopped"].includes(task.stage)) && <button type="button" disabled={task.stopRequested} onClick={() => void stop(task.id)} className="text-blue-700 underline disabled:opacity-50">{task.stopRequested ? "Waiting for worker to stop" : "Stop automation"}</button>}
    </div>)}
  </div>;
}
