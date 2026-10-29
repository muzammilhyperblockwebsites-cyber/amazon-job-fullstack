import type { NextRequest } from "next/server";
import { authenticatedToolUser } from "./tool-session";
import { automationDb, enqueueApplication, initializeAutomation, publicTask, requestTaskStop, TASKS, workerStatus, type AutomationTask } from "./automation-store";

export async function handleWorkerRequest(req: NextRequest): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const capability = req.method === "GET" && req.nextUrl.searchParams.get("capability") === "1";
  if (!capability && !authenticatedToolUser(req)) return Response.json({ error: "Sign in to control the PC worker." }, { status: 401, headers });
  try {
    const db = await automationDb();
    if (req.method === "GET") {
      const status = await workerStatus(db);
      if (capability) return Response.json(status, { headers });
      const id = req.nextUrl.searchParams.get("id");
      if (id) {
        const task = await db.collection<AutomationTask>(TASKS).findOne({ _id: id });
        return Response.json(task ? { task: publicTask(task) } : { error: "Application task not found." }, { status: task ? 200 : 404, headers });
      }
      const tasks = await db.collection<AutomationTask>(TASKS).find({}).sort({ createdAt: -1 }).limit(20).toArray();
      return Response.json({ ...status, tasks: tasks.map(publicTask) }, { headers });
    }
    if (req.method === "DELETE") {
      const task = await requestTaskStop(db, req.nextUrl.searchParams.get("id") || "");
      return Response.json(task ? { task: publicTask(task) } : { error: "Application task not found." }, { status: task ? 200 : 404, headers });
    }
    const status = await workerStatus(db);
    if (!status.available) return Response.json({ error: status.message }, { status: 503, headers });
    const body = await req.json();
    await initializeAutomation(db);
    const task = await enqueueApplication(db, {
      id: String(body.jobId || body.id || ""), scheduleId: String(body.scheduleId || ""),
      title: String(body.title || "Amazon UK Associate").slice(0, 300), location: String(body.location || "United Kingdom").slice(0, 300),
    }, "manual");
    return Response.json({ task: publicTask(task), message: task.message }, { status: 202, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PC worker unavailable.";
    return Response.json({ error: message }, { status: message.includes("already running") ? 409 : message.includes("required") || error instanceof SyntaxError ? 400 : 503, headers });
  }
}
