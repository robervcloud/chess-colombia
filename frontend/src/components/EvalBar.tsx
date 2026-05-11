'use client';

/**
 * Barra de evaluación vertical estilo Lichess/Chess.com.
 * - Recibe `cp` (centipawns, POV blancas) o `mate` (POV blancas).
 * - Muestra blanco abajo, negro arriba, y un texto numérico.
 * - Suaviza el cambio con CSS transition.
 */

interface Props {
  cp: number;          // POV blancas, en cp (mate ya colapsado a número grande)
  mate: number | null; // POV blancas: +N blancas matan, -N negras matan
  height?: number;     // px
}

const MAX_CP = 1000; // a partir de aquí saturamos visualmente

export default function EvalBar({ cp, mate, height = 480 }: Props) {
  // Calcular % de blancas (0..100) usando una sigmoide suave
  const whiteShare = (() => {
    if (mate !== null && mate !== undefined) {
      return mate > 0 ? 100 : 0;
    }
    const clamped = Math.max(-MAX_CP, Math.min(MAX_CP, cp));
    // Sigmoide tipo Lichess
    const wp = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
    return Math.max(2, Math.min(98, wp));
  })();

  const label = (() => {
    if (mate !== null && mate !== undefined) {
      return `M${Math.abs(mate)}`;
    }
    const pawns = cp / 100;
    const sign = pawns > 0 ? '+' : '';
    return `${sign}${pawns.toFixed(1)}`;
  })();

  const labelOnTop = whiteShare < 50;

  return (
    <div
      className="relative w-6 rounded-md overflow-hidden border border-wood-200 shadow-soft bg-wood-800 select-none"
      style={{ height }}
      aria-label={`Evaluación: ${label}`}
      title={`Evaluación: ${label}`}
    >
      {/* Parte blanca (abajo) */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-parch transition-all duration-500 ease-out"
        style={{ height: `${whiteShare}%` }}
      />
      {/* Línea media */}
      <div className="absolute left-0 right-0 h-px bg-gold/50" style={{ bottom: '50%' }} />
      {/* Etiqueta numérica */}
      <div
        className={[
          'absolute left-0 right-0 text-[10px] font-semibold tabular-nums text-center',
          labelOnTop ? 'top-1 text-parch' : 'bottom-1 text-ink',
        ].join(' ')}
      >
        {label}
      </div>
    </div>
  );
}
