# Emergency Green Corridor: Build Spec v1

> For the AI coding agent: read this whole file before writing code. Build phase by phase using PROMPTS.md. Section 15 contains non-negotiable rules.

## 1. Product in one paragraph
A web platform where a verified ambulance driver reports an accident with photo evidence and picks a hospital. A police officer verifies the report and the hospital confirms it has an emergency bed. Both approvals run **in parallel**. Once both approve, the driver gets the fastest route to the selected hospital, the ambulance is tracked live, and traffic signals ahead of it turn green (simulated). Every step has a timeout and a defined fallback.

## 2. Scope
**In scope:** 3 role-based interfaces (driver, police, hospital), state-machine-driven emergency lifecycle, parallel approvals with timeouts and fallback hospital, atomic bed holds, real-map routing with road-closure rerouting, live location (phone GPS + simulator), simulated green wave, realtime updates, audit log.
**Out of scope:** hardware (Arduino/IR), controlling real signals (we simulate behind a `SignalController` interface), native apps, real hospital system integration.
**Design only (add `city` column but do not build):** multi-city session handover, 2FA, device binding, SMS fallback.

## 3. Stack (locked, do not substitute)
- Monorepo: `/server`, `/client`, `/docs`
- Server: Node 20, TypeScript, Express, Socket.IO, Prisma, Zod validation
- DB: PostgreSQL via `docker-compose.yml` (no PostGIS; do distance math in code with haversine)
- Client: React + Vite + TypeScript + Tailwind, `maplibre-gl` with OpenStreetMap raster tiles, `socket.io-client`. One app with role-gated routes `/driver`, `/police`, `/hospital`. Driver UI is mobile-first (PWA-capable).
- Routing: OpenRouteService (key in `.env`) behind a `RoutingProvider` interface. Fallback provider: public OSRM. Closure avoidance uses ORS `avoid_polygons`.
- Auth: JWT access token (15 min) + refresh token, bcrypt, role-based middleware.
- Files: photo uploads stored on local disk (`/server/uploads`) with random filenames.

## 4. Roles and permissions
| Role | Can do | Cannot do |
|---|---|---|
| DRIVER | Login only (no signup). Create/cancel own emergency, choose hospital, send location, mark arrived. | See other drivers' emergencies. Approve anything. |
| HOSPITAL_ADMIN | Register/deactivate drivers for **own hospital**. Approve/reject incoming requests for own hospital. Edit own bed count. Confirm handover. | Touch other hospitals' data. Verify police items. |
| POLICE | See all pending verifications. Verify/reject. Create/clear road closures. | Edit beds. Create drivers. |

Every endpoint checks role AND ownership. Return 403, not 404, for forbidden resources.

## 5. Core flow
1. Hospital admin registers a driver (name, username, temp password, ambulance number).
2. Driver logs in, taps **Report Accident**: live camera photo (no gallery), severity (CRITICAL / SERIOUS / STABLE), location (GPS or simulator), optional note.
3. Server returns **ranked hospital candidates** (sorted by routed ETA, filtered to hospitals with available beds, tagged with specialty). Driver picks one, or taps "Nearest suitable" to take the top result.
4. Submit creates the emergency and, **in parallel**, a police verification request and a hospital approval request. Deadlines are set for both.
5. While approvals are pending, the driver sees a **provisional route and ETA** and a live status timeline.
6. Police see photo, location on map, driver and ambulance details, and click **Verify** or **Reject**.
7. Hospital sees incoming patient (severity, ETA, origin on map) and clicks **Approve** (atomically holds a bed) or **Reject**.
8. Both approved: status becomes ACTIVE. The route is confirmed, the corridor activates, signals ahead go green as the ambulance advances.
9. Driver arrives (geofence within 50 m of hospital or manual button), then hospital confirms handover, the emergency is CLOSED, signals restore, and the bed hold converts to occupied.

## 6. Emergency state machine
Single service `EmergencyService` is the **only** code allowed to change `status`. Every transition writes an `audit_log` row and emits a socket event.

| From | Trigger | To |
|---|---|---|
| (none) | Driver submits | PENDING_APPROVALS |
| PENDING_APPROVALS | police=APPROVED and hospital=APPROVED | ACTIVE |
| PENDING_APPROVALS | police REJECTED | REJECTED (release any bed hold) |
| PENDING_APPROVALS | hospital REJECTED or TIMED_OUT | stay PENDING_APPROVALS, `hospital_attempt += 1`, auto-assign next-ranked hospital, notify driver. If no candidates left, EXPIRED |
| PENDING_APPROVALS | police TIMED_OUT | stay PENDING_APPROVALS, mark `police_escalated=true` (highlighted in all police queues) |
| PENDING_APPROVALS / ACTIVE | driver cancels | CANCELLED (release hold, restore signals) |
| ACTIVE | hospital revokes (no capacity anymore) | PENDING_APPROVALS with next hospital |
| ACTIVE | geofence or driver marks arrived | ARRIVED |
| ARRIVED | hospital confirms handover | CLOSED |

Final states: REJECTED, EXPIRED, CANCELLED, CLOSED. No transitions out of them. Invalid transitions throw and are tested.

**Timers** (env vars; demo values in brackets):
`HOSPITAL_APPROVAL_TIMEOUT_SEC=90 [15]`, `POLICE_APPROVAL_TIMEOUT_SEC=120 [30]`, `BED_HOLD_TTL_MIN=20`.
Implement with a **DB-polling scheduler** (checks deadline columns every second), not in-memory `setTimeout`, so a server restart loses nothing.

## 7. Data model (Prisma)
- `User`: id, name, username (unique), passwordHash, role, hospitalId (nullable), ambulanceNo (nullable), active, createdAt
- `Hospital`: id, name, lat, lng, city, specialties (string[]), totalEmergencyBeds, availableBeds
- `BedHold`: id, hospitalId, emergencyId, status (HELD | CONSUMED | RELEASED | EXPIRED), expiresAt
- `Emergency`: id, driverId, status, severity, originLat, originLng, photoPath, note, selectedHospitalId, hospitalAttempt, policeStatus, hospitalStatus, policeDeadline, hospitalDeadline, policeEscalated, routeGeoJson, etaSeconds, distanceMeters, createdAt, closedAt, city, idempotencyKey (unique)
- `LocationPing`: id, emergencyId, lat, lng, speed, heading, accuracy, source (GPS | SIMULATOR), recordedAt
- `RoadClosure`: id, polygonGeoJson, createdById, active, createdAt
- `Signal`: id, name, lat, lng, city
- `AuditLog`: id, actorId (nullable for system), action, entityType, entityId, payload (JSON), at (append-only: no update or delete code paths)

## 8. REST API (all JSON except photo upload; all validated with Zod)
Auth: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
Hospital admin: `POST /hospital/drivers`, `GET /hospital/drivers`, `PATCH /hospital/drivers/:id` (deactivate), `GET /hospital/incoming`, `POST /hospital/emergencies/:id/approve`, `POST /hospital/emergencies/:id/reject`, `POST /hospital/emergencies/:id/revoke`, `POST /hospital/emergencies/:id/confirm-handover`, `PATCH /hospital/beds`
Police: `GET /police/queue`, `POST /police/emergencies/:id/verify`, `POST /police/emergencies/:id/reject`, `POST /closures`, `DELETE /closures/:id`, `GET /closures`
Driver: `GET /hospitals/candidates?lat&lng&severity`, `POST /emergencies` (multipart; requires `Idempotency-Key` header), `GET /emergencies/active`, `GET /emergencies/:id`, `POST /emergencies/:id/switch-hospital`, `POST /emergencies/:id/location`, `POST /emergencies/:id/arrived`, `POST /emergencies/:id/cancel`
Dev only (guarded by `NODE_ENV!=production`): `POST /dev/simulate/:emergencyId` (body: speedKmh), `POST /dev/simulate/:emergencyId/stop`

## 9. Realtime (Socket.IO)
Authenticate the socket with the JWT. Rooms: `role:POLICE`, `hospital:{id}`, `emergency:{id}`, `driver:{id}`.
Events: `emergency:created`, `emergency:updated` (any status or approval change), `location:update`, `route:updated`, `signals:updated`, `closure:updated`, `approval:timeout`.
On client reconnect, the client **refetches full state** over REST, never relying on missed events.

## 10. Routing, GPS and signals
- **Hospital ranking:** candidates = hospitals with `availableBeds > 0`. Get routed ETA for each (ORS matrix or per-hospital directions), rank by ETA, tie-break by specialty match for severity. Return top 5 with ETA, distance, beds.
- **Closures:** when computing any route, pass all active closure polygons as `avoid_polygons`. Creating or clearing a closure triggers recompute for every ACTIVE emergency whose current route intersects the polygon. Emit `route:updated`.
- **Location source is swappable.** Live GPS: `navigator.geolocation.watchPosition` (high accuracy), throttle to one send per 1-2 s, drop readings with accuracy > 50 m, use the Screen Wake Lock API while an emergency is active, show "last known X s ago" if pings stop. Simulator: server walks the route polyline at `speedKmh` emitting pings with `source=SIMULATOR`. Server ignores out-of-order pings (older `recordedAt`).
- **Deviation:** if the ambulance is more than 60 m from the route for 3 consecutive pings, recompute the route from current position.
- **Signals (simulated):** `SignalController` interface with `setState(signalId, state)` and a `SimulatedSignalController` implementation (state kept in memory and broadcast). Normal mode cycles RED/GREEN/YELLOW on a timer. For each ACTIVE emergency, signals within 400 m **ahead** along the route are forced GREEN; signals passed by more than 100 m return to normal cycle. If two corridors claim one signal, higher severity wins, tie goes to the earlier `createdAt`.

## 11. Failure handling (each row needs a test or a manual check)
| Failure | Required behavior |
|---|---|
| Driver offline | App keeps last route, queues pings, resyncs on reconnect |
| Socket drops | Auto-reconnect plus full state refetch |
| Routing API fails | Fall back to OSRM provider; if both fail, keep last route and show warning |
| Duplicate submit | Same `Idempotency-Key` returns the existing emergency |
| Server restart | All state in DB; scheduler resumes from deadline columns |
| Two ambulances, last bed | Atomic update `UPDATE hospitals SET availableBeds = availableBeds - 1 WHERE id=? AND availableBeds > 0`; second approval fails cleanly |
| Hold never used | Scheduler expires hold at TTL, restores bed |
| Hospital loses capacity mid-journey | Revoke flow, auto-offer next hospital |
| Police silent | Escalation flag after timeout |
| Unauthorized access | 403 plus audit log entry |

## 12. Security
bcrypt (cost 10+), JWT short expiry, refresh rotation, login rate limit (5 tries / minute / IP), Helmet, CORS allowlist, Zod on every body/query, upload limits (image/* only, max 5 MB, random filename), no secrets in code (`.env` plus `.env.example`), driver account lockout on deactivation takes effect immediately (check `active` on every request).

## 13. UI pages
**Common:** `/login` with role-based redirect.
**Driver `/driver` (mobile-first):** home with Report Accident button; report form (camera capture, severity, note); hospital picker (cards with ETA, distance, beds, specialties, "Nearest suitable" button); live screen with map, route, status timeline (Police: pending/verified, Hospital: pending/approved, Corridor: inactive/active), ETA, next-signal info, Live GPS / Simulator toggle, Cancel, Arrived; clear banner when the hospital is auto-switched.
**Police `/police`:** live queue (escalated items on top, deadline countdown), detail view with photo, map pin, driver info, Verify/Reject; closures tool (click map to drop a square polygon, list with Clear buttons); active corridors overview.
**Hospital `/hospital`:** incoming requests with severity, ETA countdown, origin map, Approve/Reject; bed counter (editable); driver management (add, deactivate); arrivals awaiting handover.

## 14. Seed and demo data
- `DEMO_CENTER_LAT/LNG` and `DEMO_RADIUS_KM` live in `.env`. A script `npm run seed:fetch` pulls hospitals (`amenity=hospital`) and traffic signals (`highway=traffic_signals`) from the Overpass API near the center and **saves them to `/server/seed/*.json`**. The demo must never depend on Overpass being reachable. `npm run seed` loads the JSON.
- Seed: 5 hospitals with random emergency beds (2-8), 1 admin per hospital, 1 police user, 3 drivers. If Overpass returns too few signals, add a hardcoded fallback set along the demo route.
- Provide `README` with a **demo script**: (1) hospital registers a driver, (2) driver reports with photo, (3) approvals run in parallel, (4) simulator drives, signals go green ahead, (5) police closes a road, route reroutes, (6) second request takes the last bed and the other fails cleanly, (7) hospital stays silent and the timeout falls back to the next hospital.

## 15. Rules for the agent (non-negotiable)
1. Only `EmergencyService` mutates emergency status or approvals. No status changes in route handlers or UI code.
2. Write unit/integration tests for: every valid and invalid state transition, atomic bed hold (concurrent approvals), timeout fallback, role/ownership permissions, idempotent submit. Never weaken a test to make it pass; fix the code.
3. No hardcoded secrets, keys, or URLs. Everything via `.env`.
4. No mocked data left in production paths. Search for `TODO`, `mock`, `hardcoded` before declaring a phase done.
5. Commit after each completed phase with a clear message.
6. Keep each phase small. Stop and report after each phase with: what works, what is stubbed, how to run it.
7. Do not add features, libraries, or services not listed here without asking.
8. Every state change must write an audit log row and emit a socket event.
9. Keep the demo-mode timer values behind env vars, never hardcoded.

## 16. Priority tiers (cut line moves with progress; never skip a higher tier for a lower one)
- **P0:** auth and roles, hospital registers drivers, emergency creation with photo, parallel approvals, state machine, map and route after approval, simulator, realtime dashboards, green wave visual
- **P1:** timeout and fallback hospital, atomic bed hold with TTL, cancel, arrived and handover, audit log, ETA-ranked hospitals
- **P2:** closure-aware reroute, live phone GPS toggle, idempotency, rate limiting, multi-ambulance signal conflict, severity priority, deviation reroute
- **P3 (document only):** 2FA, device binding, SMS fallback, multi-city handover
