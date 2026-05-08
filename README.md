# ♞ Ajedrez.co — Plataforma de ajedrez online (MVP)

Plataforma web para jugar ajedrez en tiempo real entre dos personas, con foco
inicial en jugadores de **Colombia** (filtro de país) y abierta al mundo.
MVP construido sobre **infraestructura gratuita** y diseñado para escalar sin
reescritura completa.

---

## 🧱 Arquitectura

```
┌──────────────┐     HTTPS / WebSocket     ┌──────────────┐
│   Frontend   │  <─────────────────────▶  │   Backend    │
│  Next.js 14  │   /api/* + Socket.io      │ Node + Express│
│   (Vercel)   │                           │  (Render/Fly) │
└──────────────┘                           └──────┬───────┘
                                                  │
                                                  │ supabase-js
                                                  ▼
                                          ┌──────────────┐
                                          │   Supabase   │
                                          │ (PostgreSQL) │
                                          └──────────────┘
```

### Por qué cada pieza

| Capa            | Tecnología               | Razón                                                                 |
|-----------------|--------------------------|-----------------------------------------------------------------------|
| Frontend        | Next.js 14 + TS + Tailwind | App Router moderno, hosting gratis en Vercel, SSR cuando haga falta.  |
| Tablero         | `chess.js` + `react-chessboard` | Estándar de facto, validación local + UI sólida.                |
| Backend HTTP    | Express                  | MVP simple, sin ceremonia de NestJS. Migrable a NestJS si crece.      |
| Tiempo real     | Socket.io                | Reconexión automática, fallback a polling, rooms por partida.         |
| Validación de jugadas | `chess.js` **en el server** | El cliente no es de confianza. Toda jugada se valida server-side. |
| Persistencia    | Supabase (PostgreSQL)    | Free tier generoso, SQL real, migrable a Postgres autogestionado.     |
| Auth            | JWT + bcrypt (propios)   | Independencia de proveedor, fácil de portar.                          |
| Hosting backend | Render / Fly.io          | Free tier con WebSockets soportados.                                  |

### Modularidad pensada para crecer

- **Estado de partidas en memoria** → migrar a Redis cuando haya réplicas (`gameHandler.js` y `matchmakingService.js` están aislados).
- **Socket.io** ya soporta el adapter de Redis para multi-instancia.
- **Auth con JWT propio** evita atarse a Supabase Auth → migrable a OAuth/Auth0/Cognito.
- **Cliente Supabase encapsulado** en `backend/src/config/supabase.js` → cambiar de DB sólo toca un archivo.

---

## 📂 Estructura del repositorio

```
chess-colombia/
├── backend/        # API REST + Socket.io
│   └── README.md   # detalle del backend
├── frontend/       # Next.js
│   └── README.md   # detalle del frontend
├── database/
│   └── schema.sql  # ejecutar UNA VEZ en Supabase
└── README.md       # este archivo
```

---

## 🚀 Arranque local (paso a paso)

### 1. Crear proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) → New Project (free).
2. En **SQL Editor**, pegar y ejecutar `database/schema.sql`.
3. En **Project Settings → API**, copiar:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_KEY`  *(nunca exponer al cliente)*

### 2. Backend

```bash
cd backend
cp .env.example .env
# Editar .env con SUPABASE_URL, SUPABASE_SERVICE_KEY y JWT_SECRET
# Generar JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm install
npm run dev          # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:4000

npm install
npm run dev          # http://localhost:3000
```

### 4. Probar

1. Abrir `http://localhost:3000` en dos navegadores (o uno + ventana incógnita).
2. Crear dos cuentas distintas.
3. En ambas: **Jugar → Buscar rival** → se emparejan y arranca la partida.
4. Mover una pieza → se sincroniza en vivo en la otra ventana.
5. Cerrar una pestaña: la otra recibe `opponent:disconnected`. Reabrir antes de 30s → se reconecta. Si pasan 30s → ganas por abandono.

---

## ✅ Checklist de funcionalidades MVP (incluidas)

- [x] Registro y login con email/username + password (bcrypt + JWT).
- [x] Sesión persistente (localStorage del JWT, hidratación al cargar).
- [x] Lobby con matchmaking simple por (timeControl + país).
- [x] Filtro **Colombia** (sólo jugadores `country='CO'` se cruzan entre sí).
- [x] Filtro **Global** (cruza con cualquiera).
- [x] Partida en tiempo real con WebSockets.
- [x] Validación de jugadas en el servidor (chess.js como autoridad).
- [x] Detección de jaque mate, ahogado, triple repetición, material insuficiente.
- [x] Rendición.
- [x] Reconexión automática (30s de gracia antes de declarar abandono).
- [x] Persistencia de partidas (moves en JSONB + PGN + FEN).
- [x] Historial por usuario.
- [x] Rate limiting básico en endpoints de auth y API.
- [x] Helmet, CORS configurado, validación con Zod.

## 🗺️ Preparado pero NO implementado (para fases siguientes)

Estos puntos están **diseñados** en la arquitectura para no requerir
reescritura cuando se aborden:

- **Anti-cheat con Stockfish**: el servidor ya guarda PGN + FEN por jugada (campo `moves` en `games`). Un worker offline puede consumir partidas terminadas y calcular precisión / detección de patrones, sin tocar la lógica en vivo.
- **Reloj de partida (timeouts)**: el campo `time_control` y los timestamps en cada movimiento ya están almacenados; agregar un timer en `gameHandler.js` y emitir `game:end` con `termination='timeout'`.
- **Torneos / matchmaking por rating**: la cola actual está aislada en `matchmakingService.js`; agregar buckets por rango de rating o sistema Swiss.
- **Migración a Redis**: `activeGames`, `userToGame` y las colas de matchmaking son las únicas estructuras stateful — todas tras una API que se puede reimplementar contra Redis.
- **Membresías / pagos**: agregar tabla `subscriptions` y middleware de plan, sin tocar la lógica de juego.

---

## 🔐 Notas de seguridad

- Las contraseñas se hashean con **bcrypt (cost=10)**.
- Los tokens JWT viajan en `Authorization: Bearer <token>` y se firman con `JWT_SECRET` (rotable).
- **Toda** entrada del cliente se valida con Zod antes de tocar la base.
- El backend usa la **service_role key** de Supabase (sólo en el server). El cliente nunca habla directo con la DB.
- `helmet` y `cors` en Express.
- Rate limit por IP: 20 intentos/15min en `/api/auth/*`, 120 req/min globales.
- En producción, considerar mover el JWT a una cookie `httpOnly`+`Secure`+`SameSite=Lax` para mitigar XSS.

---

## 📦 Despliegue gratuito recomendado

| Servicio   | Plataforma | Notas |
|------------|-----------|-------|
| Frontend   | **Vercel** | Conectar repo, root `frontend`, var `NEXT_PUBLIC_API_URL`. |
| Backend    | **Render** (web service free) o **Fly.io** | Soportan WebSockets. Build: `npm install`. Start: `npm start`. |
| Database   | **Supabase** (free) | 500 MB, suficiente para miles de partidas. |

Asegúrate en producción de:

- Setear `CLIENT_ORIGIN` en el backend a la URL exacta de Vercel (sin slash final).
- Setear `NEXT_PUBLIC_API_URL` en Vercel a la URL pública del backend (sin slash final).
- Generar un `JWT_SECRET` largo y único por entorno.

---

## 🧠 Filosofía de desarrollo

> **Primero funcionalidad, después optimización.**
> No hay microservicios, ni Redis, ni cluster. Hay un backend simple y honesto
> con todas las costuras visibles en el lugar correcto para crecer cuando haga falta.

