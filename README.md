# Chess Colombia · Ajedrez.co

> Plataforma de ajedrez online en tiempo real, hecha en Colombia.
> Partidas live · Anti-trampa con validación server-side · Análisis post-partida con Stockfish.

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3a2716)]() [![License](https://img.shields.io/badge/license-MIT-1f7a5a)]() [![Stack](https://img.shields.io/badge/stack-Next.js%20%C2%B7%20Express%20%C2%B7%20Supabase-c9a24a)]()

---

## Índice

1. [Visión general](#-visión-general)
2. [Arquitectura](#-arquitectura)
3. [Stack y decisiones de diseño](#-stack-y-decisiones-de-diseño)
4. [Estructura del repositorio](#-estructura-del-repositorio)
5. [Setup local](#-setup-local)
6. [Despliegue en producción](#-despliegue-en-producción)
7. [Variables de entorno](#-variables-de-entorno)
8. [Migraciones SQL](#-migraciones-sql)
9. [Operación y diagnóstico](#-operación-y-diagnóstico)
10. [Roadmap](#-roadmap)
11. [Licencia](#-licencia)

---

## 🎯 Visión general

Tres servicios independientes coordinados por una única base de datos Postgres (Supabase):

| Servicio        | Responsabilidad                                     | Hosting recomendado |
|-----------------|-----------------------------------------------------|---------------------|
| **frontend/**   | UI Next.js: landing, lobby, juego, análisis         | Vercel              |
| **backend/**    | API REST + Socket.io. Fuente de verdad de partidas. | Render (Web)        |
| **worker/**     | Stockfish + análisis post-partida. Asíncrono.       | Render (Worker, Docker) |
| Supabase (PG)   | Persistencia: usuarios, partidas, análisis.         | supabase.com        |

**Lo que está dentro de cada uno** está aislado: el backend nunca llama a Stockfish, y el worker nunca habla con clientes. La única coordinación entre ellos es la base de datos.

---

## 🏗 Arquitectura

```
                          ┌──────────────────────┐
                          │   Vercel · Frontend  │
                          │   Next.js 14 + TS    │
                          └──────────┬───────────┘
                       HTTPS         │   WebSocket
                                     ▼
                          ┌──────────────────────┐
                          │   Render · Backend   │
                          │   Express + Socket.io│
                          │   (fuente de verdad  │
                          │    de partidas live) │
                          └──────────┬───────────┘
                                     │
                              service_role key
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │     Supabase (PG)    │
                          │  users · games ·     │
                          │  game_analyses       │
                          └──────────┬───────────┘
                                     │
                          claim_pending_analysis()
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  Render · Worker     │
                          │  Node + Stockfish    │
                          │  (Dockerfile)        │
                          └──────────────────────┘
```

### Flujos clave

**Juego en vivo.** Cliente envía `game:move` por Socket.io → backend valida con `chess.js` (autoridad), aplica reloj, persiste el move, y rebroadcastea a ambos jugadores. El cliente nunca decide si una jugada es legal.

**Final de partida.** `endGame()` persiste `games.status='finished'` + `pgn` final, y emite `INSERT INTO game_analyses (status='pending')` no-bloqueante.

**Análisis post-partida.** El worker hace polling cada 4 s al RPC `claim_pending_analysis()` (con `FOR UPDATE SKIP LOCKED`) → analiza con Stockfish → escribe `moves_analysis`, `summary`, `elo_white/black` con `status='done'`. Soporta múltiples workers en paralelo sin race conditions.

**Frontend de análisis.** La página `/game/[id]/analysis` hace `GET /api/games/:id/analysis` y polea cada 4 s mientras el status sea `pending` o `running`. Cuando el status es `done`, renderiza la UI completa.

---

## 🧱 Stack y decisiones de diseño

| Decisión | Razón |
|---|---|
| **Express simple, no NestJS** | MVP sin overhead de DI/decorators. Migrable cuando crezca. |
| **Socket.io con rooms `game:<id>`** | Reconexión automática + adapter Redis para escalar horizontalmente sin reescribir. |
| **chess.js en el SERVIDOR** | El cliente nunca es autoridad de jugadas. Imposible hackear el juego desde DevTools. |
| **JWT propio (no Supabase Auth)** | Independencia de proveedor; portar a Auth0/Cognito es cambiar 1 archivo. |
| **Worker como proceso separado** | Stockfish (CPU-bound) jamás bloquea el event loop del backend. |
| **Polling DB en lugar de Redis/BullMQ** | MVP sin infraestructura extra. El `FOR UPDATE SKIP LOCKED` ya da garantías ACID multi-worker. |
| **Estado en memoria (matchmaking, partidas activas)** | Cero latencia. Migrar a Redis cuando haya N réplicas — el contrato (`findMatch`, `removeFromQueues`) ya está aislado. |

---

## 📂 Estructura del repositorio

```
chess-colombia/
├── frontend/                # Next.js 14 + TypeScript + Tailwind
│   ├── src/
│   │   ├── app/             # rutas (App Router)
│   │   ├── components/      # Clock, EvalBar, MoveList, EngineLines, …
│   │   ├── hooks/useGame.ts # ciclo de vida de la partida (estado + sockets)
│   │   ├── lib/             # api.ts, socket.ts, auth.ts (Zustand)
│   │   └── types/
│   └── README.md
│
├── backend/                 # Node + Express + Socket.io
│   ├── src/
│   │   ├── config/          # env, supabase
│   │   ├── controllers/
│   │   ├── middleware/      # auth (JWT), rate-limit, error
│   │   ├── routes/
│   │   ├── services/        # auth, game, matchmaking
│   │   ├── sockets/         # gameHandler.js (motor del juego)
│   │   ├── utils/           # validators (zod), jwt
│   │   ├── app.js
│   │   └── server.js
│   └── README.md
│
├── worker/                  # Node + Stockfish — Dockerizado
│   ├── src/
│   │   ├── engine.js        # wrapper UCI sobre child_process
│   │   ├── analyzer.js      # PGN → posiciones → métricas
│   │   ├── metrics.js       # accuracy (Lichess), Elo heurístico
│   │   ├── db.js            # claim/markDone/markFailed
│   │   └── index.js         # loop de polling
│   ├── Dockerfile           # node:20-bookworm-slim + stockfish (apt)
│   ├── .dockerignore
│   └── README.md
│
├── database/
│   ├── schema.sql                          # esquema completo (instalación nueva)
│   ├── migration_001_oauth_and_banned.sql  # google_id + banned + RLS
│   └── migration_002_analysis.sql          # game_analyses + RPC
│
├── render.yaml              # Blueprint declarativo (backend + worker)
├── ejecutar.txt             # Quick-start sin ambigüedad
└── README.md                # ← este archivo
```

---

## 💻 Setup local

### Prerrequisitos

- **Node 18+** y npm.
- Una cuenta gratuita en [Supabase](https://supabase.com).
- **Stockfish** (sólo para correr el worker localmente):

  | OS      | Comando                                  | Ruta resultante              |
  |---------|------------------------------------------|------------------------------|
  | macOS   | `brew install stockfish`                 | `/opt/homebrew/bin/stockfish`|
  | Ubuntu  | `sudo apt install stockfish`             | `/usr/games/stockfish`       |
  | Windows | descargar de [stockfishchess.org](https://stockfishchess.org/download/) | el .exe que descargues |

  Verifica:
  ```bash
  stockfish
  > uci
  > quit
  ```

### 1) Crear y migrar la base de datos

1. Crea un proyecto en supabase.com (free).
2. En **SQL Editor**, ejecuta en orden:
   - `database/schema.sql`
   - `database/migration_001_oauth_and_banned.sql`
   - `database/migration_002_analysis.sql`
3. En **Project Settings → API**, copia:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_KEY` *(secreta — sólo backend/worker)*

### 2) Backend

```bash
cd backend
cp .env.example .env
#   Llena: SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET, CLIENT_ORIGIN
#   JWT_SECRET aleatorio:
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
#   Llena: SUPABASE_URL, SUPABASE_SERVICE_KEY, STOCKFISH_PATH (si no está en PATH)
npm install
npm start            # ✓ Stockfish listo (depth=12, multipv=3)
```

### Validar end-to-end

1. Abre dos navegadores (uno normal + uno incógnito).
2. Crea dos cuentas distintas.
3. Ambos: **Jugar → Buscar rival** → emparejados.
4. Mueven piezas → sincronización en vivo.
5. Termina la partida (mate, rendición, o tiempo).
6. Click en **"Ver análisis"** → primero "Analizando…", luego (10–30s) UI completa con eval bar.
7. En la consola del worker debe aparecer: `[worker] ✓ <gameId> en X.Xs (W:88% B:81%, Elo W:1620 B:1380)`.

---

## 🚀 Despliegue en producción

### Frontend → Vercel

1. Sube el repo a GitHub.
2. En Vercel: **Import Project** → seleccionar el repo.
3. **Root Directory:** `frontend`
4. Variables:
   | Var | Valor |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | URL pública del backend (sin slash) |
   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | (opcional) |
5. Deploy.

### Backend + Worker → Render (con Blueprint)

**Opción A — Blueprint (recomendado):**

1. Render Dashboard → **New +** → **Blueprint**.
2. Conectar el repo. Render leerá `render.yaml`.
3. Ajustar las variables marcadas `sync: false`:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (en ambos servicios)
   - `CLIENT_ORIGIN` (la URL de Vercel sin slash)
4. **Apply**. Render construye y arranca ambos servicios.

**Opción B — Manual:**

- **Backend** (Web Service): root `backend`, build `npm install`, start `npm start`. Env vars del `.env.example`.
- **Worker** (Background Worker, Docker): root `worker`, Dockerfile incluido. Variables del `.env.example`.

### Costos estimados (free tier)

| Servicio    | Plan                    | Mensual |
|-------------|-------------------------|---------|
| Vercel      | Hobby                   | US$0    |
| Render Web  | Free (750h)             | US$0    |
| Render Worker | Starter (recomendado para Stockfish) | US$7   |
| Supabase    | Free (500MB)            | US$0    |
| **Total**   |                         | **US$0–7/mes** |

Si quieres forzar a 0$, el worker también corre en plan Free, sólo que con menos RAM y tiempo de análisis más largo. Aceptable para tráfico bajo.

---

## 🔐 Variables de entorno

### Backend

| Var | Requerida | Default | Notas |
|---|---|---|---|
| `PORT` | no | 4000 | |
| `NODE_ENV` | no | development | |
| `CLIENT_ORIGIN` | sí | http://localhost:3000 | URL del frontend para CORS y Socket.io |
| `SUPABASE_URL` | sí | — | URL del proyecto |
| `SUPABASE_SERVICE_KEY` | sí | — | service_role; **nunca al cliente** |
| `JWT_SECRET` | sí | — | 48+ bytes aleatorios |
| `JWT_EXPIRES_IN` | no | 7d | |
| `GOOGLE_CLIENT_ID` | no | — | Si vacío, deshabilita login con Google |

### Frontend

| Var | Requerida | Default | Notas |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | sí | http://localhost:4000 | URL pública del backend |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | no | — | Mismo client ID que el backend |

### Worker

| Var | Requerida | Default | Notas |
|---|---|---|---|
| `SUPABASE_URL` | sí | — | Mismo proyecto que el backend |
| `SUPABASE_SERVICE_KEY` | sí | — | service_role |
| `STOCKFISH_PATH` | no | `stockfish` | Ruta al binario; en Docker `/usr/games/stockfish` |
| `ENGINE_DEPTH` | no | 12 | 12–15 razonable; más alto = más lento |
| `ENGINE_MULTIPV` | no | 3 | Líneas por posición |
| `POLL_INTERVAL_MS` | no | 4000 | Frecuencia de polling |
| `MAX_PLIES` | no | 200 | Tope de jugadas a analizar |

---

## 🗄 Migraciones SQL

Las migraciones están en `database/`, **idempotentes** (usan `IF NOT EXISTS`). Ejecútalas en orden en Supabase SQL Editor:

| Archivo | Aporta |
|---|---|
| `schema.sql` | Tablas base `users`, `games`. Sólo para instalación nueva. |
| `migration_001_oauth_and_banned.sql` | `users.google_id`, `users.banned`, `password_hash` nullable. |
| `migration_002_analysis.sql` | Tabla `game_analyses` + RPC `claim_pending_analysis()`. |

---

## 🔧 Operación y diagnóstico

### Logs del backend

```
[socket] conectado <username> (<socketId>)
[MATCHMAKING] En cola: <user> (countryFilter=GLOBAL, timeControl=10+0)
[MATCHMAKING] Match encontrado: <a> vs <b> (timeControl=5+0, pool=GLOBAL)
[MATCHMAKING] Estado de colas: { '5+0': { CO: 0, GLOBAL: 0 }, ... }
[GAME:STATE] request de <user> (requested=<id>, mapped=<id>, resolved=<id>)
[GAME:STATE] snapshot enviado a <user> (gameId=<id>, color=w)
```

### Logs del worker

```
[worker] Procesando <gameId> ...
[worker]   <gameId>: 41/41 posiciones
[worker] ✓ <gameId> en 14.7s (W:88.3% B:81.4%, Elo W:1620 B:1380)
```

### Reintentar análisis fallidos

```sql
update game_analyses set status='pending', error_message=null where status='failed';
```

### Banear un usuario

```sql
update users set banned=true, banned_reason='trampa con motor', banned_at=now()
where username='X';
```
El usuario perderá acceso al refrescar (incluso con JWT vivo: `getPublicProfile` revalida).

### Cold-start del backend (free tier de Render)

Render duerme el web service tras 15 min de inactividad. La primera petición tras dormir tarda ~30s en levantar. **Workaround:** el plan Starter (US$7) lo mantiene encendido. Para mantener el worker activo: ya lo está siempre (los workers no se duermen).

---

## 🗺 Roadmap

Lo que **ya funciona**:

- ✅ Auth (email/password + Google)
- ✅ Matchmaking con filtro Colombia / Global y fallback automático
- ✅ Cuatro time controls (1+0, 3+0, 5+0, 10+0)
- ✅ Reloj server-side con flag detection
- ✅ Reconexión sin perder estado (30 s de gracia)
- ✅ Anti-cheat base: validación server-side + campo `banned`
- ✅ Análisis post-partida con Stockfish
- ✅ Estimación de Elo + accuracy estilo Lichess

**Próximo:**

- ⏳ Tablas de líder (rankings nacionales por país)
- ⏳ Espectadores (rooms read-only)
- ⏳ Variantes de tiempo con incremento (`3+2`, `5+5`, …)
- ⏳ Torneos suizos
- ⏳ Detección automática de trampa: comparación con Stockfish + ACPL anómalo + patrones de tiempo
- ⏳ Premium: análisis a depth alto, chat con voz, lecciones

**Diseñado pero no implementado** (sólo conectar piezas):

- Migrar matchmaking a Redis para múltiples instancias del backend
- Adapter Redis de Socket.io
- Colas de análisis con prioridad (premium primero)

---

## 📜 Licencia

MIT. Sentite libre de hacer fork, contribuir, o levantar tu propia instancia.

---

<div align="center">

**Hecho con ♞ y café en Colombia 🇨🇴**

*Patrimonio · Comunidad · Juego limpio*

</div>
