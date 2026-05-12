/**
 * Catálogo central de bots con identidad colombiana sutil.
 *
 * Stockfish UCI mapping:
 *   - skill (0..20)
 *   - depth (profundidad máx.)
 *   - moveTimeMs (si > 0, override de depth por tiempo)
 *
 * Para el frontend (publicBot):
 *   - playStyle: etiqueta corta visible
 *   - gradient: [from, to] hex, alimenta el avatar/card visual
 *
 * Para añadir un bot: copiar un objeto y cambiar id/name. Listo.
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
    avatar: '🦅',
    description: 'Comete errores frecuentes, pero castiga piezas colgadas.',
    playStyle: 'Impulsiva',
    personality: 'impulsive',
    gradient: ['#c08a5c', '#8a5a32'],
  },
  {
    id: 'tinto-maestro',
    name: 'Tinto Maestro',
    eloApprox: 1100,
    skill: 5,
    depth: 5,
    moveTimeMs: 0,
    delayMs: 1100,
    avatar: '☕',
    description: 'Caliente y directo. Se acelera al final, regala material.',
    playStyle: 'Agresivo',
    personality: 'aggressive',
    gradient: ['#7a3b2a', '#4a221a'],
  },
  {
    id: 'paisa-gambit',
    name: 'Paisa Gambit',
    eloApprox: 1400,
    skill: 8,
    depth: 7,
    moveTimeMs: 0,
    delayMs: 1300,
    avatar: '🎯',
    description: 'Le gusta el sacrificio. A veces le sale jugada de revista.',
    playStyle: 'Táctico',
    personality: 'tactical',
    gradient: ['#d4a23a', '#9a6b1f'],
  },
  {
    id: 'rey-cafetero',
    name: 'Rey Cafetero',
    eloApprox: 1700,
    skill: 11,
    depth: 9,
    moveTimeMs: 0,
    delayMs: 1500,
    avatar: '👑',
    description: 'Cosecha lenta y pareja. Te lleva al endgame y aprieta.',
    playStyle: 'Posicional',
    personality: 'positional',
    gradient: ['#9b6a2a', '#5a3d18'],
  },
  {
    id: 'condor-paramo',
    name: 'Cóndor del Páramo',
    eloApprox: 2000,
    skill: 15,
    depth: 12,
    moveTimeMs: 0,
    delayMs: 1700,
    avatar: '🏔️',
    description: 'Sólido y paciente. Te ahoga jugada a jugada sin hacer ruido.',
    playStyle: 'Defensivo',
    personality: 'defensive',
    gradient: ['#4a5563', '#1f2530'],
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
    description: 'Estratega profundo. Calcula líneas largas, no regala nada.',
    playStyle: 'Estratégico',
    personality: 'strategic',
    gradient: ['#e8c873', '#8a6a1f'],
  },
];

function getBot(id) {
  return BOTS.find((b) => b.id === id) || null;
}

function publicBot(b) {
  return {
    id: b.id,
    name: b.name,
    eloApprox: b.eloApprox,
    avatar: b.avatar,
    description: b.description,
    playStyle: b.playStyle,
    personality: b.personality,
    gradient: b.gradient,
  };
}

module.exports = { BOTS, getBot, publicBot };
