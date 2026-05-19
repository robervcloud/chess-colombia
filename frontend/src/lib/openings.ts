/**
 * Detección de aperturas liviana, client-side, sin APIs ni deps.
 *
 * Estrategia: tabla de prefijos SAN normalizados → nombre/ECO. El match
 * es por el prefijo MÁS LARGO que coincida con las jugadas jugadas.
 * Coste O(plies) por lookup; cacheable trivialmente porque sólo depende
 * de la lista de SAN.
 *
 * Cobertura: las ~40 aperturas más frecuentes en juego online. No es
 * exhaustivo (no reemplaza la base ECO completa de 3500 líneas) pero
 * cubre la gran mayoría de partidas amateur sin pesar nada.
 *
 * Para ampliar: agregá entradas a OPENINGS. Las claves son la secuencia
 * SAN separada por espacios SIN números de jugada (ej. "e4 c5 Nf3 d6").
 */

export interface OpeningInfo {
  eco: string;
  name: string;
}

// Orden no importa: el matcher elige el prefijo más largo.
const OPENINGS: Record<string, OpeningInfo> = {
  'e4': { eco: 'B00', name: 'Apertura de Peón de Rey' },
  'd4': { eco: 'A40', name: 'Apertura de Peón de Dama' },
  'c4': { eco: 'A10', name: 'Apertura Inglesa' },
  'Nf3': { eco: 'A04', name: 'Apertura Réti' },
  'g3': { eco: 'A00', name: 'Apertura Benko/Hungría' },
  'b3': { eco: 'A01', name: 'Apertura Larsen' },
  'f4': { eco: 'A02', name: 'Apertura Bird' },

  // 1.e4
  'e4 c5': { eco: 'B20', name: 'Defensa Siciliana' },
  'e4 c5 Nf3 d6': { eco: 'B50', name: 'Siciliana, variante moderna' },
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6': { eco: 'B90', name: 'Siciliana Najdorf' },
  'e4 c5 Nf3 Nc6': { eco: 'B30', name: 'Siciliana, variante Rossolimo' },
  'e4 c5 Nf3 e6': { eco: 'B40', name: 'Siciliana Paulsen' },
  'e4 c5 Nc3': { eco: 'B23', name: 'Siciliana Cerrada' },
  'e4 e5': { eco: 'C20', name: 'Apertura Abierta' },
  'e4 e5 Nf3': { eco: 'C40', name: 'Juego de Caballo de Rey' },
  'e4 e5 Nf3 Nc6 Bb5': { eco: 'C60', name: 'Apertura Española (Ruy López)' },
  'e4 e5 Nf3 Nc6 Bb5 a6': { eco: 'C70', name: 'Ruy López, Morphy' },
  'e4 e5 Nf3 Nc6 Bc4': { eco: 'C50', name: 'Apertura Italiana' },
  'e4 e5 Nf3 Nc6 Bc4 Bc5': { eco: 'C50', name: 'Giuoco Piano' },
  'e4 e5 Nf3 Nc6 Bc4 Nf6': { eco: 'C55', name: 'Defensa de los Dos Caballos' },
  'e4 e5 Nf3 Nf6': { eco: 'C42', name: 'Defensa Petrov' },
  'e4 e5 Nf3 Nc6 d4': { eco: 'C44', name: 'Apertura Escocesa' },
  'e4 e5 Bc4': { eco: 'C23', name: 'Apertura del Alfil' },
  'e4 e5 Nc3': { eco: 'C25', name: 'Apertura Vienesa' },
  'e4 e5 f4': { eco: 'C30', name: 'Gambito de Rey' },
  'e4 e6': { eco: 'C00', name: 'Defensa Francesa' },
  'e4 e6 d4 d5 Nc3': { eco: 'C10', name: 'Francesa, variante Paulsen' },
  'e4 e6 d4 d5 e5': { eco: 'C02', name: 'Francesa, variante del Avance' },
  'e4 e6 d4 d5 exd5': { eco: 'C01', name: 'Francesa, variante del Cambio' },
  'e4 c6': { eco: 'B10', name: 'Defensa Caro-Kann' },
  'e4 c6 d4 d5 Nc3': { eco: 'B15', name: 'Caro-Kann, variante clásica' },
  'e4 c6 d4 d5 e5': { eco: 'B12', name: 'Caro-Kann, variante del Avance' },
  'e4 d6': { eco: 'B07', name: 'Defensa Pirc' },
  'e4 g6': { eco: 'B06', name: 'Defensa Moderna' },
  'e4 Nf6': { eco: 'B02', name: 'Defensa Alekhine' },
  'e4 d5': { eco: 'B01', name: 'Defensa Escandinava' },

  // 1.d4
  'd4 d5': { eco: 'D00', name: 'Peón de Dama, juego cerrado' },
  'd4 d5 c4': { eco: 'D06', name: 'Gambito de Dama' },
  'd4 d5 c4 e6': { eco: 'D30', name: 'Gambito de Dama Declinado' },
  'd4 d5 c4 dxc4': { eco: 'D20', name: 'Gambito de Dama Aceptado' },
  'd4 d5 c4 c6': { eco: 'D10', name: 'Defensa Eslava' },
  'd4 Nf6': { eco: 'A45', name: 'Defensa India' },
  'd4 Nf6 c4 e6': { eco: 'E00', name: 'India de Dama / Nimzo' },
  'd4 Nf6 c4 e6 Nc3 Bb4': { eco: 'E20', name: 'Defensa Nimzo-India' },
  'd4 Nf6 c4 e6 Nf3 b6': { eco: 'E12', name: 'Defensa India de Dama' },
  'd4 Nf6 c4 g6': { eco: 'E60', name: 'Defensa India de Rey' },
  'd4 Nf6 c4 g6 Nc3 d5': { eco: 'D70', name: 'Defensa Grünfeld' },
  'd4 Nf6 c4 c5': { eco: 'A50', name: 'Defensa Benoni' },
  'd4 f5': { eco: 'A80', name: 'Defensa Holandesa' },
  'd4 d5 c4 e6 Nc3 Nf6 Bg5': { eco: 'D50', name: 'Gambito de Dama, variante clásica' },

  // 1.c4 / 1.Nf3
  'c4 e5': { eco: 'A20', name: 'Inglesa, Siciliana invertida' },
  'c4 c5': { eco: 'A30', name: 'Inglesa Simétrica' },
  'c4 Nf6': { eco: 'A15', name: 'Inglesa, India anglo' },
  'Nf3 d5 g3': { eco: 'A07', name: 'Ataque Indio de Rey' },
};

/**
 * Devuelve la apertura para una lista de SAN (sin números de jugada).
 * `outOfBook` = había match antes pero la última jugada salió de teoría.
 */
export function detectOpening(sanMoves: string[]): {
  info: OpeningInfo | null;
  outOfBook: boolean;
} {
  if (!sanMoves || sanMoves.length === 0) return { info: null, outOfBook: false };

  // Limpiar símbolos (+, #, !, ?) que no afectan identidad de apertura.
  const clean = sanMoves.map((m) => m.replace(/[+#!?]/g, ''));

  let best: OpeningInfo | null = null;
  let bestLen = 0;
  // Probar prefijos decrecientes: cuanto más largo el match, más específico.
  for (let len = Math.min(clean.length, 20); len >= 1; len--) {
    const key = clean.slice(0, len).join(' ');
    if (OPENINGS[key]) {
      best = OPENINGS[key];
      bestLen = len;
      break;
    }
  }

  // outOfBook: tenemos un match pero ya jugamos más allá de él y no hay
  // ninguna entrada más larga (heurística: > bestLen + 2 fuera de libro).
  const outOfBook = best !== null && clean.length > bestLen + 2;
  return { info: best, outOfBook };
}
