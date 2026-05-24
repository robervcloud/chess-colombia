/**
 * Lecciones para aprender ajedrez desde cero.
 *
 * Cada lección tiene una posición inicial (FEN) curada para enseñar UN
 * concepto, y un `validate(history)` que devuelve true cuando el usuario
 * cumple el objetivo. Sin backend: el progreso se guarda en localStorage.
 *
 * Decisiones:
 *   - El usuario SIEMPRE juega blancas (para no confundir a principiantes).
 *   - Las posiciones se diseñaron para que sólo haya una jugada "correcta"
 *     que entrena la idea (no son partidas reales, son ejercicios).
 *   - El "rival" no responde: la lección termina al cumplir el goal.
 *
 * Diseño narrativo: tono cálido, breve, en español neutro colombiano.
 */

export interface Lesson {
  id: string;
  title: string;
  /** Una línea para la card lista de lecciones */
  tagline: string;
  /** Párrafo introductorio antes de empezar */
  intro: string;
  /** Pista opcional si el usuario se queda */
  hint: string;
  /** FEN de partida del ejercicio */
  startFen: string;
  /** Texto del objetivo concreto */
  goal: string;
  /** Símbolo decorativo (texto, no emoji) */
  glyph: '♙' | '♘' | '♗' | '♖' | '♕' | '♔' | '✦';
  /** Dificultad 1-3 — afecta orden y color */
  difficulty: 1 | 2 | 3;
  /**
   * Validador: recibe la historia SAN y la posición final, devuelve
   * `true` si el objetivo se cumplió.
   * Si devuelve `false`, el usuario puede seguir intentando.
   */
  validate: (sanHistory: string[], finalFen: string) => boolean;
}

const isCheckmate = (fen: string): boolean => {
  // Truco simple: chess.js setea '#' al final del SAN. Validamos en validate
  // usando el último SAN. Esta función queda como helper si se necesita.
  return fen.includes('# ') || fen.endsWith('#');
};

export const LESSONS: Lesson[] = [
  {
    id: 'pawn-advance',
    title: 'El peón da el primer paso',
    tagline: 'Mueve un peón hacia el centro del tablero',
    intro:
      'El peón es la pieza más humilde pero también la más numerosa. Avanza una casilla recto, o dos en su primera jugada. Captura en diagonal. Mueve el peón de e2 a e4: la jugada más popular del mundo.',
    hint: 'Arrastra el peón blanco que está en e2 hacia la casilla e4.',
    goal: 'Mueve un peón a e4',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    glyph: '♙',
    difficulty: 1,
    validate: (san) => san[0] === 'e4',
  },
  {
    id: 'knight-jump',
    title: 'El caballo salta en L',
    tagline: 'Aprende el movimiento único del caballo',
    intro:
      'El caballo es la única pieza que salta sobre otras. Se mueve en forma de L: dos casillas en una dirección y una perpendicular. Mueve el caballo de g1 hacia f3, una de las mejores casillas iniciales.',
    hint: 'El caballo en g1 puede ir a f3 o h3. Elige f3 — apunta al centro.',
    goal: 'Lleva un caballo a f3',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    glyph: '♘',
    difficulty: 1,
    validate: (san) => san[0] === 'Nf3',
  },
  {
    id: 'bishop-diagonal',
    title: 'El alfil vuela en diagonal',
    tagline: 'Activa un alfil moviéndolo a una buena diagonal',
    intro:
      'El alfil se mueve cualquier cantidad de casillas en diagonal. Cada bando tiene dos: uno de casillas claras y otro de oscuras. Necesitan espacio. Saca el alfil blanco de f1 a c4, apuntando al rey rival.',
    hint:
      'Primero mueve el peón de e2 a e4 para abrir la diagonal. Después saca el alfil de f1 a c4.',
    goal: 'Lleva un alfil a c4',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    glyph: '♗',
    difficulty: 2,
    validate: (san) => san.some((m) => m === 'Bc4'),
  },
  {
    id: 'capture-piece',
    title: 'Captura una pieza',
    tagline: 'Aprende a comer una pieza del rival',
    intro:
      'En el ajedrez no se "salta": para sacar una pieza del tablero hay que capturarla ocupando su casilla. En esta posición tienes un caballo en c3 listo para comer el peón negro en d5.',
    hint: 'El caballo en c3 puede capturar el peón en d5. La notación correcta es Nxd5.',
    goal: 'Captura el peón negro',
    startFen: 'rnbqkbnr/ppp1pppp/8/3p4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 1',
    glyph: '✦',
    difficulty: 2,
    validate: (san) => san.some((m) => m.includes('x')),
  },
  {
    id: 'check-king',
    title: 'Pon al rey en jaque',
    tagline: 'Amenaza al rey enemigo directamente',
    intro:
      '"Jaque" significa que el rey está amenazado y debe escapar. No puedes ignorarlo. Tu dama en d1 puede dar jaque al rey negro moviéndose a h5. Encuéntralo.',
    hint: 'Dh5 da jaque al rey negro porque ataca f7, pero acá apunta directo al rey en e8 por la diagonal abierta.',
    goal: 'Da jaque al rey negro',
    startFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
    glyph: '♕',
    difficulty: 2,
    validate: (san) => san.some((m) => m.includes('+') || m.includes('#')),
  },
  {
    id: 'mate-in-one',
    title: 'Tu primer jaque mate',
    tagline: 'Termina la partida en una sola jugada',
    intro:
      'Jaque mate es cuando el rey está en jaque y no tiene cómo escaparse. Es el objetivo final del ajedrez. En esta posición clásica, la dama puede dar mate en una jugada. Encuéntralo.',
    hint: 'La dama en h5 mira f7. Si la torre te apoya en f1... Df7 es mate, ¿o hay algo mejor?',
    goal: 'Da jaque mate',
    startFen: 'rnb1k1nr/pppp1ppp/8/4p3/2B1P2q/8/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    glyph: '♔',
    difficulty: 3,
    validate: (san) => {
      const last = san[san.length - 1];
      return !!last && last.includes('#');
    },
  },
];

const STORAGE_KEY = 'chess_co_lessons_progress';

export function loadProgress(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveProgress(completed: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    // ignorar quota errors
  }
}
