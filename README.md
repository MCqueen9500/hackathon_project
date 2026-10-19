# Emergency Green Corridor 🚑

> Real-time emergency vehicle corridor management — connecting drivers, police, and hospitals.

## Quick Start

### Prerequisites
- Node.js ≥ 20
- Docker + Docker Compose (for Postgres)
- An [OpenRouteService](https://openrouteservice.org/) API key

### 1. Environment

```bash
cp .env.example .env
# Edit .env: set JWT secrets (≥32 chars), ORS_API_KEY, and adjust DEMO_CENTER_LAT/LNG/RADIUS_KM
```

### 2. Start Postgres

```bash
docker compose up -d
# Postgres is healthy when: docker compose ps shows postgres (healthy)
```

### 3. Install dependencies

```bash
npm install
```

### 4. Database migrations + Prisma client

```bash
npm run db:generate   # generates the Prisma client
npm run db:migrate    # creates tables (runs prisma migrate dev)
```

### 5. Run server + client together

```bash
npm run dev
```

- **Server**: http://localhost:3001
- **Client**: http://localhost:5173
- **Health check**: `GET http://localhost:3001/health` → `{"status":"ok", ...}`

---

## Project Structure

```
.
├── docker-compose.yml        # Postgres 16
├── .env.example              # All env vars with descriptions
├── package.json              # Workspace root (npm workspaces)
│
├── server/                   # Node 20 · TypeScript · Express · Socket.IO · Prisma · Zod
│   ├── prisma/
│   │   └── schema.prisma     # Full data model (section 7)
│   ├── src/
│   │   ├── config/env.ts     # Zod-validated env (fails fast at startup)
│   │   ├── lib/prisma.ts     # Prisma singleton
│   │   ├── routes/health.ts  # GET /health
│   │   ├── services/
│   │   │   ├── EmergencyService.ts  # ONLY place that changes emergency status
│   │   │   └── Scheduler.ts         # DB-polling timeout scheduler
│   │   ├── types/index.ts    # Shared domain types
│   │   ├── seed/             # Overpass fetch + DB seeder (Phase 4)
│   │   ├── app.ts            # Express app factory
│   │   └── index.ts          # HTTP + Socket.IO server entry
│   └── uploads/              # Photo uploads (gitignored)
│
├── client/                   # React 18 · Vite · TypeScript · Tailwind · maplibre-gl
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx      # /login (stub — auth in Phase 1)
│   │   │   ├── DriverPage.tsx     # /driver (mobile-first)
│   │   │   ├── PolicePage.tsx     # /police
│   │   │   └── HospitalPage.tsx   # /hospital
│   │   ├── App.tsx           # Router with role-gated routes
│   │   └── main.tsx          # React entry point
│   └── index.html
│
└── docs/
    └── SPEC.md               # Full product specification
```

## Environment Variables

See [.env.example](.env.example) for full documentation. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_ACCESS_SECRET` | ≥32 chars, for 15-min access tokens |
| `JWT_REFRESH_SECRET` | ≥32 chars, for 7-day refresh tokens |
| `ORS_API_KEY` | OpenRouteService API key (routing + ETA) |
| `DEMO_CENTER_LAT/LNG` | Map center for Overpass seed fetch |
| `DEMO_RADIUS_KM` | Radius around center to fetch hospitals/signals |
| `HOSPITAL_APPROVAL_TIMEOUT_SEC` | Default 90s (set 15 for demo) |
| `POLICE_APPROVAL_TIMEOUT_SEC` | Default 120s (set 30 for demo) |
| `BED_HOLD_TTL_MIN` | How long a held bed is reserved (default 20 min) |

## Demo Script (Phase 4+)

1. **Hospital registers a driver** — POST /hospital/drivers
2. **Driver reports accident with photo** — POST /emergencies (multipart, Idempotency-Key header)
3. **Parallel approvals** — police verifies, hospital approves atomically (bed hold created)
4. **Simulator drives** — POST /dev/simulate/:id, signals go green 400 m ahead
5. **Police closes a road** — POST /closures; active corridors reroute automatically
6. **Second request takes last bed** — first approve succeeds, second fails with 409
7. **Hospital stays silent** — HOSPITAL_APPROVAL_TIMEOUT_SEC fires, next-ranked hospital is offered

## NPM Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start server + client with hot reload |
| `npm run dev:server` | Server only |
| `npm run dev:client` | Client only |
| `npm run build` | Build both for production |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run seed:fetch` | Fetch hospitals/signals from Overpass API |
| `npm run seed` | Seed the database from JSON files |
| `npm run test` | Run server test suite |

## Architecture Notes

- **State machine**: Only `EmergencyService` may change `emergency.status`. Routes delegate to it.
- **Timeouts**: DB-polling scheduler checks deadline columns every `SCHEDULER_POLL_INTERVAL_MS`. Safe across restarts.
- **No PostGIS**: Distance math uses haversine in code (spec section 3).
- **Routing**: ORS behind `RoutingProvider` interface; falls back to public OSRM.
- **Signals**: `SimulatedSignalController` keeps state in memory, broadcasts via Socket.IO.
- **Idempotency**: `POST /emergencies` requires `Idempotency-Key` header; duplicate returns existing emergency.
