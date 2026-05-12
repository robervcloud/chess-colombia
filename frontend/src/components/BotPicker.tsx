'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Bot } from '@/types';

interface Props {
  timeControl: string;
  /** Si se pasa, sustituye al estado interno del picker (controlado externamente). */
  onTimeControlChange?: (tc: string) => void;
  /** En modo 'modal' el componente se monta con overlay; en 'inline' se renderiza
   *  embebido en el flujo de la página (sin overlay). */
  variant?: 'modal' | 'inline';
  /** En modal, controla visibilidad; en inline siempre visible. */
  open?: boolean;
  onClose?: () => void;
  onPick: (botId: string) => void;
  loading?: boolean;
  picked?: string | null;
  /** Texto opcional encima del grid (ej. mensaje de fallback de matchmaking). */
  intro?: React.ReactNode;
}

const TIME_CONTROLS = ['1+0', '3+0', '5+0', '10+0'];

/**
 * Picker de bots con dos modos:
 *  - modal: overlay fixed (legacy, ya casi no se usa)
 *  - inline: card embebida en lobby (UX premium recomendada)
 *
 * Las cards muestran avatar con gradient cálido, playStyle y descripción.
 * Los bots se cargan desde GET /api/games/bots (cache por instancia).
 */
export default function BotPicker({
  timeControl,
  onTimeControlChange,
  variant = 'modal',
  open = true,
  onClose,
  onPick,
  loading = false,
  picked = null,
  intro = null,
}: Props) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const visible = variant === 'inline' || open;

  useEffect(() => {
    if (!visible || bots) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ bots: Bot[] }>('/api/games/bots');
        if (!cancelled) setBots(r.bots);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'No se pudieron cargar los bots');
      }
    })();
    return () => { cancelled = true; };
  }, [visible, bots]);

  if (!visible) return null;

  const content = (
    <>
      {intro && (
        <div className="mb-5 animate-fadeIn">{intro}</div>
      )}

      {onTimeControlChange && (
        <div className="mb-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-wood-500 mb-2">
            Tiempo
          </p>
          <div className="flex flex-wrap gap-2">
            {TIME_CONTROLS.map((tc) => (
              <button
                key={tc}
                onClick={() => onTimeControlChange(tc)}
                disabled={loading}
                className={[
                  'px-3 py-1.5 rounded-md text-sm border transition-colors',
                  tc === timeControl
                    ? 'bg-gold/20 border-gold text-ink'
                    : 'bg-parch border-wood-200 text-wood-700 hover:border-gold/60',
                ].join(' ')}
              >
                {tc}
              </button>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-danger text-sm mb-4">{err}</p>}

      {!bots && !err && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-wood-100 bg-wood-50/50 h-32 animate-pulse"
            />
          ))}
        </div>
      )}

      {bots && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {bots.map((b) => {
            const isPicked = picked === b.id;
            const grad = `linear-gradient(135deg, ${b.gradient[0]}, ${b.gradient[1]})`;
            return (
              <button
                key={b.id}
                onClick={() => onPick(b.id)}
                disabled={loading}
                className={[
                  'group relative overflow-hidden text-left rounded-xl p-4 transition-all',
                  'bg-parch/60 hover:bg-parch hover:-translate-y-0.5 hover:shadow-md',
                  'border focus:outline-none focus:ring-2 focus:ring-gold/40',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  isPicked
                    ? 'border-gold ring-2 ring-gold/30'
                    : 'border-wood-100 hover:border-gold/60',
                ].join(' ')}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-12 h-12 shrink-0 rounded-full grid place-items-center text-2xl
                               shadow-soft ring-1 ring-black/5"
                    style={{ backgroundImage: grad }}
                  >
                    <span className="drop-shadow-sm">{b.avatar}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-display text-base truncate">{b.name}</h3>
                      <span className="text-[11px] tabular-nums text-wood-500 shrink-0">
                        ~{b.eloApprox}
                      </span>
                    </div>
                    <p className="text-[11px] uppercase tracking-wider text-gold mt-0.5">
                      {b.playStyle}
                    </p>
                    <p className="text-xs text-wood-600 mt-1.5 line-clamp-2 leading-relaxed">
                      {b.description}
                    </p>
                    {isPicked && loading && (
                      <p className="text-xs text-gold mt-2 animate-pulse">Creando partida…</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  if (variant === 'inline') {
    return <div className="animate-fadeIn">{content}</div>;
  }

  // Variant modal (legacy)
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm grid place-items-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="card-premium max-w-3xl w-full p-6 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-5 flex items-baseline justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-wood-500">Elige tu rival</p>
            <h2 className="font-display text-2xl mt-1">Bots colombianos</h2>
            <p className="text-sm text-wood-600 mt-1">
              Tiempo: <span className="font-medium">{timeControl}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-wood-500 hover:text-ink text-sm">
            Cerrar
          </button>
        </header>
        {content}
        <p className="text-[11px] text-wood-500 mt-5">
          Los bots usan Stockfish con niveles ajustados. El análisis post-partida funciona igual.
        </p>
      </div>
    </div>
  );
}
