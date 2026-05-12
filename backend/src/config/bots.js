/**
 * Catálogo central de bots con identidad colombiana sutil.
 *
 * Cada bot mapea a (skill, depth, moveTime) de Stockfish:
 *   - skill: 0..20  (Skill Level UCI)
 *   - depth: profundidad máx. de búsqueda
 *   - moveTimeMs: si > 0, override de depth por tiempo
 *
 * `delayMs`: pausa artificial antes de mover, para sentir humano.
 * `eloApprox`: Elo nominal mostrado al usuario.
 *
 * Para agregar un bot nuevo: copiar una entrada, cambiar id/nombre.
 * Nada más necesita cambiar.
 */

const BOTS = [
  {
    id: 'aguila-roja',
    name: 'Águila Roja',
    eloApprox: 800,
    skill: 2,
    depth: 3,
    moveTimeMs: 0,
    delayMs: 900,
    avatar: '☕',
    description: 'Café cargado, jugadas rápidas, errores tácticos.',
    personality: 'impulsive',
  },
  {
    id: 'tinto',
    name: 'Tinto',
    eloApprox: 1100,
    skill: 5,
    depth: 5,
    moveTimeMs: 0,
    delayMs: 1100,
    avatar: '🫘',
    description: 'Directo, sin paciencia. Se acelera al final.',
    personality: 'aggressive',
  },
  {
    id: 'tejo',
    name: 'Tejo',
    eloApprox: 1400,
    skill: 8,
    depth: 7,
    moveTimeMs: 0,
    delayMs: 1300,
    avatar: '🎯',
    description: 'Disfruta los sacrificios. A veces le sale.',
    personality: 'tactical',
  },
  {
    id: 'cumbia',
    name: 'Cumbia',
    eloApprox: 1700,
    skill: 11,
    depth: 9,
    moveTimeMs: 0,
    delayMs: 1500,
    avatar: '🪘',
    description: 'Ritmo y posición. Te lleva al baile sin que te des cuenta.',
    personality: 'positional',
  },
  {
    id: 'paramo',
    name: 'Páramo',
    eloApprox: 2000,
    skill: 15,
    depth: 12,
    moveTimeMs: 0,
    delayMs: 1700,
    avatar: '🏔️',
    description: 'Sólido, paciente, defensivo. Te ahoga sin ruido.',
    personality: 'defensive',
  },
  {
    id: 'el-dorado',
    name: 'El Dorado',
    eloApprox: 2300,
    skill: 18,
    depth: 15,
    moveTimeMs: 0,
    delayMs: 1800,
    avatar: '✨',
    description: 'Estratega profundo. No regala material.',
    personality: 'strategic',
  },
];

function getBot(id) {
  return BOTS.find((b) => b.id === id) || null;
}

function publicBot(b) {
  // Lo que se manda al cliente (sin parámetros técnicos del motor)
  return {
    id: b.id,
    name: b.name,
    eloApprox: b.eloApprox,
    avatar: b.avatar,
    description: b.description,
    personality: b.personality,
  };
}

module.exports = { BOTS, getBot, publicBot };
