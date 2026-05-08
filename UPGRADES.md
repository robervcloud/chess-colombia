# UPGRADES — Matchmaking, OAuth y base anti-cheat

Resumen de los cambios aplicados sobre el MVP. **Cero cambios de
arquitectura, cero cambios de tecnologías, frontend y backend siguen
siendo compatibles entre sí.**

---

## 1) Migración SQL (correrla una vez en Supabase)

Archivo: `database/migration_001_oauth_and_banned.sql`

```sql
alter table users alter column password_hash drop not null;
alter table users add column if not exists google_id varchar(64) unique;
alter table users add column if not exists banned boolean not null default false;
alter table users add column if not exists banned_at timestamptz;
alter table users add column if not exists banned_reason text;
-- + índices
```

Si tu instalación es nueva: `database/schema.sql` ya incluye todo.

---

## 2) Matchmaking (`backend/src/services/matchmakingService.js`) — REESCRITO

**Misma API pública** (`findMatch`, `removeFromQueues`, `stats`) más:
`pruneQueues`, `promoteToGlobal`, `isQueued`, `ALLOWED_TIME_CONTROLS`.

### Problemas resueltos

| Problema | Solución |
|---------|----------|
| **A. Usuarios fantasma en cola** | `pruneQueues(isSocketAlive)` se llama al inicio de cada `findMatch`. Elimina entradas sin `socketId`, sin `userId`, o cuyo socket ya no existe en el servidor. |
| **B. Validación débil al elegir oponente** | `findMatch` ahora usa `isValidPlayer(p, isSocketAlive)` en vez de un simple `p.userId !== player.userId`. Verifica `userId`, `socketId` y socket vivo. |
| **Duplicados** | `findMatch` llama `removeFromQueues(player.userId)` antes de meterlo en cola. Garantía: un usuario no puede estar en dos colas simultáneas. |
| **Time controls libres (string)** | Whitelist `ALLOWED_TIME_CONTROLS = ['1+0','3+0','5+0','10+0']`. `findMatch` lanza error si no está. |

### Logs (todos prefijados con `[MATCHMAKING]`)

```
[MATCHMAKING] En cola: <username> (countryFilter=CO, timeControl=10+0)
[MATCHMAKING] Match encontrado: <a> vs <b> (timeControl=10+0, pool=GLOBAL)
[MATCHMAKING] Estado de colas: { '10+0': { CO: 0, GLOBAL: 1 }, ... }
[MATCHMAKING] Eliminando fantasma de 10+0/CO: <username> <userId>
[MATCHMAKING] pruneQueues: 2 fantasmas eliminados
[MATCHMAKING] removeFromQueues: <userId> eliminado de 1 cola(s)
[MATCHMAKING] Promovido CO->GLOBAL por timeout: <username> (10+0)
[MATCHMAKING] Hard timeout para <username>
[MATCHMAKING] Socket desconectado: <username> (<userId>)
```

---

## 3) Socket handler (`backend/src/sockets/gameHandler.js`)

**Cambios mínimos**, sin tocar el resto del archivo.

- `isSocketAlive(socketId) -> boolean`: pasa a `findMatch` para validar oponentes vivos en este servidor.
- `completeMatch(me, opponent)`: helper compartido que crea la partida y notifica (lo usa el match inmediato y el match post-promoción).
- **Timer 1 — `MATCH_PROMOTE_MS = 8 s`**: si el jugador buscó CO y sigue en cola, se promueve a GLOBAL automáticamente y se intenta match otra vez. Al cliente le llega:
  - `match:expanded { from: 'CO', to: 'GLOBAL' }` si quedó en cola GLOBAL.
  - `match:found` si encontró rival al ampliar.
- **Timer 2 — `MATCH_HARD_TIMEOUT_MS = 25 s`**: si tras los 25 s sigue sin match, se saca de la cola y se le emite `match:timeout`.
- `disconnect`: limpia los timers y llama `removeFromQueues(user.id)`. Logueado.
- `match:cancel`: idem, limpia los timers.

---

## 4) Validadores (`backend/src/utils/validators.js`)

```js
matchmakingSchema.timeControl  // ahora es z.enum(ALLOWED_TIME_CONTROLS)
googleAuthSchema               // nuevo: { idToken, preferredUsername? }
```

Cualquier intento del cliente de pasar un `timeControl` no permitido recibe **400** antes de tocar la lógica de matchmaking.

---

## 5) Autenticación con Google

### Backend

| Archivo | Cambio |
|---------|--------|
| `backend/package.json` | + `google-auth-library@^9.13.0` |
| `backend/.env.example` | + `GOOGLE_CLIENT_ID=` |
| `backend/src/config/env.js` | + `google.clientId` (opcional; si está vacío, /api/auth/google responde 503) |
| `backend/src/services/authService.js` | + `loginWithGoogle({ idToken, preferredUsername })` |
| `backend/src/controllers/authController.js` | + `googleAuth` |
| `backend/src/routes/auth.js` | + `POST /api/auth/google` |

**Flujo en el servicio**:

1. Verifica el ID Token con `OAuth2Client.verifyIdToken` y exige `email_verified=true`.
2. Busca por `google_id` → log in.
3. Si no, busca por `email` → enlaza la cuenta existente (set `google_id`) y log in. **La password sigue funcionando**, lo cual mantiene 100% de compatibilidad con el flujo existente.
4. Si no existe, crea cuenta con username derivado del email (sanitizado, único).
5. En todos los caminos: chequeo `banned`.

### Frontend

| Archivo | Cambio |
|---------|--------|
| `frontend/.env.example` | + `NEXT_PUBLIC_GOOGLE_CLIENT_ID=` |
| `frontend/src/lib/auth.ts` | + `loginWithGoogle(idToken, preferredUsername?)` |
| `frontend/src/components/GoogleSignInButton.tsx` | NUEVO — carga GSI y renderiza el botón oficial. Si no hay client ID, no se renderiza nada. |
| `frontend/src/app/login/page.tsx` | + botón Google + divisor "o" |
| `frontend/src/app/register/page.tsx` | + botón Google + divisor "o" |

**El login email/password sigue funcionando exactamente igual.**

### Cómo configurar Google (5 minutos)

1. Ir a https://console.cloud.google.com/apis/credentials
2. **Create credentials → OAuth Client ID → Web application**
3. *Authorized JavaScript origins*:
   - Desarrollo: `http://localhost:3000`
   - Producción: la URL de Vercel
4. Copiar el **Client ID** (es el mismo en backend y frontend):
   - `backend/.env`: `GOOGLE_CLIENT_ID=...`
   - `frontend/.env.local`: `NEXT_PUBLIC_GOOGLE_CLIENT_ID=...`
5. `cd backend && npm install` para instalar `google-auth-library`.

---

## 6) Base para anti-cheat

Sólo preparación. **No se ejecuta nada todavía.**

- `users.banned` (boolean, default false). Verificado en cada `login`, `loginWithGoogle` y `getPublicProfile` → un usuario baneado pierde acceso aunque su JWT siga vigente.
- `users.banned_at`, `users.banned_reason` para auditoría.
- `users.email` ya era `UNIQUE NOT NULL`, sigue siéndolo. Esto permite a futuro **bloqueo por email** simplemente seteando `banned=true`.
- `users.google_id` único y opcional → puedes bloquear también cuentas creadas vía OAuth sin password.

---

## 7) Selección de tiempo (UX)

`frontend/src/app/lobby/page.tsx` ahora muestra cuatro botones (1 / 3 / 5 / 10 min) además del filtro de país. El valor seleccionado se manda al servidor.

El servidor valida la whitelist; si llegara un valor inválido, responde error sin meter al usuario en una cola "fantasma".

---

## 8) Nuevos eventos Socket.io

| Evento (server → cliente) | Cuándo |
|---|---|
| `match:expanded { from, to }` | El backend amplió la búsqueda de CO a GLOBAL tras 8 s sin match. |
| `match:timeout { message }`   | Pasaron 25 s en cola sin match. El backend ya retiró al usuario de la cola. |

El lobby los maneja y muestra mensajes apropiados.

---

## ✅ Checklist de despliegue

- [ ] Correr `database/migration_001_oauth_and_banned.sql` en Supabase.
- [ ] Backend: `cd backend && npm install` (instala `google-auth-library`).
- [ ] Definir `GOOGLE_CLIENT_ID` en backend y `NEXT_PUBLIC_GOOGLE_CLIENT_ID` en frontend (mismo valor).
- [ ] Reiniciar backend.
- [ ] Reiniciar frontend (en Vercel se hace solo al deployar).
- [ ] Probar:
  - [ ] Login email/password (regresión).
  - [ ] Registro email/password (regresión).
  - [ ] Botón "Continuar con Google" en /login y /register.
  - [ ] Lobby con cada uno de los 4 tiempos.
  - [ ] Filtro CO con un solo jugador → tras 8 s recibe `match:expanded`.
  - [ ] 25 s sin rival → recibe `match:timeout` y la UI vuelve al estado inicial.
  - [ ] Cerrar pestaña en cola → el usuario desaparece de la cola (verificable con `[MATCHMAKING] Estado de colas`).
  - [ ] Banned manual: `update users set banned=true, banned_reason='test' where username='X'` → ese usuario pierde acceso al refrescar / volver a loguearse.
