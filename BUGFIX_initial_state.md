# BUGFIX — "Cargando partida…" hasta refresh manual

## Diagnóstico

Race condition entre Socket.io y el ciclo de vida de React Router.

```
┌──────────────────┐   match:found   ┌──────────────┐
│   Backend (io)   │ ───────────────▶│ Lobby         │
│ completeMatch()  │                 │ router.push() │
└──────────────────┘                 └──────┬───────┘
                                            │
                                     unmount │  (listeners off)
                                            ▼
                                     ┌──────────────┐
                                     │ /game/[id]   │  ← monta DESPUÉS del evento
                                     │ useGame()    │     listeners llegan tarde
                                     └──────────────┘
```

`match:found` se emitió **una sola vez**, lo recibió el lobby, navegó, y para
cuando `useGame` registró sus listeners el evento ya pasó. La lógica de
reconexión del backend (`register()`) sólo dispara en `connect`, no en
navegación SPA — por eso al hacer F5 sí funcionaba (nuevo socket → nuevo
`connect` → reemite `game:state`).

## Patrón de solución

> El cliente **pide activamente** el snapshot al montar, en lugar de esperar
> un evento que ya pasó.

Existían tres puntos donde la primera versión del fix se rompía. Esta
iteración los cierra todos.

---

### 1) Backend: `gameId` del cliente como fuente primaria

`backend/src/sockets/gameHandler.js` — handler `game:request_state`

**Antes:** dependía exclusivamente de `userToGame.get(user.id)`. Si por
cualquier razón ese mapa no estaba poblado en ese instante (race con
`startGame()`, restart del server, desincronización), el handler respondía
`game:not_found` aunque la partida existiera de verdad.

**Ahora:** la URL del cliente es la fuente de verdad.

```js
const mappedId = userToGame.get(user.id);
const gameId   = requestedId || mappedId;     // <-- prioriza el del cliente
console.log(`[GAME:STATE] request de ${user.username} ` +
            `(requested=${requestedId}, mapped=${mappedId}, resolved=${gameId})`);

if (!gameId) { /* not_found */ }

const state = activeGames.get(gameId);
if (state) {
  // ... refresca socketId/connected, hace socket.join, emite game:state ...
  userToGame.set(user.id, gameId);            // auto-repara el mapa
  return;
}

// Si no está en memoria pero existe en DB y ya terminó -> emitir game:end.
// Cubre deep-links a partidas finalizadas.
```

### 2) Frontend: emit incondicional (no esperar `socket.connected`)

`frontend/src/hooks/useGame.ts`

**Antes:**
```ts
if (socket.connected) requestState();
socket.on('connect', requestState);
```
Si el socket estaba reconectándose o renegociando en ese microsegundo del
mount, la rama `if` no se cumplía y `connect` no se volvía a disparar
(porque ya estaba "casi" conectado). El emit nunca salía.

**Ahora:**
```ts
function requestState(reason: string) { socket.emit('game:request_state', { gameId }); }
requestState('mount');                  // siempre
socket.on('connect', () => requestState('socket-connect'));
```
Socket.io **bufferiza** los emits si el socket no está conectado y los manda
en cuanto se conecta. No hace falta el guard.

### 3) Frontend: retry tras 1.5 s

Si por cualquier motivo el primer emit se pierde (cleanup de StrictMode en
dev, packet loss, server reiniciando), un timer reintenta.

```ts
let snapshotReceived = false;
function applyState(p) { snapshotReceived = true; /* ... setReady(true) */ }

const retryTimer = setTimeout(() => {
  if (!snapshotReceived && !cancelled) requestState('retry-1500ms');
}, 1500);

return () => { clearTimeout(retryTimer); /* ... offs ... */ };
```

`applyState` (y `onEnd`, para partidas ya finalizadas) marca la flag local
`snapshotReceived`. El cleanup cancela el timer si el componente se desmonta
antes.

---

## Cambios menores incluidos

### Lobby: evitar `match:cancel` espurio

`frontend/src/app/lobby/page.tsx`

```ts
function onMatchFound(payload) {
  setSearching(false);                       // <-- antes faltaba
  router.push(`/game/${payload.gameId}`);
}
```

El cleanup del effect del lobby emitía `match:cancel` si `searching` seguía
en `true` al desmontar. No rompía nada (en backend `match:cancel` es
idempotente cuando no hay cola), pero ensuciaba los logs de matchmaking.

### `useGame`: marcar `ready=true` también al recibir `game:end` directo

Antes, si el cliente abría una partida ya finalizada (deep link a una
partida vieja), llegaba `game:end` pero `ready` seguía `false` → "Cargando…"
infinito. Ahora `onEnd` también pone `ready=true`.

---

## Logs útiles para diagnosticar

Backend:
```
[GAME:STATE] request de juanperez (requested=abc-123, mapped=abc-123, resolved=abc-123)
[GAME:STATE] snapshot enviado a juanperez (gameId=abc-123, color=w)
[GAME:STATE] partida abc-123 ya terminó, enviado game:end a juanperez
[GAME:STATE] juanperez NO participa en xyz-999
```

Frontend (DevTools console):
```
[useGame] request_state (mount)         { gameId: 'abc-123', connected: true }
[useGame] request_state (retry-1500ms)  { gameId: 'abc-123', connected: true }   // si hizo falta
[useGame] request_state (socket-connect){ gameId: 'abc-123', connected: true }   // tras reconexión
```

## Cómo verificar

1. Dos navegadores, dos cuentas, ambos hacen "Buscar rival".
2. Apenas se emparejan, el tablero abre **directamente** sin "Cargando…".
3. Cerrar una pestaña a media partida y volver a abrir la URL → cargado en < 1 s.
4. Pegar a mano `/game/<uuid-falso>` → redirige a `/lobby`.
5. Abrir `/game/<uuid-de-partida-ya-finalizada>` → renderiza el resultado final, no se queda cargando.
6. En consola del backend deben aparecer los logs `[GAME:STATE]`. Si no aparecen, el cliente no está emitiendo (problema de conexión, no de hidratación).

## Archivos tocados en esta iteración

- `backend/src/sockets/gameHandler.js` — handler `game:request_state` reescrito (más tolerante, usa `gameId` del cliente, fallback a DB para finalizadas, logs).
- `frontend/src/hooks/useGame.ts` — `useEffect` reescrito: emit incondicional + retry 1.5 s + flag `snapshotReceived` + `ready=true` también en `onEnd`.
- `frontend/src/app/lobby/page.tsx` — `setSearching(false)` antes de `router.push`.

## Lo que NO cambió

- Arquitectura general.
- Eventos existentes (`match:found`, `game:state`, `game:move`, `game:end`, `game:not_found`).
- Lógica de reconexión del socket en `register()` (sigue intacta como camino paralelo para refresh manual).
- Cualquier validación, autenticación o lógica de matchmaking.
