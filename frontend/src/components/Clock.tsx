'use client';

import { useEffect, useState } from 'react';

interface ClockProps {
  /** Ms restantes según el último snapshot del server */
  baseMs: number;
  /** Date.now() del cliente cuando recibió ese baseMs */
  baseAt: number;
  /** ¿Es el turno de este jugador ahora? Si sí, el reloj corre. */
  active: boolean;
  /** Si la partida ya terminó: el reloj queda congelado en baseMs */
  frozen?: boolean;
  /** Tamaño visual */
  size?: 'sm' | 'md' | 'lg';
}

const LOW_TIME_MS = 60_000; // bajo 1 min: rojo + pulse + décimas

/**
 * Reloj de partida.
 * - El SERVIDOR es la fuente de verdad. Este componente sólo extrapola
 *   para mostrar un tic suave entre snapshots.
 * - Se re-sincroniza cada vez que llega game:state o game:move
 *   (cambian baseMs/baseAt y el effect re-arranca).
 * - No tiene timer cuando active=false o frozen=true (cero coste).
 */
export default function Clock({
  baseMs,
  baseAt,
  active,
  frozen = false,
  size = 'md',
}: ClockProps) {
  // Cuánto tiempo ha pasado desde que recibimos baseMs
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || frozen) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    // Tick inmediato para evitar el flash inicial
    setNow(Date.now());
    return () => window.clearInterval(id);
  }, [active, frozen, baseAt, baseMs]);

  const remaining = (() => {
    if (!active || frozen) return Math.max(0, baseMs);
    return Math.max(0, baseMs - (now - baseAt));
  })();

  const isLow = remaining < LOW_TIME_MS;
  const showTenths = remaining < LOW_TIME_MS;

  const sizes = {
    sm: 'text-base px-2.5 py-1   min-w-[4.5rem]',
    md: 'text-2xl  px-3.5 py-1.5 min-w-[6rem]',
    lg: 'text-3xl  px-4   py-2   min-w-[7rem]',
  } as const;

  return (
    <div
      className={[
        'inline-flex items-baseline justify-end',
        'rounded-md font-semibold tabular-nums tracking-tight',
        'transition-colors duration-200',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
        sizes[size],
        // Estado de fondo y color
        frozen
          ? 'bg-wood-50 text-wood-600'
          : active
          ? isLow
            ? 'bg-clay text-parch animate-clock-pulse'
            : 'bg-wood-800 text-parch'
          : 'bg-wood-50 text-wood-700',
        // Borde sutil cuando NO está activo
        !active && !frozen ? 'border border-wood-100' : '',
      ].join(' ')}
      aria-label="Reloj"
    >
      {formatClock(remaining, showTenths)}
    </div>
  );
}

function formatClock(ms: number, tenths: boolean): string {
  const totalSec = ms / 1000;
  if (!tenths) {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  const wholeSec = Math.floor(totalSec);
  const decimal = Math.floor((totalSec - wholeSec) * 10);
  return `${wholeSec.toString().padStart(2, '0')}.${decimal}`;
}
