# Amazon Job Monitor frontend

Next.js dashboard hosted on Vercel at https://amazon-job-apply.vercel.app.

All `/api/*` routes use the authenticated server-side gateway to the Heroku backend. The frontend does not connect to MongoDB or launch a browser worker. Runtime settings are in `.env.example`; the backend key belongs in Vercel's Production environment variables, never a `NEXT_PUBLIC_` variable.

```text
npm ci
npm run build
npm run lint
npm start
```

Use Node.js 24.x and `frontend` as the Vercel project root. See the workspace's `backend/DEPLOYMENT.md` for Config Vars, database migration, login and verification steps. `frontend/prisma` is retained only as a legacy schema reference; database commands and seeds run from `backend`.

Local development requires a local backend with matching `BACKEND_API_KEY`. Set frontend `APP_URL=http://localhost:3000`, `BACKEND_URL=http://localhost:4000`, and backend `FRONTEND_URL=http://localhost:3000` before running both development servers. Production `.env` URLs currently point to the hosted domains.
