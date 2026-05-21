'use client';

import { CLASS_META, type Classification } from '@/lib/moveClassification';

/**
 * Badge premium de clasificación de jugada.
 *
 * Variantes:
 *   - 'chip':  pequeño, inline en move lists. Símbolo + (opcional) label.
 *   - 'large': tarjeta del panel, símbolo + label + glow cálido + hover.
 *   - 'icon':  solo símbolo (?!?, ✓, !!, ?!), para overlays mínimos.
 *
 * Identidad: paleta colombiana cálida (dorado/esmeralda/azul/terracota
 * sobre madera/parch). Glow proporcional a la severidad/altura.
 */
export interface MoveBadgeProps {
  k: Classification;
  variant?: 'chip' | 'large' | 'icon';
  /** En chip/large, oculta el label de texto (solo símbolo) */
  hideLabel?: boolean;
  /** Override de className para casos especiales */
  className?: string;
  /** Si true, el badge "respira" sutilmente (para jugadas remarcables) */
  pulse?: boolean;
}

export function MoveBadge({
  k,
  variant = 'chip',
  hideLabel = false,
  className,
  pulse = false,
}: MoveBadgeProps) {
  const meta = CLASS_META[k];
  if (!meta) return null;

  // Variante 'icon': solo el símbolo, ideal para superpose en MoveList.
  if (variant === 'icon') {
    return (
      <span
        title={meta.label}
        className={[
          'inline-flex items-center justify-center w-4 text-[10px] font-bold leading-none',
          k === 'brilliant' ? 'text-gold-dark'
            : k === 'great' ? 'text-blue-700'
            : k === 'best' || k === 'excellent' ? 'text-accent'
            : k === 'mistake' ? 'text-clay'
            : k === 'blunder' ? 'text-danger'
            : k === 'inaccuracy' ? 'text-wood-700'
            : 'text-wood-400',
          className || '',
        ].join(' ')}
      >
        {meta.symbol || '·'}
      </span>
    );
  }

  // Variante 'large': para el panel "jugada actual" en la review.
  if (variant === 'large') {
    return (
      <div
        className={[
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium',
          'transition-all duration-200 ease-out',
          'hover:scale-[1.02] active:scale-[0.98]',
          pulse ? 'animate-pulse' : '',
          meta.chip,
          className || '',
        ].join(' ')}
        style={{
          boxShadow: `0 0 22px -6px ${meta.glow}99, 0 1px 0 rgba(255,255,255,0.4) inset`,
        }}
        title={meta.label}
      >
        {meta.symbol && (
          <span className="font-display text-base tabular-nums leading-none">{meta.symbol}</span>
        )}
        {!hideLabel && <span>{meta.label}</span>}
      </div>
    );
  }

  // Variante 'chip' por defecto.
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium leading-none',
        'transition-colors duration-150',
        meta.chip,
        className || '',
      ].join(' ')}
      title={meta.label}
      style={pulse ? { boxShadow: `0 0 12px -4px ${meta.glow}cc` } : undefined}
    >
      {meta.symbol && (
        <span className="font-bold tabular-nums leading-none">{meta.symbol}</span>
      )}
      {!hideLabel && (
        <span className="hidden sm:inline">{meta.label}</span>
      )}
    </span>
  );
}

export default MoveBadge;
