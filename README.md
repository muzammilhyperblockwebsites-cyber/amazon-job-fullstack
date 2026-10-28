# Amazon UK Job Monitor

A Next.js dashboard with a built-in desktop Amazon browser. No extension,
Tampermonkey setup or browser pop-up permission is required for Apply.

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

The Vercel-hosted dashboard can monitor jobs, but a serverless cloud function
cannot open a window on your computer. Use Start Amazon Tool.cmd for the desktop
browser flow. The hosted dashboard links to the local tool when needed.

## Availability and old jobs

Jobs come directly from jobsatamazon.co.uk. A shift rejected by Amazon's signed-in
application service is temporarily excluded from the local feed. DELETE /api/jobs
requires a tool session and recoverably archives unavailable saved activity and
old non-hourly Job records. Profiles, CVs and browser-confirmed applications are
preserved. Failed availability checks never justify deleting a saved job.

## Development

Configure .env.local using .env.example, then run npm ci and npm run dev.
Verification: npm test, npm run lint, npm run build. Tests include a real local
Chrome/Edge engine with intercepted synthetic Amazon pages: no real application
is submitted. The flow reaches assessment without an extension or manual I Agree,
and refuses an inactive shift even if public search shows remaining slots.

The shared browser runner is browser-helper/content.js. Legacy extension and
userscript downloads remain available for compatibility but are not used by the
normal Apply flow. npm run package:helper refreshes those legacy artifacts.
