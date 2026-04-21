# Deployment Guide — Railway (backend + MySQL) + Vercel (frontend)

This setup deploys the **Go/Gin backend** and **MySQL** on Railway, and the **React/Vite admin frontend** on Vercel. The **mobile app is unchanged** — when you want to test it, just point its API URL to the Railway backend.

Local development is **not affected** — all new config has fallbacks to the same `http://localhost:8080` behavior you had before.

---

## 0. Prerequisites

- Code pushed to a GitHub repo (Railway + Vercel both deploy from Git)
- Accounts: https://railway.com and https://vercel.com
- Delete the committed `.exe` files and `server.log` from `backend/` before pushing — they bloat the repo. The `.dockerignore` already excludes them from images, but git is separate.

```bash
cd backend
rm -f *.exe server.log
```

(Add them to a `.gitignore` while you're at it.)

---

## 1. Deploy the backend + MySQL on Railway

### 1a. Create the project

1. Go to https://railway.com → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. Railway detects `Dockerfile` and `railway.json` at the repo root and starts building. Let the first build run (it will fail on DB connection — that's expected; we haven't added MySQL yet).

### 1b. Add MySQL

1. In the project → **+ New** → **Database** → **Add MySQL**.
2. Wait ~30 s for it to provision.

### 1c. Wire environment variables on the backend service

Open the backend service → **Variables** tab → **Raw Editor**, paste:

```env
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
JWT_SECRET=replace-with-a-long-random-string
GIN_MODE=release
ALLOWED_ORIGINS=
PUBLIC_BACKEND_URL=
```

Leave `ALLOWED_ORIGINS` and `PUBLIC_BACKEND_URL` empty for now — we fill them in step 3 after we know the public URLs.

### 1d. Generate a public URL

Backend service → **Settings** → **Networking** → **Generate Domain**. Copy the URL it gives you, e.g.
`https://share-management-production.up.railway.app`.

### 1e. (Recommended) Attach a volume for uploads

Backend service → **Settings** → **Volumes** → **+ New Volume** → mount path **`/app/uploads`**. Without this, uploaded files vanish on every redeploy.

### 1f. Verify

Open `https://<your-backend>.up.railway.app/uploads/` — you should see a directory listing or 404 from Gin (either means the server is up). Logs should show `Server starting on port 8080` and `Database connected and migrated successfully`.

Default admin login (seeded on first boot): **`admin` / `admin123`** — change immediately.

---

## 2. Deploy the frontend on Vercel

1. https://vercel.com → **Add New → Project** → import the same GitHub repo.
2. In the import screen:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` (auto)
   - **Output Directory**: `dist` (auto)
3. **Environment Variables** → add:
   ```
   VITE_API_URL = https://<your-backend>.up.railway.app
   ```
   (the URL from step 1d — no trailing slash)
4. **Deploy**.
5. Copy the resulting URL, e.g. `https://share-admin.vercel.app`.

---

## 3. Finish CORS + backend public URL

Back in Railway → backend service → **Variables**, fill in:

```env
ALLOWED_ORIGINS=https://share-admin.vercel.app
PUBLIC_BACKEND_URL=https://<your-backend>.up.railway.app
```

Railway will redeploy automatically. Done.

---

## 4. Test checklist

- [ ] Open the Vercel URL → login screen loads
- [ ] Login with `admin / admin123` → dashboard loads (proves frontend → backend → MySQL all talk)
- [ ] Upload a document → refresh → it's still there (proves volume works)
- [ ] Open browser devtools → no CORS errors in the console
- [ ] Check Railway logs for any 500s

---

## 5. Mobile app (when you're ready)

The mobile app wasn't touched. When you want to test against the hosted backend, change its API base URL to `https://<your-backend>.up.railway.app` (or wire it through an env var the same way the frontend does). It will work against the same Railway DB and CORS doesn't apply to native clients.

---

## 6. Cost expectation (free-tier reality)

Railway gives **$5 in free credits per month** on the Hobby trial. A small always-on backend + MySQL uses ~$3–$5/month, so a one-off tester run for a few weeks is comfortably inside the free allowance. If you need it longer, either stop the services when not demoing, or add a card (still $5/mo floor on Hobby). Vercel's Hobby tier is free indefinitely for non-commercial use.

Free alternatives for the backend if you want to avoid any card: **Render.com** (web service, spins down when idle) with **Aiven** or **Clever Cloud** free MySQL. Same Dockerfile works on Render; env vars are the same.

---

## 7. What changed in the repo (for review)

| File | Change |
|---|---|
| `Dockerfile`, `.dockerignore`, `railway.json` | **new** at repo root — build backend + bundle `mini_apps/` |
| `backend/cmd/main.go` | CORS merges `ALLOWED_ORIGINS` env with localhost list; `PORT`, `UPLOAD_DIR`, `MINI_APPS_DIR` env-aware |
| `backend/internal/database/database.go` | Ecommerce mini-app route uses `PUBLIC_BACKEND_URL` env (localhost fallback) |
| `backend/.env.example` | **new** — documents all env vars |
| `frontend/src/utils/apiBase.js` | **new** — single source of truth for API origin |
| `frontend/src/services/api.js`, `pages/{Announcements,Documents,MiniApps}.jsx` | Use `apiBase` instead of hardcoded `http://localhost:8080` |
| `frontend/vercel.json` | **new** — SPA rewrite for React Router |
| `frontend/.env.example` | **new** — documents `VITE_API_URL` |

Every fallback preserves the pre-change behavior when env vars are unset, so `go run ./cmd` and `npm run dev` still work unchanged against a local MySQL.
