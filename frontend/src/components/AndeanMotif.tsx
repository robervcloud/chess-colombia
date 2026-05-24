'use client';

/**
 * Motif andino reutilizable. SVG inline, 0 KB, escala vectorial.
 *
 * Filosofía visual: identidad colombiana SIN clichés. La cordillera de
 * los Andes es lo que define geográfica y culturalmente a Bogotá, Cali,
 * Medellín, todo el eje cafetero. Usamos su silueta como acento, no como
 * decoración protagónica.
 *
 * Tres variantes:
 *   - 'banner'  → ancho completo, ideal para hero
 *   - 'corner'  → esquinero discreto en cards
 *   - 'icon'    → micro-acento inline en headers
 *
 * Paleta heredada del theme: gold, accent (esmeralda), wood. Sin
 * literales hex hardcoded para mantener consistencia.
 */

interface Props {
  variant?: 'banner' | 'corner' | 'icon';
  className?: string;
}

export function AndeanMotif({ variant = 'banner', className }: Props) {
  if (variant === 'icon') {
    // Micro-acento triangular dorado: tres cumbres simples.
    return (
      <svg
        className={className}
        viewBox="0 0 32 16"
        fill="none"
        aria-hidden
        style={{ display: 'inline-block', verticalAlign: 'middle' }}
      >
        <path
          d="M2 14 L8 4 L13 10 L18 2 L24 9 L30 14 Z"
          fill="currentColor"
          opacity="0.85"
        />
      </svg>
    );
  }

  if (variant === 'corner') {
    // Esquinero translúcido — montaña + niebla. Decorativo y discreto.
    return (
      <svg
        className={className}
        viewBox="0 0 120 60"
        fill="none"
        aria-hidden
        preserveAspectRatio="xMaxYMax slice"
      >
        <defs>
          <linearGradient id="andean-corner-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.18" />
          </linearGradient>
        </defs>
        <path
          d="M0 60 L20 40 L42 50 L60 28 L82 44 L100 32 L120 48 L120 60 Z"
          fill="url(#andean-corner-fade)"
        />
      </svg>
    );
  }

  // Banner — silueta de cordillera con dos planos: lejano (niebla) y
  // cercano (sólido). Funciona como fondo de hero o footer.
  return (
    <svg
      className={className}
      viewBox="0 0 1200 200"
      fill="none"
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="andean-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b89a6e" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#b89a6e" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="andean-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6e4a26" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#6e4a26" stopOpacity="0.65" />
        </linearGradient>
      </defs>
      {/* Plano lejano (niebla) */}
      <path
        d="M0 200 L0 120 L80 90 L160 115 L240 75 L320 110 L420 60 L520 95 L620 70 L740 100 L850 65 L960 90 L1080 70 L1200 95 L1200 200 Z"
        fill="url(#andean-far)"
      />
      {/* Plano cercano (cordillera sólida) */}
      <path
        d="M0 200 L0 155 L70 130 L150 150 L220 115 L300 145 L380 110 L470 140 L560 105 L660 135 L760 110 L860 140 L970 115 L1080 135 L1200 120 L1200 200 Z"
        fill="url(#andean-near)"
      />
    </svg>
  );
}

export default AndeanMotif;
