"use client";
import { useCallback, useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api-response";
type Task = { id: string; title: string; stage: string; message: string; shiftReserved: boolean };
export default function ApplicationProgress() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const data = await readApiResponse(await fetch("/api/desktop", { cache: "no-store" }));
      setAvailable(data.available); setTasks(data.tasks || []); setError("");
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
    {!available && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Run <strong>Start Amazon Tool.cmd</strong> on your computer, then <a href="http://127.0.0.1:3111" className="underline">open the desktop tool</a>. This hosted dashboard cannot open your computer&apos;s Amazon browser.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {tasks.length > 0 && <h3 className="text-sm font-semibold">Application Progress</h3>}
    {tasks.slice(0, 5).map(task => <div key={task.id} className="rounded-lg border p-3 text-sm space-y-1">
      <p className="font-medium">{task.title}</p><p role="status">{task.message}</p>
      <p className={task.shiftReserved ? "text-green-700" : "text-amber-800"}>{task.shiftReserved ? "Selected shift accepted by Amazon" : "Shift acceptance not yet confirmed by Amazon"}</p>
      {!["assessment_ready", "shift_unavailable", "failed", "stopped"].includes(task.stage) && <button type="button" onClick={() => void stop(task.id)} className="text-blue-700 underline">Stop automation</button>}
    </div>)}
  </div>;
}
