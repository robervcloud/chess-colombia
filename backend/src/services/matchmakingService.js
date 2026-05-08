/**
 * Matchmaking simple en memoria.
 *
 * Para MVP usamos un objeto en RAM. Cuando el sistema crezca,
 * reemplazar por Redis sin cambiar la API pública (`findMatch`,
 * `removeFromQueues`, `stats`).
 *
 * Mantenemos colas separadas por (timeControl + countryFilter):
 *   queues[timeControl][CO|GLOBAL] = [player, player, ...]
 *
 *   - countryFilter='CO'     -> SÓLO busca en pool CO (Colombia estricto).
 *   - countryFilter='GLOBAL' -> busca primero en GLOBAL, luego en CO.
 *
 * Mejoras vs versión anterior:
 *   1. pruneQueues(): elimina jugadores fantasma antes de cada match.
 *   2. Validación reforzada del oponente (socketId vivo, no es uno mismo).
 *   3. Anti-duplicados: el mismo userId no puede estar en dos colas.
 *   4. Logs con prefijo [MATCHMAKING] para debugging sin tooling externo.
 *   5. Whitelist de controles de tiempo (1+0, 3+0, 5+0, 10+0).
 *   6. promoteToGlobal(): mover de CO a GLOBAL tras un timeout.
 */

// Whitelist de controles de tiempo soportados
const ALLOWED_TIME_CONTROLS = ['1+0', '3+0', '5+0', '10+0'];

// queues: Map<timeControl, { CO: Player[], GLOBAL: Player[] }>
const queues = new Map();

const GROUPS = ['CO', 'GLOBAL'];

function getOrCreateBucket(timeControl, group) {
  if (!queues.has(timeControl)) queues.set(timeControl, { CO: [], GLOBAL: [] });
  return queues.get(timeControl)[group];
}

/**
 * Devuelve true si el "Player" guardado en cola es válido.
 * Si recibimos `isSocketAlive`, validamos también que el socket exista en io.
 */
function isValidPlayer(p, isSocketAlive) {
  if (!p) return false;
  if (!p.userId || !p.username) return false;
  if (!p.socketId) return false;
  if (typeof isSocketAlive === 'function' && !isSocketAlive(p.socketId)) return false;
  return true;
}

/**
 * Limpia TODAS las colas eliminando jugadores fantasma.
 * Se ejecuta antes de cada findMatch.
 *
 * @param {(socketId:string)=>boolean} [isSocketAlive] - opcional, si no se
 *        pasa sólo se hace cleanup de entradas obviamente inválidas
 *        (sin socketId, sin userId, etc.)
 */
function pruneQueues(isSocketAlive) {
  let removedTotal = 0;
  for (const [tc, groups] of queues.entries()) {
    for (const group of GROUPS) {
      const before = groups[group].length;
      groups[group] = groups[group].filter((p) => {
        const ok = isValidPlayer(p, isSocketAlive);
        if (!ok) {
          console.log(
            `[MATCHMAKING] Eliminando fantasma de ${tc}/${group}:`,
            p?.username || '(desconocido)',
            p?.userId || ''
          );
        }
        return ok;
      });
      removedTotal += before - groups[group].length;
    }
  }
  if (removedTotal > 0) {
    console.log(`[MATCHMAKING] pruneQueues: ${removedTotal} fantasmas eliminados`);
  }
  return removedTotal;
}

/**
 * Saca a un usuario de TODAS las colas. Se llama:
 *   - al desconectarse el socket
 *   - al cancelar búsqueda
 *   - antes de meterlo en una cola nueva (anti-duplicados)
 *
 * Devuelve cuántas entradas eliminó (debería ser 0 o 1 en operación normal).
 */
function removeFromQueues(userId) {
  if (!userId) return 0;
  let removed = 0;
  for (const tc of queues.values()) {
    for (const group of GROUPS) {
      // Loop por si quedó duplicado
      for (let i = tc[group].length - 1; i >= 0; i--) {
        if (tc[group][i].userId === userId) {
          tc[group].splice(i, 1);
          removed++;
        }
      }
    }
  }
  if (removed > 0) {
    console.log(`[MATCHMAKING] removeFromQueues: ${userId} eliminado de ${removed} cola(s)`);
  }
  return removed;
}

/**
 * Intenta encontrar un rival. Si no hay, mete al jugador en cola.
 *
 * @param {{userId:string, username:string, country:string, socketId:string, countryFilter:'CO'|'GLOBAL', timeControl:string}} player
 * @param {(socketId:string)=>boolean} [isSocketAlive] callback para verificar socket vivo
 * @returns {Player|null} oponente si lo encontró, null si quedó en cola
 */
function findMatch(player, isSocketAlive) {
  // ---- Validaciones de entrada ----
  if (!player || !player.userId || !player.username || !player.socketId) {
    throw new Error('Player inválido en findMatch');
  }
  if (!ALLOWED_TIME_CONTROLS.includes(player.timeControl)) {
    throw new Error(
      `Control de tiempo no permitido: ${player.timeControl}. Permitidos: ${ALLOWED_TIME_CONTROLS.join(', ')}`
    );
  }
  if (player.countryFilter !== 'CO' && player.countryFilter !== 'GLOBAL') {
    throw new Error(`countryFilter inválido: ${player.countryFilter}`);
  }

  // ---- 1) Limpiar fantasmas ANTES de buscar (Problema A) ----
  pruneQueues(isSocketAlive);

  // ---- 2) Anti-duplicados: si el usuario ya estaba en cola, sacarlo ----
  removeFromQueues(player.userId);

  const { countryFilter, timeControl, username } = player;

  // CO sólo busca en CO. GLOBAL busca primero en GLOBAL (homogéneo) y luego en CO.
  const targetPools = countryFilter === 'CO' ? ['CO'] : ['GLOBAL', 'CO'];

  // ---- 3) Validación reforzada al elegir oponente (Problema B) ----
  for (const poolName of targetPools) {
    const pool = getOrCreateBucket(timeControl, poolName);

    const idx = pool.findIndex(
      (p) => isValidPlayer(p, isSocketAlive) && p.userId !== player.userId
    );

    if (idx >= 0) {
      const opponent = pool.splice(idx, 1)[0];
      console.log(
        `[MATCHMAKING] Match encontrado: ${username} vs ${opponent.username} ` +
          `(timeControl=${timeControl}, pool=${poolName})`
      );
      console.log('[MATCHMAKING] Estado de colas:', stats());
      return opponent;
    }
  }

  // ---- 4) No hay rival -> entra a cola ----
  getOrCreateBucket(timeControl, countryFilter).push(player);
  console.log(
    `[MATCHMAKING] En cola: ${username} ` +
      `(countryFilter=${countryFilter}, timeControl=${timeControl})`
  );
  console.log('[MATCHMAKING] Estado de colas:', stats());
  return null;
}

/**
 * Promueve a un jugador de la cola CO a GLOBAL para ampliar el pool
 * tras un timeout. Devuelve el player actualizado si fue promovido,
 * o null si ya no estaba en CO (porque ya consiguió match o canceló).
 */
function promoteToGlobal(userId, timeControl) {
  const groups = queues.get(timeControl);
  if (!groups) return null;

  const idx = groups.CO.findIndex((p) => p.userId === userId);
  if (idx < 0) return null;

  const player = groups.CO.splice(idx, 1)[0];
  player.countryFilter = 'GLOBAL';
  groups.GLOBAL.push(player);

  console.log(
    `[MATCHMAKING] Promovido CO->GLOBAL por timeout: ${player.username} (${timeControl})`
  );
  console.log('[MATCHMAKING] Estado de colas:', stats());
  return player;
}

/**
 * Devuelve true si el usuario está actualmente en alguna cola.
 */
function isQueued(userId) {
  for (const groups of queues.values()) {
    for (const group of GROUPS) {
      if (groups[group].some((p) => p.userId === userId)) return true;
    }
  }
  return false;
}

/**
 * Snapshot del estado de las colas. Útil para logs y debugging.
 */
function stats() {
  const out = {};
  for (const [tc, groups] of queues.entries()) {
    out[tc] = { CO: groups.CO.length, GLOBAL: groups.GLOBAL.length };
  }
  return out;
}

module.exports = {
  findMatch,
  removeFromQueues,
  pruneQueues,
  promoteToGlobal,
  isQueued,
  stats,
  ALLOWED_TIME_CONTROLS,
};
