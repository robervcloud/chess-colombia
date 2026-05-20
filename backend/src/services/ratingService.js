/**
 * Glicko-2 (Glickman 2012) — implementación correcta y autocontenida.
 *
 * Aplicado por partida (rating period = 1 game, estilo Lichess). Más
 * volátil que períodos largos pero más reactivo, que es lo que el usuario
 * espera en chess online.
 *
 * Constantes:
 *   - TAU: limita el cambio de volatilidad; 0.3-1.2 razonable. Usamos 0.5.
 *   - SCALE: 173.7178 para convertir entre escala Glicko (1500/350) y
 *     escala Glicko-2 (0/equivalente).
 */

const SCALE = 173.7178;
const TAU   = 0.5;
const EPS   = 1e-6;

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}
function E(mu, muj, phij) {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

/**
 * Actualiza rating de UN jugador contra UNO solo (un partido).
 * Entrada y salida en escala Glicko (1500/350).
 *
 * @param self  { rating, rd, vol }
 * @param opp   { rating, rd }
 * @param score 1 win, 0.5 draw, 0 loss
 * @returns { rating, rd, vol }
 */
function updateOne(self, opp, score) {
  const mu  = (self.rating - 1500) / SCALE;
  const phi = self.rd / SCALE;
  const muj = (opp.rating - 1500) / SCALE;
  const phij = opp.rd / SCALE;

  const gj = g(phij);
  const Ej = E(mu, muj, phij);

  const v = 1 / (gj * gj * Ej * (1 - Ej));
  const delta = v * gj * (score - Ej);

  // Algoritmo Illinois para encontrar la nueva volatilidad
  const a = Math.log(self.vol * self.vol);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A), fB = f(B);
  let safety = 100;
  while (Math.abs(B - A) > EPS && safety-- > 0) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B; fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C; fB = fC;
  }

  const newVol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi  = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu   = mu + newPhi * newPhi * gj * (score - Ej);

  return {
    rating: clamp(Math.round(1500 + newMu * SCALE), 100, 3500),
    rd:     clamp(Math.round(newPhi * SCALE), 30, 350),
    vol:    Math.max(0.01, Math.min(0.2, newVol)),
  };
}

/** Aplica un partido a ambos lados. whiteScore: 1 win, 0.5 draw, 0 loss. */
function computeGame(white, black, whiteScore) {
  const newW = updateOne(white, black, whiteScore);
  const newB = updateOne(black, white, 1 - whiteScore);
  return { white: newW, black: newB };
}

/**
 * Modo según time control "base+inc" (min+sec). Lichess-style:
 *   estimated = base*60 + 40*inc
 *     < 180   → bullet
 *     < 480   → blitz
 *     < 1500  → rapid
 *     >=1500  → classical
 */
function modeFromTimeControl(tc) {
  if (!tc || typeof tc !== 'string') return 'blitz';
  const m = tc.match(/^(\d+)\+(\d+)$/);
  if (!m) return 'blitz';
  const base = parseInt(m[1], 10);
  const inc  = parseInt(m[2], 10);
  const est  = base * 60 + 40 * inc;
  if (est < 180)   return 'bullet';
  if (est < 480)   return 'blitz';
  if (est < 1500)  return 'rapid';
  return 'classical';
}

/** Convierte result '1-0' / '0-1' / '1/2-1/2' a score para blancas. */
function whiteScoreFromResult(result) {
  if (result === '1-0')     return 1;
  if (result === '0-1')     return 0;
  if (result === '1/2-1/2') return 0.5;
  return 0.5;
}

/** Provisional si rd > 110 (heurística estándar). */
function isProvisional(rd) {
  return rd > 110;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

module.exports = {
  updateOne,
  computeGame,
  modeFromTimeControl,
  whiteScoreFromResult,
  isProvisional,
};
