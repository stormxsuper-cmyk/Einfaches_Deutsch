# 🇩🇪 Einfaches Deutsch — Zero to B2

An educational web-app foundation using a structured, CEFR-informed curriculum. The project now includes a 54-unit curriculum map across Foundation (pre-A1), A1, A2, B1, and B2; a React curriculum explorer; an Express API; PostgreSQL schema for learning content and learner evidence; and initial spaced-repetition, planning, and placement engines.

## Honest scope
This is an improved MVP foundation, **not yet a complete or validated B2 course**. The 54-unit map specifies topics, outcomes, and assessment ideas; it does not mean every unit already has finished lessons, original exercise banks, audio, grading rubrics, and calibrated level exams. Accounts (Supabase Auth), JWT verification on the API and cross-device sync are implemented but have not been run against a live database or auth project in the build environment; test them (`npm run migrate`, `npm test`, `npm run test:rls`) before any public deployment.

## Requirements
- Docker Desktop / Docker Engine with Compose
- Ports 3000, 4000, 5432 available

## Run

### A) Frontend only (fastest — no Docker, no database)
1. `cd frontend`
2. `npm install`
3. `npm run dev`
4. Open the printed URL (`http://localhost:3000`).

The API and database are optional here: the UI renders either way and shows "API offline · demo content available" when the backend is not running. Without `frontend/.env.local` (copy `frontend/.env.example`) the app shows **Accounts are not configured** instead of the sign-in form — accounts need a Supabase project.

**Demo mode:** the sign-in screen always offers *Explore in demo mode — no account needed*. It opens the full app (dashboard, curriculum, interactive reading) with no Supabase project and no backend; progress stays in that browser only and is never synced. Creating an account or signing in replaces demo mode.


To deploy, run `npm run build` and serve the generated `frontend/dist` folder from any static host (never serve `index.html` directly: it loads `/src/main.tsx`, which a browser can only execute through Vite or a build).

### B) Full stack (frontend + API + PostgreSQL)
1. Copy `.env.example` to `.env` and set a strong local development password.
2. From this directory run `docker compose up --build`.
3. Open `http://localhost:3000`.
4. API health: `http://localhost:4000/api/health`.
5. Curriculum JSON: `http://localhost:4000/api/curriculum`.
6. Stop with `docker compose down`. `docker compose down -v` deletes local database data.

### C) Backend only (without Docker)
`cd backend && npm install && npm run dev` (needs `DATABASE_URL`), then `npm run migrate` to apply `database/01..04`.

## Deploy (Railway / any Node host)

The repo root is an npm workspace, so **one service serves the whole app**: the API also serves the
built frontend from the same origin, which means no CORS setup and no `VITE_API_URL` are needed.

Railpack detects a Node app only if a `package.json` exists in the directory it builds. It then runs
the `build` script and uses the `start` script as the start command — both are defined in the root
`package.json`:

```
npm install        # installs backend + frontend (workspaces)
npm run build      # tsc for the API, vite build for the frontend
npm start          # node backend/dist/server.js  (serves frontend/dist + /api)
```

### Railway, step by step
1. **New project → Deploy from GitHub repo** and pick this repository.
2. Service **Settings**:
   - **Root Directory**: leave it **empty / `/`** (the root `package.json` must be visible — a
     root directory of `frontend` or `backend` is what makes Railpack fail to detect the app).
   - **Custom Start Command / Build Command**: **clear them**. A leftover value such as `start.sh`
     produces `⚠ Script start.sh not found`.
   - Builder: Railpack or Nixpacks both work; Docker is not required.
3. **Variables** (Variables tab):
   | Variable | Value | Why |
   |---|---|---|
   | `ALLOW_UNAUTHENTICATED` | `1` | Without Supabase the API refuses to start in production; this opts into public content + demo mode |
   | `TRUST_PROXY` | `1` | Railway sits behind a proxy, so rate limiting sees real client IPs |
   | `DATABASE_URL` | *(from the Postgres plugin)* | Optional — see step 5 |
   | `SUPABASE_URL`, `SUPABASE_JWT_SECRET` | *(from Supabase)* | Required for real accounts; replaces `ALLOW_UNAUTHENTICATED` |
4. **Settings → Networking → Generate Domain**, then open it. `/` serves the app, `/api/health` the API.
5. **Database (optional).** Add the Postgres plugin, reference its `DATABASE_URL`, then apply the
   schema once: `railway run --service <api> npm run migrate` (or set a pre-deploy command
   `npm run migrate`). Until then the app still runs: `/api/health` reports
   `"database":"not_configured"` and the curriculum is served from JSON.

### Deploying the frontend separately
If you prefer two services, set each service's Root Directory (`/frontend`, `/backend`) and wire:
`VITE_API_URL=https://<api-domain>/api` on the frontend (**at build time** — Vite inlines it), and
`FRONTEND_ORIGIN=https://<frontend-domain>` on the API (the API rejects any other origin).

PostgreSQL initialization scripts run only when the data volume is first created. For an existing database, apply schema changes through migrations; do not delete volumes unless you intend to delete local data.

## API
- `GET /api/health` — API/database health and curriculum counts
- `GET /api/curriculum` — complete structured curriculum
- `GET /api/curriculum/levels` — level summary
- `GET /api/curriculum/modules/:id` — one unit by ID, e.g. `A1-01`
- `GET /api/knowledge` — curriculum modules as knowledge items
- `GET /api/goethe/resources` — official resource link and copyright policy
- `POST /api/mastery/review` — SM-2-style review scheduling calculation
- `POST /api/planner/generate` — plan generation from time, mastery, and mistakes
- `POST /api/placement/start` and `/api/placement/answer` — placement-state prototype (not a validated placement assessment)

## Supabase
`database/01_schema.sql` is the base PostgreSQL schema for the local Docker demo. `database/02_content_schema.sql` is an additive, transaction-wrapped migration that adds normalized content, CEFR descriptors, knowledge-graph edges, lesson steps, exercise options/answer keys, reading tokens, audio variants, writing/speaking records, exam sections, and per-skill evidence. Apply migrations in numeric order. `database/supabase_rls.sql` adds user-scoped RLS policies assuming Supabase Auth. The API connects directly to PostgreSQL, verifies the Supabase JWT on every personal route and scopes every query by the token's user id; RLS is an additional layer for direct client access. `database/04_sync.sql` adds the sync cursor columns. Configure `.env` (see `.env.example`) with your Supabase project values.

## Curriculum and Goethe
The curriculum is stored at `backend/src/data/curriculum_master.json` and is seeded into `levels`, `units`, and `knowledge_items` on startup when the database is available. Foundation is a product-defined pre-A1 stage, not an official CEFR level. The course is CEFR-informed, not an official Goethe curriculum or certificate. The app links to Goethe's official preparation resources and must use original exercises rather than reproduce protected exam content.

## Tests
Run `npm install && npm run build` separately in `backend` and `frontend`. Docker is required to validate the complete compose stack. The project must not be considered production-ready until builds, API/database integration tests, authorization tests, and real device/browser checks pass.

## Verification report
See `BUILD_STATUS.txt` for what passed and what remains unverified. The local environment used for this package had no Docker installation and dependency installation timed out, so no claim is made that a full Docker build or browser run succeeded. The backend's `npm test` runs pure engine/curriculum smoke tests and content-schema contract checks after dependencies are installed. `npm run test:schema` runs the content-schema contract checks alone. The SQL migration has been structurally checked here, but cannot be called PostgreSQL-validated until it is executed against a real PostgreSQL instance.
