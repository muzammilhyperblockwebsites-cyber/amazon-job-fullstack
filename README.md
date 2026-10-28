# Amazon UK Job Monitor

Next.js dashboard at https://amazon-job-apply.vercel.app. Active API routes fetch
UK hourly jobs directly from jobsatamazon.co.uk and store preferences, candidate
profiles, CVs and application activity in MongoDB. Use Node.js 24 and configure
.env.local from .env.example. prisma/ and backend-proxy.ts are legacy references.

Run npm ci, npm test, npm run lint, npm run build, then npm start.

## Apply to assessment

1. Install one helper: /amazon-uk-auto-agree.user.js in Tampermonkey, or download
   /amazon-auto-agree-extension.zip. For Chrome/Edge, extract the ZIP, open
   chrome://extensions or edge://extensions, enable Developer mode and Load
   unpacked. Reload the dashboard and Amazon tabs after installation or updates.
2. Sign in directly on Amazon in the same browser. Save candidate details and CV
   on the dashboard. Confirm eligibility answers only after checking them.
3. Allow dashboard pop-ups and click Apply. The dashboard verifies the selected
   shift, transfers candidate fields and CV through the helper's local storage,
   and opens Amazon. Personal details are not put into the URL.
4. The helper fills recognized fields, attaches the saved CV, and uses normal
   Next/Continue controls. It pauses on unknown required questions, login,
   OTP/CAPTCHA, assessment and final submission. A panel on Amazon explains pauses.
   Amazon form changes may require manual input.

Automatic monitoring checks every 12 seconds. Enable it from a click to open a
waiting application tab; the first 100% match starts there. It does not overwrite
an active application when another match arrives. Keep both tabs open. A reload
requires opening a new waiting tab. Application activity records preparation;
only Amazon can confirm reservation, assessment progress and submission.

Helper source is in browser-helper/. Run npm run package:helper after editing it
to update both downloads. Handoffs expire after 30 minutes. The candidate profile
API requires a tool session; Amazon passwords are not needed by the helper.
DOM tests cover fields, CV attachment, shift checks, duplicate clicks and pauses.
They do not submit a real Amazon application.
