# Amazon UK Job Monitor

A Next.js dashboard with a built-in desktop Amazon browser. No extension,
Tampermonkey setup or browser pop-up permission is required for Apply.

## Use the Vercel dashboard with a persistent PC worker

Run `npm ci` once, then double-click **Start Amazon Worker.cmd** on Windows.
It builds and starts a background Node process and writes diagnostics to
`.amazon-session/worker.log`. Starting it twice does not create two workers.
For foreground troubleshooting, run `npm run worker` (Ctrl+C stops it).

The PC and Vercel deployment must use the same `DATABASE_URL` (database
`amazonjobtool`). Set `AUTOMATION_MODE=worker` in `.env.local` if you also want
the local dashboard to control this worker. Vercel always uses the worker queue.
Deploy this version of the dashboard before using online Apply.
Set `APP_URL` (or `WORKER_DASHBOARD_URL`) to the deployed dashboard URL on the PC.
The worker reads the verified public feed through that dashboard and uses its
configured `TOOL_LOGIN_EMAIL`/`TOOL_LOGIN_PASSWORD` to recheck selected shifts.
This avoids depending on direct public API access from the PC network. The
Amazon browser still checks signed-in shift status before proceeding. These are
tool credentials, not Amazon credentials. If no dashboard URL is set, the worker
uses direct public API requests.

Sign into the online dashboard, save filters/profile, and enable automatic
preparation. **PC worker connected** and its last job check appear in Application
Progress. The worker checks saved filters and `autoApplyMinScore` every 12 seconds
while idle, even when the dashboard is closed. Keep the PC powered on, awake,
online and signed into Windows. The browser appears on the worker PC; sign into
Amazon there once, and complete OTP/CAPTCHA/assessment there when requested.
Its saved profile lives in `.amazon-session/worker`; ordinary browser logins do
not establish this session.

Manual Apply queues a request for the worker. Availability is checked again
before opening Amazon. One active task is allowed; assessment and final review
hold that task until you press **Stop automation** to release it. Stop does not
withdraw an Amazon application. Disabling automatic preparation prevents new
automatic launches; use Stop to interrupt an application already in progress.

Queue/progress and attempted shifts are persisted in MongoDB. Automatic polling
does not replay attempted shifts after restart; use manual Apply for an
intentional retry. A task interrupted by a worker restart requires review and
Stop before another application can begin. Queued requests expire after ten
minutes. A lost database heartbeat stops browser actions; an offline worker is
reported after its 60-second lease expires. Requests are never silently kept in
serverless memory. Task history stores progress, not Amazon login credentials.

To start the worker when you sign into Windows, run
`powershell -ExecutionPolicy Bypass -File scripts/install-worker-startup.ps1`.
This creates a shortcut in your own Startup folder. Remove that shortcut to
disable startup. It does not run while Windows is logged out.

## Start the desktop tool

On Windows, double-click Start Amazon Tool.cmd in this folder. It starts the
local dashboard at http://127.0.0.1:3111 and opens it. Node.js 24, this project's
npm dependencies, and Microsoft Edge or Google Chrome are required.

Sign into the tool. Click Apply on a live shift. The tool opens a separate Amazon
browser profile under .amazon-session/desktop and retains its Amazon login.
Complete Amazon login/OTP once if requested. Saved details on Amazon are reused;
optional candidate details and a CV can also be saved in the dashboard.

The built-in runner checks both public schedule availability and the signed-in
application service's ACTIVE status. It uses Amazon's normal Start, I Agree,
Next and Continue controls. It fills recognized fields and attaches a saved CV.
It pauses at assessment, final submission, CAPTCHA/OTP or unanswered questions.
It never disables Amazon's checks or fabricates a reservation. Application
Progress only confirms shift acceptance after a successful Amazon response
contains the exact job, schedule and application ID. Stop automation leaves the
Amazon tab open and does not withdraw the application.

The Vercel-hosted dashboard uses the MongoDB queue to control the PC worker.
Serverless requests never own a browser or a background polling timer. The local
desktop flow is also available with `AUTOMATION_MODE` unset; that mode needs the
dashboard tab open for automatic checks.

## Availability and old jobs

Jobs come directly from jobsatamazon.co.uk. A shift rejected by Amazon's signed-in
application service is temporarily excluded from the local feed. DELETE /api/jobs
requires a tool session and recoverably archives unavailable saved activity and
old non-hourly Job records. Profiles, CVs and browser-confirmed applications are
preserved. Failed availability checks never justify deleting a saved job.

## Development

Configure .env.local using .env.example, then run npm ci and npm run dev.
Verification: npm test, npm run lint, npm run build, npm run build:worker. Tests include a real local
Chrome/Edge engine with intercepted synthetic Amazon pages: no real application
is submitted. The flow reaches assessment without an extension or manual I Agree,
and refuses an inactive shift even if public search shows remaining slots.
Worker tests cover concurrent queue requests, saved score thresholds, dashboard
independence, cancellation, worker ownership, restart recovery and expired leases.

The shared browser runner is browser-helper/content.js. Legacy extension and
userscript downloads remain available for compatibility but are not used by the
normal Apply flow. npm run package:helper refreshes those legacy artifacts.
