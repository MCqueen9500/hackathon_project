# Emergency Green Corridor (EGC)

A real-time emergency dispatch platform: ambulance drivers report accidents, police verify, hospitals approve and hold a bed — all in parallel. Once approved, the ambulance gets a live route, traffic signals ahead turn green (simulated), and road closures are avoided automatically.

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node 20, TypeScript, Express, Socket.IO, Prisma |
| Database | PostgreSQL 16 (Docker) |
| Client | React + Vite + TypeScript + Tailwind + MapLibre GL |
| Routing | OpenRouteService (ORS) + OSRM fallback |
| Auth | JWT (15 min access) + refresh tokens + bcrypt |

---

## Prerequisites

- **Node.js ≥ 20** (`node -v`)
- **Docker Desktop** (for PostgreSQL)
- **Git**
- An [OpenRouteService API key](https://openrouteservice.org/dev/#/login) (free, optional — OSRM fallback works without it)

---

## Quick Start (Fresh Clone)

### 1. Clone and install

```bash
git clone <repo-url> emergency-green-corridor
cd emergency-green-corridor
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```dotenv
# Required: ORS key (or leave blank to use OSRM fallback)
ORS_API_KEY="your-openrouteservice-api-key"

# Required: strong secrets (minimum 32 chars each)
JWT_ACCESS_SECRET="at-least-32-chars-random-string-here"
JWT_REFRESH_SECRET="another-32-chars-random-string-here"

# Keep these for Bangalore demo; change for another city
DEMO_CENTER_LAT="12.9716"
DEMO_CENTER_LNG="77.5946"
DEMO_RADIUS_KM="10"
```

> **Demo timer values** — these are already set to fast demo values in `.env.example`:
> - `HOSPITAL_APPROVAL_TIMEOUT_SEC=15` (prod default: 90)
> - `POLICE_APPROVAL_TIMEOUT_SEC=30` (prod default: 120)

### 3. Start the database

```bash
docker compose up -d
```

Wait ~5 seconds for PostgreSQL to be ready.

### 4. Run migrations and seed

```bash
# Apply DB schema
npm run db:migrate

# (Optional) Fetch real hospitals and signals from OpenStreetMap
npm run seed:fetch

# Seed demo data
npm run seed
```

The seed output shows demo credentials:
```
Hospital admins : admin_h1 … admin_h5  / Admin@123
Police          : police1               / Police@123
Drivers         : driver1 … driver3     / Driver@123
```

### 5. Start the application

```bash
npm run dev
```

- **Server**: http://localhost:3001
- **Client**: http://localhost:5173

---

## Demo Script (Section 14)

Open **three browser windows** (or tabs) at http://localhost:5173 and log in as different roles.

### Setup
| Window | Login as | Password |
|---|---|---|
| A | `admin_h1` | `Admin@123` |
| B | `police1` | `Police@123` |
| C | `driver1` | `Driver@123` |

---

### Step 1 — Hospital registers a driver (Window A)

1. Log in as `admin_h1`
2. Go to **Drivers** tab → **+ Add Driver**
3. Fill in: Name=`Test Driver`, Username=`testdriver`, Password=`Test@123`, Ambulance=`KA01-ZZ-9999`
4. Click **Register Driver** → driver appears in the list ✅

---

### Step 2 — Driver reports an accident (Window C)

1. Log in as `driver1` (or the newly registered `testdriver`)
2. Click **Report Accident**
3. Take/select a photo (or use the camera mock in dev)
4. Set Severity = **CRITICAL**, add a note, confirm location
5. Click **Next** → hospital candidates appear ranked by ETA
6. Click **Nearest Suitable** or pick any hospital
7. Click **Confirm** → status shows **Pending Approvals**

> The route map appears immediately with a provisional route.

---

### Step 3 — Parallel approvals (Windows A + B)

**Police (Window B):**
1. Log in as `police1`
2. The new emergency appears in the **Queue** tab
3. Click the entry to see photo, map, driver info
4. Click **Verify** ✅

**Hospital (Window A):**
1. Go to **Incoming** tab
2. The request appears with severity badge and ETA countdown
3. Click **Approve** — a bed is atomically held ✅

> Once both approve, the driver screen (Window C) transitions to **ACTIVE** — the route is confirmed and signals ahead start turning green.

---

### Step 4 — Simulator drives the route (Window C)

1. On the active emergency screen, tap **Simulator** toggle
2. The ambulance icon moves along the route at a default speed
3. Watch signals ahead turn green in real-time on the map
4. The police and hospital dashboards update live via WebSocket

---

### Step 5 — Police closes a road (Window B)

1. Go to **Closures** tab
2. Click anywhere on the map that crosses the current route
3. A 500m closure square is placed (red overlay)
4. Watch the driver's screen (Window C) — within seconds the route re-draws around the closure
5. A **"🔄 Route updated"** banner appears on the driver screen
6. Click **Clear** on the closure to restore the original route

---

### Step 6 — Last bed race (two drivers)

1. Note how many beds hospital 1 has: check the bed counter in Window A
2. Open a **4th browser window**, log in as `driver2`
3. Both driver1 and driver2 submit emergencies selecting the same hospital
4. Both hospitals receive approval requests
5. Both hospital admins click Approve at roughly the same time
6. Exactly **one** succeeds; the second gets `No available beds` → automatic fallback to next-ranked hospital

---

### Step 7 — Hospital timeout fallback

1. Log in as `driver3`, report a new emergency, pick a hospital
2. Police verify immediately (Window B)
3. **Do not touch the hospital approval** (Window A)
4. Wait `HOSPITAL_APPROVAL_TIMEOUT_SEC` seconds (15 in demo mode)
5. The system auto-falls back to the next hospital:
   - Driver screen shows **"⚠️ Hospital auto-switched"** banner
   - Hospital 2 now receives the approval request
6. If all hospitals time out → status becomes **EXPIRED**

---

### Reset between runs

```bash
npm run demo:reset
```

This:
1. Wipes all DB rows (migrate reset)
2. Re-runs seed (fresh hospitals, users, signals)
3. Clears uploaded photos from `uploads/`

Run `npm run demo:reset` and go through steps 1–7 again — the second run should behave identically.

---

## Project Structure

```
├── client/                  # React + Vite frontend
│   └── src/
│       ├── api/             # Typed API clients
│       ├── components/      # Shared components (MapLibreMap, AppShell…)
│       ├── pages/           # Route pages: driver/, hospital/, police/
│       └── hooks/           # useSocket, useAuth…
├── server/
│   ├── prisma/
│   │   ├── schema.prisma    # Data model
│   │   └── migrations/      # SQL migration history
│   ├── scripts/
│   │   ├── smoke.ts         # Happy-path smoke test
│   │   └── demo-reset.ts    # Demo reset helper
│   ├── seed/                # Overpass JSON files (hospitals.json, signals.json)
│   └── src/
│       ├── config/env.ts    # Zod-validated env vars
│       ├── middleware/      # authenticate, requireRole
│       ├── routes/          # auth, driver, hospital, police
│       ├── services/
│       │   ├── EmergencyService.ts   # ONLY place that mutates status
│       │   ├── ClosureService.ts     # Closure reroute logic
│       │   ├── Scheduler.ts          # DB-polling deadline checker
│       │   ├── routing/              # ORS + OSRM providers
│       │   ├── ranking/              # Hospital ranking
│       │   └── signals/              # SimulatedSignalController
│       └── lib/             # prisma, jwt, socket, password, upload
├── docs/SPEC.md             # Full spec
├── docker-compose.yml       # PostgreSQL
└── .env.example             # All env vars documented
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start server + client concurrently |
| `npm run dev:server` | Server only (port 3001) |
| `npm run dev:client` | Client only (port 5173) |
| `npm run seed:fetch` | Fetch hospitals + signals from Overpass API → seed/*.json |
| `npm run seed` | Seed the database from seed/*.json |
| `npm run demo:reset` | **Full reset**: migrate + seed + clear uploads |
| `npm run test` | Run server unit/integration tests |
| `npm run db:migrate` | Apply pending Prisma migrations |
| `npm run build` | Build both server and client for production |

---

## Environment Variables Reference

See [`.env.example`](.env.example) for full documentation. Key variables:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | — | Min 32 chars; signs access tokens |
| `JWT_REFRESH_SECRET` | — | Min 32 chars; signs refresh tokens |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token lifetime |
| `ORS_API_KEY` | — | OpenRouteService key (OSRM fallback if empty) |
| `HOSPITAL_APPROVAL_TIMEOUT_SEC` | `90` | **Set to `15` for demo** |
| `POLICE_APPROVAL_TIMEOUT_SEC` | `120` | **Set to `30` for demo** |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `DEVIATION_THRESHOLD_M` | `60` | Metres off-route before reroute counter increments |
| `DEVIATION_CONSECUTIVE_N` | `3` | Consecutive off-route pings to trigger reroute |

---

## Section 11 — Failure Handling

| Failure | Implementation |
|---|---|
| Driver offline | Client keeps last route; queues pings; auto-refetches state on reconnect via `useSocket` |
| Socket drops | Socket.IO auto-reconnect; client `refetchCount` increments and triggers REST refetch |
| Routing API fails | `OrsRoutingProvider` catches and falls back to `OsrmRoutingProvider`; if OSRM fails, keeps last route with straight-line stub |
| Duplicate submit | `idempotencyKey` unique constraint returns existing emergency (HTTP 200, not 409) |
| Server restart | All state in PostgreSQL; `Scheduler` resumes from `policeDeadline`/`hospitalDeadline` columns |
| Two ambulances, last bed | Atomic `UPDATE ... WHERE availableBeds > 0`; second approval returns `NO_CAPACITY` cleanly |
| Hold never used | `Scheduler` expires hold at `BED_HOLD_TTL_MIN`, restores `availableBeds` |
| Hospital loses capacity | Revoke endpoint → `EmergencyService.revokeHospital()` → next-ranked hospital assigned |
| Police silent | `Scheduler` sets `policeEscalated=true`; item rises to top of queue with red badge |
| Unauthorized access | `requireRole` middleware → 403 + `AuditLog` entry |

---

## Section 12 — Security Checklist

- ✅ bcrypt cost 12 (`hashPassword`)
- ✅ JWT access token 15 min; refresh token lifetime from `JWT_REFRESH_EXPIRY` env
- ✅ Refresh token rotation (old deleted on use)
- ✅ Login rate limit: 5 attempts / minute / IP (`express-rate-limit`)
- ✅ Helmet (security headers)
- ✅ CORS allowlist (comma-separated `CORS_ORIGIN`)
- ✅ Zod validation on every body and query parameter
- ✅ Photo uploads: `image/*` only, max `UPLOAD_MAX_SIZE_MB` MB, random UUID filename
- ✅ No secrets in code — all in `.env` with `.env.example`
- ✅ `active` check on every authenticated request (deactivation takes effect immediately)
- ✅ 403 + audit log on unauthorized role access

---

## Running Tests

```bash
npm run test
```

Tests cover: state machine transitions, atomic bed hold (concurrent), timeout fallback, RBAC, idempotent submit.
