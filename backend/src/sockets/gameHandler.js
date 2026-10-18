/**
 * Handler de Socket.io para partidas en tiempo real.
 *
 * Principio fundamental: el SERVIDOR es la única fuente de verdad.
 * El cliente puede pintar lo que quiera; cualquier movimiento
 * se valida con chess.js en este archivo antes de aceptarlo.
 *
 * Estado en memoria por simplicidad (MVP). Para escalar:
 *   - Mover `activeGames` a Redis.
 *   - Usar el adapter de Socket.io con Redis para multi-instancia.
 *   - El resto del código no cambia.
 */
const { Chess } = require('chess.js');
const matchmaking = require('../services/matchmakingService');
const gameService = require('../services/gameService');
const { moveSchema, matchmakingSchema } = require('../utils/validators');
const { getBot } = require('../config/bots');
const { botBestMove } = require('../services/botService');

// Prefijo de userId virtual para bots (evita colisión con UUIDs reales).
const BOT_ID_PREFIX = 'bot:';

/**
 * activeGames: Map<gameId, GameState>
 *
 * GameState = {
 *   chess: Chess,                  // motor chess.js, FUENTE DE VERDAD
 *   white: { userId, username, socketId, connected },
 *   black: { userId, username, socketId, connected },
 *   countryFilter: 'CO' | 'GLOBAL',
 *   timeControl: string,
 *   abandonTimer: NodeJS.Timeout | null,
 * }
 */
const activeGames = new Map();

// Map<userId, gameId> para reconexiones
const userToGame = new Map();

const RECONNECT_GRACE_MS = 30_000; // 30s para reconectar antes de declarar abandono

// Timeouts del matchmaking
const MATCH_PROMOTE_MS = 8_000;   // 8s -> promover CO a GLOBAL
const MATCH_HARD_TIMEOUT_MS = 25_000; // 25s totales -> rendirse y emitir match:timeout

// userId -> { promote: Timeout|null, hard: Timeout|null }
const matchTimers = new Map();

function clearMatchTimers(userId) {
  const t = matchTimers.get(userId);
  if (!t) return;
  if (t.promote) clearTimeout(t.promote);
  if (t.hard) clearTimeout(t.hard);
  matchTimers.delete(userId);
}

// =====================================================================
// Reloj de partida (server-side, fuente de verdad)
// =====================================================================
const FLAG_GRACE_MS = 50; // pequeño slack para no disparar el flag justo en el borde

function parseTimeControlToMs(tc) {
  const m = /^(\d+)\+(\d+)$/.exec(String(tc || ''));
  if (!m) return 600_000;
  return parseInt(m[1], 10) * 60_000;
}

/**
 * Programa el flag-timer del JUGADOR ACTUAL.
 * Idempotente: limpia un timer previo si lo hubiera.
 * Si la partida ya terminó, no hace nada.
 */
function scheduleFlagTimer(io, gameId) {
  const state = activeGames.get(gameId);
  if (!state || state.chess.isGameOver()) return;
  if (state.flagTimer) {
    clearTimeout(state.flagTimer);
    state.flagTimer = null;
  }
  const turn = state.chess.turn();
  const base = turn === 'w' ? state.whiteMs : state.blackMs;
  const elapsed = Date.now() - (state.lastMoveAt || Date.now());
  const ms = Math.max(0, base - elapsed) + FLAG_GRACE_MS;
  state.flagTimer = setTimeout(() => {
    const live = activeGames.get(gameId);
    if (!live || live.chess.isGameOver()) return;
    const flagged = live.chess.turn();
    if (flagged === 'w') live.whiteMs = 0;
    else live.blackMs = 0;
    endGame(io, gameId, {
      winner: flagged === 'w' ? 'b' : 'w',
      termination: 'timeout',
    });
  }, ms);
}

function colorOf(state, userId) {
  if (state.white.userId === userId) return 'w';
  if (state.black.userId === userId) return 'b';
  return null;
}

function publicState(state) {
  // Extrapolar el reloj del jugador a mover. Si la partida terminó o no
  // tenemos lastMoveAt, devolvemos los valores tal cual (estáticos).
  let whiteMs = state.whiteMs ?? 0;
  let blackMs = state.blackMs ?? 0;
  if (!state.chess.isGameOver() && state.lastMoveAt) {
    const elapsed = Date.now() - state.lastMoveAt;
    if (state.chess.turn() === 'w') whiteMs = Math.max(0, whiteMs - elapsed);
    else blackMs = Math.max(0, blackMs - elapsed);
  }
  return {
    white: { userId: state.white.userId, username: state.white.username, connected: state.white.connected },
    black: { userId: state.black.userId, username: state.black.username, connected: state.black.connected },
    fen: state.chess.fen(),
    pgn: state.chess.pgn(),
    turn: state.chess.turn(),
    countryFilter: state.countryFilter,
    timeControl: state.timeControl,
    whiteMs,
    blackMs,
    isGameOver: state.chess.isGameOver(),
  };
}

/**
 * Crea una partida cuando el matchmaking junta a dos jugadores.
 * Persiste en DB y devuelve { gameId, state }.
 */
async function startGame(playerA, playerB) {
  // Asignamos colores aleatoriamente
  const aIsWhite = Math.random() < 0.5;
  const white = aIsWhite ? playerA : playerB;
  const black = aIsWhite ? playerB : playerA;

  const dbGame = await gameService.createGame({
    whiteId: white.userId,
    blackId: black.userId,
    whiteUsername: white.username,
    blackUsername: black.username,
    timeControl: playerA.timeControl,
    countryFilter: playerA.countryFilter === 'CO' && playerB.country === 'CO' ? 'CO' : 'GLOBAL',
  });

  const state = {
    chess: new Chess(),
    white: { userId: white.userId, username: white.username, socketId: white.socketId, connected: true },
    black: { userId: black.userId, username: black.username, socketId: black.socketId, connected: true },
    countryFilter: dbGame.country_filter,
    timeControl: dbGame.time_control,
    abandonTimer: null,
    // ----- Reloj -----
    whiteMs: parseTimeControlToMs(dbGame.time_control),
    blackMs: parseTimeControlToMs(dbGame.time_control),
    lastMoveAt: Date.now(), // el reloj de blancas arranca al crear la partida
    flagTimer: null,
  };

  activeGames.set(dbGame.id, state);
  userToGame.set(white.userId, dbGame.id);
  userToGame.set(black.userId, dbGame.id);

  return { gameId: dbGame.id, state };
}

/**
 * Termina una partida: persiste resultado y limpia memoria.
 */
async function endGame(io, gameId, { winner, termination }) {
  const state = activeGames.get(gameId);
  if (!state) return;

  let result;
  if (winner === 'w') result = '1-0';
  else if (winner === 'b') result = '0-1';
  else result = '1/2-1/2';

  try {
    await gameService.finishGame(gameId, {
      result,
      termination,
      fen: state.chess.fen(),
      pgn: state.chess.pgn(),
    });
  } catch (err) {
    console.error('[endGame] No se pudo persistir el final:', err);
  }

  io.to(`game:${gameId}`).emit('game:end', {
    gameId,
    result,
    termination,
    fen: state.chess.fen(),
    pgn: state.chess.pgn(),
    whiteMs: state.whiteMs ?? 0,
    blackMs: state.blackMs ?? 0,
  });

  // Glicko-2 — sólo en partidas humano vs humano (bots no afectan rating).
  if (!state.isBotGame) {
    try {
      const rt = await gameService.applyRatingForGame({
        whiteId: state.white.userId,
        blackId: state.black.userId,
        result,
        timeControl: state.timeControl,
        gameId,
      });
      if (rt) io.to(`game:${gameId}`).emit('rating:update', rt);
    } catch (err) {
      console.error('[endGame] rating no aplicado:', err);
    }
  }

  if (state.flagTimer) clearTimeout(state.flagTimer);
  if (state.abandonTimer) clearTimeout(state.abandonTimer);
  userToGame.delete(state.white.userId);
  userToGame.delete(state.black.userId);
  activeGames.delete(gameId);
}

// =====================================================================
// Registro de eventos
// =====================================================================
function register(io, socket) {
  // socket.user lo seteó el middleware de auth en sockets/index.js
  const user = socket.user;

  // ----- RECONEXIÓN automática a la partida activa del usuario -----
  const existingGameId = userToGame.get(user.id);
  if (existingGameId) {
    const state = activeGames.get(existingGameId);
    if (state) {
      const color = colorOf(state, user.id);
      if (color === 'w') {
        state.white.socketId = socket.id;
        state.white.connected = true;
      } else if (color === 'b') {
        state.black.socketId = socket.id;
        state.black.connected = true;
      }
      if (state.abandonTimer) {
        clearTimeout(state.abandonTimer);
        state.abandonTimer = null;
      }
      socket.join(`game:${existingGameId}`);
      socket.emit('game:state', { gameId: existingGameId, color, ...publicState(state) });
      socket.to(`game:${existingGameId}`).emit('opponent:reconnected', { username: user.username });
    }
  }

  // ----- Helper: verifica si un socketId sigue vivo en este servidor -----
  const isSocketAlive = (socketId) => {
    if (!socketId) return false;
    const s = io.sockets.sockets.get(socketId);
    return Boolean(s && s.connected);
  };

  // ----- Helper: dado un par de players ya validado, crea la partida y notifica -----
  async function completeMatch(mePlayer, opponentPlayer) {
    clearMatchTimers(mePlayer.userId);
    clearMatchTimers(opponentPlayer.userId);

    const { gameId, state } = await startGame(mePlayer, opponentPlayer);

    // El reloj de blancas empezó a contar en startGame; arrancamos su flag-timer
    scheduleFlagTimer(io, gameId);

    const meSocket = io.sockets.sockets.get(mePlayer.socketId);
    const oppSocket = io.sockets.sockets.get(opponentPlayer.socketId);
    meSocket?.join(`game:${gameId}`);
    oppSocket?.join(`game:${gameId}`);

    const payload = (color) => ({ gameId, color, ...publicState(state) });
    meSocket?.emit('match:found', payload(colorOf(state, mePlayer.userId)));
    oppSocket?.emit('match:found', payload(colorOf(state, opponentPlayer.userId)));

    return gameId;
  }

  // ----- BUSCAR PARTIDA -----
  socket.on('match:find', async (raw, ack) => {
    try {
      // Los invitados sólo juegan contra bots: así no afectan el rating
      // de jugadores reales ni se usan para abusar del matchmaking.
      if (user.guest) {
        return ack?.({
          ok: false,
          error: 'Crea una cuenta gratis para jugar online contra otras personas.',
        });
      }

      const { countryFilter, timeControl } = matchmakingSchema.parse(raw || {});

      // Si Colombia es requerido, el jugador DEBE ser de CO
      if (countryFilter === 'CO' && user.country !== 'CO') {
        return ack?.({ ok: false, error: 'El filtro Colombia requiere ser jugador colombiano.' });
      }

      const me = {
        userId: user.id,
        username: user.username,
        country: user.country,
        socketId: socket.id,
        countryFilter,
        timeControl,
      };

      // Limpiar timers viejos por si reintentaba
      clearMatchTimers(user.id);

      const opponent = matchmaking.findMatch(me, isSocketAlive);
      if (opponent) {
        const gameId = await completeMatch(me, opponent);
        return ack?.({ ok: true, status: 'matched', gameId });
      }

      // Quedó en cola: programar fallbacks
      const timers = { promote: null, hard: null };

      // 1) A los 8s: si todavía sigue en CO, promueve a GLOBAL e intenta otra vez
      timers.promote = setTimeout(async () => {
        try {
          if (countryFilter !== 'CO') return; // sólo aplica a CO -> GLOBAL
          if (!isSocketAlive(socket.id)) {
            matchmaking.removeFromQueues(user.id);
            clearMatchTimers(user.id);
            return;
          }
          const promoted = matchmaking.promoteToGlobal(user.id, timeControl);
          if (!promoted) return; // ya consiguió match o se canceló

          // Intentar emparejar de nuevo en GLOBAL
          const opp = matchmaking.findMatch(
            { ...me, countryFilter: 'GLOBAL' },
            isSocketAlive
          );
          if (opp) {
            await completeMatch({ ...me, countryFilter: 'GLOBAL' }, opp);
          } else {
            // Ya está en GLOBAL, avísale al cliente para que actualice UI
            socket.emit('match:expanded', { from: 'CO', to: 'GLOBAL' });
          }
        } catch (e) {
          console.error('[match:find/promote]', e);
        }
      }, MATCH_PROMOTE_MS);

      // 2) A los 25s totales: rendirse, sacar de cola y avisar al cliente
      timers.hard = setTimeout(() => {
        if (matchmaking.isQueued(user.id)) {
          matchmaking.removeFromQueues(user.id);
          if (isSocketAlive(socket.id)) {
            socket.emit('match:timeout', {
              message: 'No encontramos rival. Intenta de nuevo.',
            });
          }
          console.log(`[MATCHMAKING] Hard timeout para ${user.username}`);
        }
        clearMatchTimers(user.id);
      }, MATCH_HARD_TIMEOUT_MS);

      matchTimers.set(user.id, timers);

      return ack?.({ ok: true, status: 'queued' });
    } catch (err) {
      console.error('[match:find]', err);
      ack?.({ ok: false, error: err?.message || 'Error en matchmaking' });
    }
  });

  // ----- CANCELAR BUSQUEDA -----
  socket.on('match:cancel', (_, ack) => {
    clearMatchTimers(user.id);
    matchmaking.removeFromQueues(user.id);
    ack?.({ ok: true });
  });

  // ----- PEDIR ESTADO ACTUAL DE LA PARTIDA -----
  //
  // El cliente lo emite al montar /game/[id]. Soluciona el race donde
  // `match:found` se emite ANTES de que el componente de la partida se
  // monte (la SPA navega tras recibir match:found en el lobby, pero
  // useGame todavía no tiene listeners registrados cuando ese evento
  // pasó). Aquí simplemente reenviamos el snapshot actual.
  //
  // También sirve para deep-links / refresh: el frontend llama esto en
  // mount sin depender de la lógica de reconexión del socket.
  //
  // Importante: fuente de verdad para el gameId es el ARGUMENTO del
  // cliente (lo lee de la URL), con fallback a userToGame. Antes
  // dependíamos sólo de userToGame y eso falla si hay cualquier
  // desincronización.
  socket.on('game:request_state', async ({ gameId: requestedId } = {}, ack) => {
    const mappedId = userToGame.get(user.id);
    const gameId = requestedId || mappedId;

    console.log(
      `[GAME:STATE] request de ${user.username} ` +
        `(requested=${requestedId || '-'}, mapped=${mappedId || '-'}, resolved=${gameId || '-'})`
    );

    if (!gameId) {
      socket.emit('game:not_found', { gameId: null });
      return ack?.({ ok: false, error: 'Sin partida activa' });
    }

    // 1) Partida activa en memoria
    const state = activeGames.get(gameId);
    if (state) {
      const color = colorOf(state, user.id);
      if (!color) {
        console.log(`[GAME:STATE] ${user.username} NO participa en ${gameId}`);
        socket.emit('game:not_found', { gameId });
        return ack?.({ ok: false, error: 'No participas en esta partida' });
      }

      // Refrescar socketId y connected (idempotente)
      if (color === 'w') {
        state.white.socketId = socket.id;
        state.white.connected = true;
      } else {
        state.black.socketId = socket.id;
        state.black.connected = true;
      }
      // Auto-reparar userToGame si quedó desincronizado
      userToGame.set(user.id, gameId);

      if (state.abandonTimer) {
        clearTimeout(state.abandonTimer);
        state.abandonTimer = null;
      }

      socket.join(`game:${gameId}`);
      socket.emit('game:state', { gameId, color, ...publicState(state) });
      console.log(
        `[GAME:STATE] snapshot enviado a ${user.username} (gameId=${gameId}, color=${color})`
      );

      // Si es partida vs bot y le toca al bot, dispararlo
      if (state.isBotGame) {
        triggerBotMoveIfNeeded(io, gameId).catch((err) =>
          console.error('[bot] trigger tras register falló:', err.message)
        );
      }
      return ack?.({ ok: true, status: 'active', gameId });
    }

    // 2) No está en memoria -> puede que ya haya terminado. Revisamos DB.
    try {
      const dbGame = await gameService.getGame(gameId);
      if (dbGame && (dbGame.white_id === user.id || dbGame.black_id === user.id)) {
        if (dbGame.status === 'finished') {
          socket.emit('game:end', {
            gameId,
            result: dbGame.result,
            termination: dbGame.termination,
            fen: dbGame.fen,
            pgn: dbGame.pgn,
          });
          console.log(
            `[GAME:STATE] partida ${gameId} ya terminó, enviado game:end a ${user.username}`
          );
          return ack?.({ ok: true, status: 'finished', gameId });
        }
      }
    } catch (err) {
      console.error('[GAME:STATE] error consultando DB:', err.message || err);
    }

    socket.emit('game:not_found', { gameId });
    return ack?.({ ok: false, error: 'Partida no encontrada' });
  });

  // ----- MOVIMIENTO -----
  socket.on('game:move', async (raw, ack) => {
    try {
      const { gameId, from, to, promotion } = moveSchema.parse(raw);
      const state = activeGames.get(gameId);
      if (!state) return ack?.({ ok: false, error: 'Partida no encontrada' });

      const color = colorOf(state, user.id);
      if (!color) return ack?.({ ok: false, error: 'No participas en esta partida' });

      // Verificar turno (chess.js usa 'w' o 'b')
      if (state.chess.turn() !== color) {
        return ack?.({ ok: false, error: 'No es tu turno' });
      }

      // ----- FLAG check ANTES de aplicar el movimiento -----
      // Si el jugador ya gastó su reloj, no aceptamos la jugada y declaramos timeout.
      const moveStartTs = Date.now();
      if (state.lastMoveAt) {
        const elapsedBeforeMove = moveStartTs - state.lastMoveAt;
        const moverMs = color === 'w' ? state.whiteMs : state.blackMs;
        if (elapsedBeforeMove > moverMs) {
          if (state.flagTimer) { clearTimeout(state.flagTimer); state.flagTimer = null; }
          if (color === 'w') state.whiteMs = 0;
          else state.blackMs = 0;
          await endGame(io, gameId, {
            winner: color === 'w' ? 'b' : 'w',
            termination: 'timeout',
          });
          return ack?.({ ok: false, error: 'Tiempo agotado' });
        }
      }

      // Validar y aplicar el movimiento (FUENTE DE VERDAD)
      let move;
      try {
        move = state.chess.move({ from, to, promotion: promotion || 'q' });
      } catch (e) {
        return ack?.({ ok: false, error: 'Movimiento ilegal' });
      }
      if (!move) return ack?.({ ok: false, error: 'Movimiento ilegal' });

      // ----- Actualizar reloj y reprogramar flag-timer del rival -----
      {
        const elapsed = moveStartTs - state.lastMoveAt;
        if (color === 'w') state.whiteMs = Math.max(0, state.whiteMs - elapsed);
        else state.blackMs = Math.max(0, state.blackMs - elapsed);
        state.lastMoveAt = moveStartTs;
        scheduleFlagTimer(io, gameId);
      }

      const fen = state.chess.fen();
      const pgn = state.chess.pgn();
      const moveRecord = {
        san: move.san,
        from: move.from,
        to: move.to,
        promotion: move.promotion || null,
        fen,
        ts: moveStartTs,
      };

      // Persistir (no esperamos a que termine para no bloquear; pero capturamos errores)
      gameService.appendMove(gameId, moveRecord, fen, pgn).catch((err) =>
        console.error('[game:move] persist error:', err)
      );

      io.to(`game:${gameId}`).emit('game:move', {
        gameId,
        move: moveRecord,
        fen,
        pgn,
        turn: state.chess.turn(),
        whiteMs: state.whiteMs,
        blackMs: state.blackMs,
      });
      ack?.({ ok: true });

      // ¿Terminó?
      if (state.chess.isGameOver()) {
        let termination = 'unknown';
        let winner = null;
        if (state.chess.isCheckmate()) {
          termination = 'checkmate';
          winner = move.color; // el que acaba de mover gana
        } else if (state.chess.isStalemate()) {
          termination = 'stalemate';
        } else if (state.chess.isThreefoldRepetition()) {
          termination = 'threefold';
        } else if (state.chess.isInsufficientMaterial()) {
          termination = 'insufficient_material';
        } else if (state.chess.isDraw()) {
          termination = 'draw';
        }
        await endGame(io, gameId, { winner, termination });
      }

      // Si es partida vs bot y la partida sigue, le toca al bot
      if (state.isBotGame && !state.chess.isGameOver()) {
        triggerBotMoveIfNeeded(io, gameId).catch((err) =>
          console.error('[bot] trigger tras move humano falló:', err.message)
        );
      }
    } catch (err) {
      console.error('[game:move]', err);
      ack?.({ ok: false, error: err?.message || 'Error procesando movimiento' });
    }
  });

  // ----- RENDIRSE -----
  socket.on('game:resign', async ({ gameId } = {}, ack) => {
    const state = activeGames.get(gameId);
    if (!state) return ack?.({ ok: false, error: 'Partida no encontrada' });
    const color = colorOf(state, user.id);
    if (!color) return ack?.({ ok: false, error: 'No participas en esta partida' });

    const winner = color === 'w' ? 'b' : 'w';
    await endGame(io, gameId, { winner, termination: 'resignation' });
    ack?.({ ok: true });
  });

  // ----- DESCONEXION -----
  socket.on('disconnect', () => {
    // Sacar de cola y limpiar timers de matchmaking
    clearMatchTimers(user.id);
    matchmaking.removeFromQueues(user.id);
    console.log(`[MATCHMAKING] Socket desconectado: ${user.username} (${user.id})`);

    const gameId = userToGame.get(user.id);
    if (!gameId) return;
    const state = activeGames.get(gameId);
    if (!state) return;

    const color = colorOf(state, user.id);
    if (color === 'w') state.white.connected = false;
    if (color === 'b') state.black.connected = false;

    socket.to(`game:${gameId}`).emit('opponent:disconnected', { username: user.username });

    // Damos 30s para reconectar; si no, abandono
    if (state.abandonTimer) clearTimeout(state.abandonTimer);
    state.abandonTimer = setTimeout(async () => {
      const winner = color === 'w' ? 'b' : 'w';
      await endGame(io, gameId, { winner, termination: 'abandonment' });
    }, RECONNECT_GRACE_MS);
  });
}

/* ============================================================
 * BOTS — partidas humano vs bot
 * ============================================================
 * Reusa toda la infra existente (activeGames, endGame, broadcast,
 * reloj, flag, finishGame, encolado de análisis). La única diferencia:
 * cuando le toca al bot, el SERVIDOR genera la jugada llamando al worker.
 */

async function startBotGame({ user, botId, userIsWhite, timeControl }) {
  const bot = getBot(botId);
  if (!bot) throw new Error(`Bot desconocido: ${botId}`);

  const human = {
    userId: user.id,
    username: user.username,
    socketId: null,            // se llena cuando el cliente conecta a la room
    isBot: false,
  };
  const botPlayer = {
    userId: BOT_ID_PREFIX + bot.id,
    username: bot.name,
    socketId: null,
    isBot: true,
    botConfig: bot,
  };

  const white = userIsWhite ? human : botPlayer;
  const black = userIsWhite ? botPlayer : human;

  // Persistimos como cualquier partida; el bot tiene un userId virtual
  // que NO existe en la tabla users → guardamos NULL en su columna.
  const dbGame = await gameService.createGame({
    whiteId:       white.isBot ? null : white.userId,
    blackId:       black.isBot ? null : black.userId,
    whiteUsername: white.username,
    blackUsername: black.username,
    timeControl,
    countryFilter: 'GLOBAL',
  });

  const state = {
    chess: new Chess(),
    white: { ...white, connected: true },
    black: { ...black, connected: true },
    countryFilter: 'GLOBAL',
    timeControl,
    abandonTimer: null,
    whiteMs: parseTimeControlToMs(timeControl),
    blackMs: parseTimeControlToMs(timeControl),
    lastMoveAt: Date.now(),
    flagTimer: null,
    isBotGame: true,
  };

  activeGames.set(dbGame.id, state);
  userToGame.set(user.id, dbGame.id);
  return { gameId: dbGame.id };
}

/**
 * Si en `gameId` es turno del bot, le pedimos jugada al worker y la
 * aplicamos como cualquier otro move (mismo flujo de endGame, etc.).
 * Llamado tras crear la partida (si bot juega blancas) y tras cada
 * move humano.
 */
async function triggerBotMoveIfNeeded(io, gameId) {
  const state = activeGames.get(gameId);
  if (!state || !state.isBotGame) return;
  if (state.chess.isGameOver()) return;
  const turn = state.chess.turn(); // 'w' | 'b'
  const side = state[turn === 'w' ? 'white' : 'black'];
  if (!side.isBot) return;

  const bot = side.botConfig;
  const fen = state.chess.fen();

  // Pausa "humana" antes de mover (estética + cold start margin)
  await new Promise((r) => setTimeout(r, bot.delayMs));

  let uci;
  try {
    uci = await botBestMove({
      fen,
      skill: bot.skill,
      depth: bot.depth,
      moveTimeMs: bot.moveTimeMs,
    });
  } catch (err) {
    console.error(`[bot ${bot.id}] no pudo mover:`, err.message);
    // Si el bot no puede jugar, resignamos por timeout para no congelar
    await endGame(io, gameId, {
      winner: turn === 'w' ? 'b' : 'w',
      termination: 'bot_unavailable',
    });
    return;
  }

  // Releer estado (puede haber cambiado durante el await)
  const fresh = activeGames.get(gameId);
  if (!fresh || fresh.chess.isGameOver()) return;
  if (fresh.chess.turn() !== turn) return; // ya jugó otro? abort

  const from = uci.substring(0, 2);
  const to   = uci.substring(2, 4);
  const promotion = uci.length > 4 ? uci.substring(4, 5) : undefined;

  let move;
  try {
    move = fresh.chess.move({ from, to, promotion });
  } catch {
    move = null;
  }
  if (!move) {
    console.error(`[bot ${bot.id}] devolvió uci ilegal: ${uci} en ${fen}`);
    await endGame(io, gameId, {
      winner: turn === 'w' ? 'b' : 'w',
      termination: 'bot_unavailable',
    });
    return;
  }

  // Tic del reloj (mismo cálculo que en game:move)
  const now = Date.now();
  const elapsed = now - fresh.lastMoveAt;
  if (turn === 'w') fresh.whiteMs = Math.max(0, fresh.whiteMs - elapsed);
  else              fresh.blackMs = Math.max(0, fresh.blackMs - elapsed);
  fresh.lastMoveAt = now;

  const fenAfter = fresh.chess.fen();
  const pgnAfter = fresh.chess.pgn();

  io.to(`game:${gameId}`).emit('game:move', {
    gameId,
    move: { from, to, promotion: promotion || null, san: move.san, color: turn },
    fen: fenAfter,
    pgn: pgnAfter,
    turn: fresh.chess.turn(),
    whiteMs: fresh.whiteMs,
    blackMs: fresh.blackMs,
  });

  // Persistencia best-effort (igual que en move humano)
  gameService.appendMove(gameId, {
    from, to, promotion: promotion || null, san: move.san, color: turn, ts: now,
  }, fenAfter, pgnAfter).catch((err) =>
    console.warn('[bot] appendMove falló:', err.message)
  );

  // Si la jugada terminó la partida → endGame
  if (fresh.chess.isGameOver()) {
    let winner = 'draw';
    let termination = 'agreement';
    if (fresh.chess.isCheckmate()) {
      winner = turn; termination = 'checkmate';
    } else if (fresh.chess.isStalemate()) {
      termination = 'stalemate';
    } else if (fresh.chess.isThreefoldRepetition()) {
      termination = 'threefold';
    } else if (fresh.chess.isInsufficientMaterial()) {
      termination = 'insufficient_material';
    } else if (fresh.chess.isDraw()) {
      termination = 'draw';
    }
    await endGame(io, gameId, { winner, termination });
    return;
  }

  // Re-armar timer de flag con los ms actualizados
  scheduleFlagTimer(io, gameId);

  // Si el siguiente sigue siendo bot (raro, pero pase) → cadena
  triggerBotMoveIfNeeded(io, gameId).catch((err) =>
    console.error('[bot] triggerBotMoveIfNeeded encadenado:', err.message)
  );
}

module.exports = { register, startBotGame, triggerBotMoveIfNeeded };
