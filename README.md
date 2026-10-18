# Chess Colombia · Ajedrez.co

> A real-time online chess platform built in Colombia.
> Live games · Server-side move validation · Stockfish post-game analysis · Bots · Tactics.

**▶ Live demo:** [chess-colombia-wwbx.vercel.app](https://chess-colombia-wwbx.vercel.app)
Click **"Jugar como invitado"** (Play as guest) to jump straight into a game against a bot — no sign-up needed.

> The UI is in Spanish (it was built for the Colombian chess community); the code, architecture and this README are documented in English.
> The backend runs on Render's free tier, so the first request after a period of inactivity can take ~30 s while it wakes up.

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3a2716)]() [![License](https://img.shields.io/badge/license-MIT-1f7a5a)]() [![Stack](https://img.shields.io/badge/stack-Next.js%20%C2%B7%20Express%20%C2%B7%20Supabase-c9a24a)]()

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech stack and design decisions](#tech-stack-and-design-decisions)
4. [Repository structure](#repository-structure)
5. [Local setup](#local-setup)
6. [Production deployment](#production-deployment)
7. [Environment variables](#environment-variables)
8. [SQL migrations](#sql-migrations)
9. [Operations and troubleshooting](#operations-and-troubleshooting)
10. [Roadmap](#roadmap)
11. [License](#license)

---

## Features

- **Real-time multiplayer** over Socket.io (WebSocket with polling fallback), with server-side clocks and a 30-second reconnection grace window.
- **Server-authoritative gameplay:** every move is validated on the server with `chess.js`; the client is never trusted.
- **Country-aware matchmaking:** "Colombia only" or "Global" pools, with automatic promotion to Global after 8 s and a hard timeout at 25 s. Time controls: 1+0, 3+0, 5+0, 10+0.
- **Glicko-2 ratings** per time control (bullet, blitz, rapid, classical), applied per game, Lichess-style. Bot games are unrated.
- **Six Stockfish bots** from ~800 to ~2300 Elo, each with its own playing style.
- **Asynchronous post-game analysis:** a separate worker runs Stockfish (depth 12, MultiPV 3) and produces per-move classification, accuracy and an Elo estimate for each side.
- **Tactics trainer** seeded from the Lichess puzzle database (CC0), with progress tracking and an insights panel.
- **In-browser analysis board** using Stockfish WASM, plus beginner lessons.
- **Auth:** email/password (bcrypt + JWT), Google Sign-In, and **guest sessions** (24 h, bots only).
- **Hardening:** Helmet, CORS, Zod validation on every input, rate limiting on auth endpoints, and account banning re-checked on every request.

---

## Architecture

Three independent services coordinated by a single Postgres database (Supabase):

| Service       | Responsibility                                        | Hosting                 |
|---------------|-------------------------------------------------------|-------------------------|
| **frontend/** | Next.js UI: landing, lobby, game, analysis, tactics   | Vercel                  |
| **backend/**  | REST API + Socket.io. Source of truth for live games. | Render (Web Service)    |
| **worker/**   | Stockfish post-game analysis. Fully asynchronous.     | Render (Worker, Docker) |
| Supabase (PG) | Persistence: users, games, analyses, puzzles, ratings | supabase.com            |

Each service is isolated: the backend never calls Stockfish, and the worker never talks to clients. **The database is the only point of coordination.**

```
                          ┌──────────────────────┐
                          │  Vercel · Frontend   │
                          │  Next.js 14 + TS     │
                          └──────────┬───────────┘
                       HTTPS         │   WebSocket
                                     ▼
                          ┌──────────────────────┐
                          │  Render · Backend    │
                          │  Express + Socket.io │
                          │  (source of truth    │
                          │   for live games)    │
                          └──────────┬───────────┘
                                     │
                              service_role key
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │    Supabase (PG)     │
                          │  users · games ·     │
                          │  game_analyses · …   │
                          └──────────┬───────────┘
                                     │
                          claim_pending_analysis()
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  Render · Worker     │
                          │  Node + Stockfish    │
                          │  (Docker)            │
                          └──────────────────────┘
```

### Key flows

**Live game.** The client sends `game:move` over Socket.io → the backend validates it with `chess.js`, applies the clock, persists the move and broadcasts it to both players. The client never decides whether a move is legal.

**Game end.** `endGame()` persists `games.status = 'finished'` with the final PGN, updates Glicko-2 ratings for human-vs-human games, and inserts a `pending` row into `game_analyses` without blocking.

**Post-game analysis.** The worker polls the `claim_pending_analysis()` RPC every 4 s (using `FOR UPDATE SKIP LOCKED`), analyzes the game with Stockfish and writes per-move results, a summary and Elo estimates with `status = 'done'`. Several workers can run in parallel without race conditions, and stuck ("zombie") jobs are recovered automatically.

**Analysis UI.** `/game/[id]/analysis` calls `GET /api/games/:id/analysis` and polls every 4 s while the status is `pending` or `running`, then renders the full review.

---

## Tech stack and design decisions

| Decision | Why |
|---|---|
| **Plain Express, not NestJS** | No DI/decorator overhead for an MVP; easy to migrate later. |
| **Socket.io rooms (`game:<id>`)** | Built-in reconnection; can scale horizontally later with the Redis adapter without a rewrite. |
| **`chess.js` on the server** | The client is never the authority on moves, so the game can't be cheated from DevTools. |
| **Own JWT auth (not Supabase Auth)** | Provider independence; moving to Auth0 or Cognito means changing one file. |
| **Analysis in a separate worker** | Stockfish is CPU-bound and must never block the backend's event loop. |
| **DB polling instead of Redis/BullMQ** | No extra infrastructure for an MVP. `FOR UPDATE SKIP LOCKED` already gives safe multi-worker job claiming. |
| **In-memory matchmaking and live-game state** | Zero latency. The contract (`findMatch`, `removeFromQueues`) is isolated so it can move to Redis when there are multiple replicas. |
| **Guest sessions as real, short-lived users** | Guests reuse the whole game pipeline (bots, analysis, tactics) with no special cases; they are kept out of human matchmaking so they never affect real ratings, and a cleanup function removes them after a few days. |

---

## Repository structure

```
chess-colombia/
├── frontend/                # Next.js 14 + TypeScript + Tailwind
│   └── src/
│       ├── app/             # routes (App Router): lobby, game, analysis, tactics, analyze, aprender
│       ├── components/      # ChessBoard, Clock, EvalBar, MoveList, EngineLines, BotPicker, …
│       ├── hooks/useGame.ts # game lifecycle (state + sockets)
│       ├── lib/             # api.ts, socket.ts, auth.ts (Zustand), stockfishClient.ts (WASM)
│       └── types/
│
├── backend/                 # Node + Express + Socket.io
│   ├── src/
│   │   ├── config/          # env, supabase, bots
│   │   ├── controllers/
│   │   ├── middleware/      # auth (JWT), rate limiting, error handling
│   │   ├── routes/
│   │   ├── services/        # auth, game, matchmaking, rating (Glicko-2), bot, tactics
│   │   ├── sockets/         # gameHandler.js (game engine)
│   │   └── utils/           # validators (Zod), jwt
│   └── scripts/import_lichess_puzzles.js
│
├── worker/                  # Node + Stockfish, Dockerized
│   ├── src/
│   │   ├── engine.js        # UCI wrapper over child_process
│   │   ├── analyzer.js      # PGN → positions → metrics
│   │   ├── metrics.js       # accuracy (Lichess formula), Elo estimate
│   │   ├── db.js            # claim / markDone / markFailed
│   │   └── index.js         # polling loop
│   └── Dockerfile           # node:20-bookworm-slim + stockfish (apt)
│
├── database/                # schema.sql + numbered, idempotent migrations
└── render.yaml              # Render Blueprint (backend + worker)
```

---

## Local setup

### Prerequisites

- **Node 18+** and npm.
- A free [Supabase](https://supabase.com) project.
- **Stockfish** (only to run the worker locally):

  | OS      | Command                     | Resulting path                |
  |---------|-----------------------------|-------------------------------|
  | macOS   | `brew install stockfish`    | `/opt/homebrew/bin/stockfish` |
  | Ubuntu  | `sudo apt install stockfish`| `/usr/games/stockfish`        |
  | Windows | download from [stockfishchess.org](https://stockfishchess.org/download/) | the downloaded `.exe` |

### 1) Create and migrate the database

1. Create a project on supabase.com (free tier).
2. In the **SQL Editor**, run `database/schema.sql`, then every `database/migration_0XX_*.sql` file in numeric order.
3. From the project's API settings, copy:
   - `Project URL` → `SUPABASE_URL`
   - the `service_role` / secret key → `SUPABASE_SERVICE_KEY` *(secret: backend and worker only)*

### 2) Backend

```bash
cd backend
cp .env.example .env
#   Fill in: SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET, CLIENT_ORIGIN
#   Generate a random JWT_SECRET:
#     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install
npm run dev          # → http://localhost:4000
```

### 3) Frontend

```bash
cd frontend
cp .env.example .env.local
#   NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev          # → http://localhost:3000
```

### 4) Worker

```bash
cd worker
cp .env.example .env
#   Fill in: SUPABASE_URL, SUPABASE_SERVICE_KEY, STOCKFISH_PATH (if not on PATH)
npm install
npm start            # ✓ Stockfish ready (depth=12, multipv=3)
```

### End-to-end check

1. Open two browsers (one normal, one incognito) and create two accounts.
2. In both: **Jugar online** → you get matched.
3. Make moves → they sync live on both boards.
4. Finish the game (checkmate, resignation or time).
5. Click **"Ver análisis"** → "Analizando…" first, then (10–30 s) the full review with the eval bar.
6. The worker logs: `[worker] ✓ <gameId> en X.Xs (W:88% B:81%, Elo W:1620 B:1380)`.

To test guest mode, click **"Jugar como invitado"** on the landing page and pick any bot.

---

## Production deployment

### Frontend → Vercel

1. Import the GitHub repo in Vercel.
2. **Root Directory:** `frontend`
3. Environment variables: `NEXT_PUBLIC_API_URL` (public backend URL, no trailing slash) and, optionally, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
4. Deploy.

### Backend + Worker → Render

**Option A — Blueprint (recommended):** Render Dashboard → **New +** → **Blueprint** → connect the repo (Render reads `render.yaml`). Fill in the `sync: false` variables (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` on both services, `CLIENT_ORIGIN` = the Vercel URL) and apply.

**Option B — Manual:**
- **Backend** (Web Service): root `backend`, build `npm install`, start `npm start`.
- **Worker** (Background Worker, Docker): root `worker`, using the included Dockerfile.

### Estimated cost

| Service       | Plan                                   | Monthly        |
|---------------|----------------------------------------|----------------|
| Vercel        | Hobby                                  | US$0           |
| Render Web    | Free (750 h)                           | US$0           |
| Render Worker | Starter (recommended for Stockfish)    | US$7           |
| Supabase      | Free (500 MB)                          | US$0           |
| **Total**     |                                        | **US$0–7/mo**  |

The worker also runs on the free plan, with less RAM and slower analysis — fine for low traffic.

---

## Environment variables

Secrets live only in the hosting providers' environment settings (Render, Vercel), never in the repository. Each service has a `.env.example` with placeholder values.

### Backend

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | 4000 | |
| `NODE_ENV` | no | development | In production the server refuses to start with a weak `JWT_SECRET`. |
| `CLIENT_ORIGIN` | yes | http://localhost:3000 | Frontend URL for CORS and Socket.io |
| `SUPABASE_URL` | yes | — | Project URL |
| `SUPABASE_SERVICE_KEY` | yes | — | service_role key; **never exposed to the client** |
| `JWT_SECRET` | yes | — | 48+ random bytes |
| `JWT_EXPIRES_IN` | no | 7d | Guest tokens always expire after 24 h |
| `GOOGLE_CLIENT_ID` | no | — | If empty, Google Sign-In is disabled |

### Frontend

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | http://localhost:4000 | Public backend URL |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | no | — | Same client ID as the backend |

### Worker

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | Same project as the backend |
| `SUPABASE_SERVICE_KEY` | yes | — | service_role key |
| `STOCKFISH_PATH` | no | `stockfish` | `/usr/games/stockfish` in Docker |
| `ENGINE_DEPTH` | no | 12 | 12–15 is reasonable; higher is slower |
| `ENGINE_MULTIPV` | no | 3 | Lines per position |
| `POLL_INTERVAL_MS` | no | 4000 | Polling interval |
| `MAX_PLIES` | no | 200 | Max plies analyzed per game |

---

## SQL migrations

All migrations live in `database/` and are **idempotent** (`IF NOT EXISTS`). Run them in order in the Supabase SQL Editor.

| File | Adds |
|---|---|
| `schema.sql` | Base tables `users`, `games` (fresh installs) |
| `migration_001_oauth_and_banned.sql` | `google_id`, `banned` fields, nullable `password_hash` |
| `migration_002_analysis.sql` | `game_analyses` table + `claim_pending_analysis()` RPC |
| `migration_003_zombie_recovery.sql` | Recovery of stuck analysis jobs |
| `migration_004_fix_schema.sql` | `game_analyses` schema fixes |
| `migration_005_analysis_ttl.sql` | Automatic TTL for old analyses |
| `migration_006_progress_and_elo.sql` | Live analysis progress + Elo confidence |
| `migration_007_tactics.sql` | Tactics system (puzzles, attempts, progress) |
| `migration_008_tactics_fixes.sql` | Tactics cleanup and scalability |
| `migration_009_competitive_rating.sql` | Glicko-2 ratings per time control |
| `migration_010_insights_index.sql` | Indexes for the tactics insights panel |
| `migration_011_guest_cleanup.sql` | `cleanup_guest_users()` to delete expired guest accounts |

---

## Operations and troubleshooting

**Backend logs** are prefixed by area (`[socket]`, `[MATCHMAKING]`, `[GAME:STATE]`), e.g.:

```
[MATCHMAKING] Match encontrado: <a> vs <b> (timeControl=5+0, pool=GLOBAL)
```

**Retry failed analyses:**

```sql
update game_analyses set status = 'pending', error_message = null where status = 'failed';
```

**Ban a user** (takes effect on the next request, even with a valid JWT):

```sql
update users set banned = true, banned_reason = 'engine use', banned_at = now() where username = 'X';
```

**Clean up guest accounts** older than 3 days (game records are kept):

```sql
select cleanup_guest_users();
```

**Cold starts:** Render's free web service sleeps after 15 minutes of inactivity; the first request takes ~30 s. The Starter plan keeps it awake. Background workers never sleep.

---

## Roadmap

**Shipped**

- ✅ Auth: email/password, Google Sign-In and guest sessions
- ✅ Matchmaking with Colombia / Global pools and automatic fallback
- ✅ Server-side clock with flag detection and reconnection without state loss
- ✅ Glicko-2 ratings per time control
- ✅ Stockfish bots, post-game analysis, accuracy and Elo estimates
- ✅ Tactics trainer with Lichess puzzles
- ✅ Anti-cheat foundation: server-side validation + account banning

**Next**

- ⏳ Leaderboards by country
- ⏳ Spectator mode (read-only rooms)
- ⏳ Increment time controls (`3+2`, `5+5`, …)
- ⏳ Swiss tournaments
- ⏳ Automated cheat detection (engine-match rate, abnormal ACPL, timing patterns)
- ⏳ Redis-backed matchmaking and Socket.io adapter for multiple backend instances

---

## License

MIT. Feel free to fork it, contribute, or run your own instance.

---

<div align="center">

**Built with ♞ and coffee in Colombia 🇨🇴**

</div>
