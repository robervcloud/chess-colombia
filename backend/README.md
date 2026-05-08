# Backend - Chess Colombia

API REST + WebSockets en Node.js (Express + Socket.io).
Persistencia en Supabase (PostgreSQL).

## Estructura

```
src/
├── config/        # env y cliente de Supabase
├── controllers/   # capa HTTP delgada
├── middleware/    # auth, rate limit, errores
├── routes/        # endpoints REST
├── services/      # lógica de negocio (auth, games, matchmaking)
├── sockets/       # Socket.io: handshake + gameHandler
├── utils/         # jwt, validators (zod)
├── app.js         # app de Express
└── server.js      # bootstrap HTTP + Socket.io
```

## Requisitos

- Node.js 18+
- Una cuenta en [Supabase](https://supabase.com) (free tier)

## Setup

1. **Instalar dependencias**
   ```bash
   npm install
   ```

2. **Crear el proyecto en Supabase** y, en el SQL Editor, pegar y ejecutar el contenido de `../database/schema.sql`.

3. **Crear `.env`** copiando el ejemplo:
   ```bash
   cp .env.example .env
   ```
   Luego rellenar `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y un `JWT_SECRET` largo:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. **Correr en desarrollo**
   ```bash
   npm run dev
   ```
   El servidor queda en `http://localhost:4000`.

## Endpoints REST

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET    | `/health`            | no | Healthcheck |
| POST   | `/api/auth/register` | no | Crea usuario, devuelve `{user, token}` |
| POST   | `/api/auth/login`    | no | Login con email o username |
| GET    | `/api/auth/me`       | sí | Perfil del usuario actual |
| GET    | `/api/games/history` | sí | Últimas 30 partidas del usuario |
| GET    | `/api/games/:id`     | sí | Detalle de una partida |

## Eventos Socket.io

El cliente debe conectar con:
```js
io(BACKEND_URL, { auth: { token: '<jwt>' } })
```

| Evento (cliente → server)        | Payload                                                          | Respuesta (ack)                                  |
|----------------------------------|------------------------------------------------------------------|--------------------------------------------------|
| `match:find`                     | `{ countryFilter:'CO'\|'GLOBAL', timeControl:'10+0' }`          | `{ ok, status:'queued'\|'matched', gameId? }`   |
| `match:cancel`                   | —                                                                | `{ ok }`                                         |
| `game:move`                      | `{ gameId, from, to, promotion? }`                              | `{ ok, error? }`                                 |
| `game:resign`                    | `{ gameId }`                                                     | `{ ok }`                                         |

| Evento (server → cliente)        | Payload                                                                                                |
|----------------------------------|--------------------------------------------------------------------------------------------------------|
| `match:found`                    | `{ gameId, color, white, black, fen, pgn, turn, ... }`                                                |
| `game:state`                     | Igual que `match:found`. Se emite tras reconectar.                                                    |
| `game:move`                      | `{ gameId, move, fen, pgn, turn }`                                                                    |
| `game:end`                       | `{ gameId, result, termination, fen, pgn }`                                                           |
| `opponent:disconnected`          | `{ username }` — el rival se desconectó (tiene 30s para volver).                                      |
| `opponent:reconnected`           | `{ username }`                                                                                         |

## Decisiones de arquitectura

- **El servidor es la fuente de verdad**: las jugadas se validan con `chess.js` aquí. El cliente sólo pinta.
- **Estado de partidas en memoria** (`activeGames` en `gameHandler.js`). Migrar a Redis cuando haya múltiples instancias — la API interna ya está aislada.
- **Matchmaking en memoria** (`matchmakingService.js`). Mismo plan: mover a Redis sin cambiar el contrato.
- **Auth con JWT propio** (no Supabase Auth) para no atarse a un proveedor.
- **Rate limiting in-memory**. Cuando haya réplicas, usar `rate-limit-redis`.

## Despliegue gratis

Recomendado: **Render** o **Fly.io** (Railway funciona pero su free tier es limitado).
- Subir el repo, crear un Web Service apuntando a `/backend`.
- Build: `npm install`. Start: `npm start`.
- Configurar las variables de entorno del `.env.example`.
- Asegurarse de habilitar WebSockets en la plataforma (Render lo hace por default).
