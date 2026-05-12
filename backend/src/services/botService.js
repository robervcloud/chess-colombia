/**
 * Cliente HTTP al worker para obtener jugadas de bots.
 *
 * Reutiliza el HTTP server del worker (puerto público en Render Free).
 * Si WORKER_URL no está configurado, lanzamos error claro: los bots
 * no funcionan sin el worker.
 *
 * Maneja cold-start del worker (Render Free hiberna): el primer fetch
 * puede tardar 30s. Por eso el timeout es generoso.
 */

const WORKER_URL = process.env.WORKER_URL || '';
const BOT_AUTH_TOKEN = process.env.BOT_AUTH_TOKEN || '';

async function botBestMove({ fen, skill, depth, moveTimeMs = 0 }) {
  if (!WORKER_URL) {
    throw new Error('WORKER_URL no configurado: bots no disponibles');
  }
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 45000); // cold start + búsqueda
  try {
    const res = await fetch(`${WORKER_URL.replace(/\/$/, '')}/bot-move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOT_AUTH_TOKEN ? { 'x-bot-token': BOT_AUTH_TOKEN } : {}),
      },
      body: JSON.stringify({ fen, skill, depth, moveTimeMs }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`worker ${res.status}: ${text || res.statusText}`);
    }
    const data = await res.json();
    if (!data.uci) throw new Error('worker no devolvió uci');
    return data.uci;
  } finally {
    clearTimeout(tid);
  }
}

module.exports = { botBestMove };
