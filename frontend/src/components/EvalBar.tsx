'use client';

/**
 * Barra de evaluación vertical estilo Lichess/Chess.com.
 * - Recibe `cp` (centipawns, POV blancas) o `mate` (POV blancas).
 * - Muestra blanco abajo, negro arriba, y un texto numérico legible.
 * - Suaviza el cambio con CSS transition de 500ms.
 * - Glow cálido cuando hay mate (visual viva al estilo Chess.com).
 */

interface Props {
  cp: number;          // POV blancas, en cp (mate ya colapsado a número grande)
  mate: number | null; // POV blancas: +N blancas matan, -N negras matan
  height?: number;     // px
}

const MAX_CP = 1000;

export default function EvalBar({ cp, mate, height = 480 }: Props) {
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
  const isMate = mate !== null && mate !== undefined;

  return (
    <div
      className={[
        'relative w-7 rounded-md overflow-hidden border select-none',
        isMate ? 'border-gold/60 eval-mate' : 'border-wood-200 shadow-soft',
        'bg-wood-800',
      ].join(' ')}
      style={{ height }}
      aria-label={`Evaluación: ${label}`}
      title={`Evaluación: ${label}`}
    >
      {/* Parte blanca (abajo) con gradient cálido sutil */}
      <div
        className="absolute bottom-0 left-0 right-0 transition-all duration-500 ease-out"
        style={{
          height: `${whiteShare}%`,
          background: 'linear-gradient(180deg, #faf4e6 0%, #f5efe6 100%)',
        }}
      />
      {/* Línea media — dorada con glow sutil */}
      <div
        className="absolute left-0 right-0"
        style={{
          bottom: '50%',
          height: '1px',
          background: 'rgba(201, 162, 74, 0.55)',
          boxShadow: '0 0 4px rgba(201, 162, 74, 0.5)',
        }}
      />
      {/* Etiqueta numérica con sombra cálida para legibilidad */}
      <div
        className={[
          'absolute left-0 right-0 text-[11px] font-semibold tabular-nums text-center',
          labelOnTop ? 'top-1.5 text-parch' : 'bottom-1.5 text-ink',
        ].join(' ')}
        style={{
          textShadow: labelOnTop
            ? '0 1px 2px rgba(0,0,0,0.4)'
            : '0 1px 2px rgba(255,255,255,0.6)',
        }}
      >
        {label}
      </div>
    </div>
  );
}
