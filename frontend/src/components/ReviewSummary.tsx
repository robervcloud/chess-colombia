'use client';

import { useMemo } from 'react';

import { MoveBadge } from '@/components/MoveBadge';
import {
  CLASS_META,
  NEGATIVE,
  NOTABLE,
  POSITIVE,
  type Classification,
  type Phase,
} from '@/lib/moveClassification';

interface ReviewMove {
  ply: number;
  san: string;
  color: 'w' | 'b';
  classification?: Classification;
  cpLoss?: number | null;
  phase?: Phase;
}

interface ReviewSummaryProps {
  moves: ReviewMove[];
  /** Color del usuario logueado, para resaltar en breakdown */
  myColor?: 'w' | 'b' | null;
  /** Click sobre un momento clave → navega al ply */
  onSelectPly?: (ply: number) => void;
  /** Ply actualmente visible (para marker en timeline) */
  selectedPly?: number;
  /** Si true, oculta el bloque de timeline horizontal */
  compact?: boolean;
}

/**
 * Panel premium del análisis post-partida.
 *
 * Contenido:
 *   1. Timeline horizontal: marker dorado por jugada (color según
 *      clasificación), clickeable. Marker del ply activo brilla.
 *   2. Distribución (chips por clase + count) blanco vs negro.
 *   3. Breakdown por fase (opening/middlegame/endgame): accuracy %.
 *   4. Momentos críticos: las 2-3 jugadas más notables (brilliant/
 *      great/blunder/mistake) ordenadas por relevancia.
 *
 * Reutilizable en /game/[id]/analysis y /analyze. Sin libs externas.
 */
export function ReviewSummary({
  moves,
  myColor,
  onSelectPly,
  selectedPly,
  compact = false,
}: ReviewSummaryProps) {
  // Solo procesa jugadas con clasificación asignada
  const classified = useMemo(
    () => moves.filter((m) => !!m.classification),
    [moves]
  );

  // Distribución total + por color
  const dist = useMemo(() => {
    const all = new Map<Classification, number>();
    const w = new Map<Classification, number>();
    const b = new Map<Classification, number>();
    for (const m of classified) {
      const k = m.classification!;
      all.set(k, (all.get(k) || 0) + 1);
      const map = m.color === 'w' ? w : b;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return { all, w, b };
  }, [classified]);

  // Accuracy por fase: % de jugadas POSITIVE sobre clasificadas en esa fase
  const phaseStats = useMemo(() => {
    const phases: Phase[] = ['opening', 'middlegame', 'endgame'];
    return phases.map((p) => {
      const inPhase = classified.filter((m) => m.phase === p);
      const total = inPhase.length;
      if (total === 0) return { phase: p, total: 0, accuracy: null as number | null };
      const good = inPhase.filter((m) => POSITIVE.includes(m.classification!)).length;
      return { phase: p, total, accuracy: Math.round((good / total) * 100) };
    });
  }, [classified]);

  // Momentos críticos: brilliant/great primero, luego blunders/mistakes
  // por mayor cpLoss. Limitado a 4 para no saturar visualmente.
  const moments = useMemo(() => {
    const positives = classified.filter((m) =>
      m.classification === 'brilliant' || m.classification === 'great'
    );
    const negatives = classified
      .filter((m) => m.classification === 'blunder' || m.classification === 'mistake')
      .sort((a, b) => (b.cpLoss ?? 0) - (a.cpLoss ?? 0));
    return [...positives.slice(0, 2), ...negatives.slice(0, 2)];
  }, [classified]);

  if (classified.length === 0) {
    return (
      <div className="card-premium p-5">
        <h3 className="font-display text-lg mb-2">Resumen</h3>
        <p className="text-xs text-wood-500 italic">
          Esperando jugadas analizadas…
        </p>
      </div>
    );
  }

  return (
    <div className="card-premium p-5 space-y-5">
      <h3 className="font-display text-lg">Resumen del análisis</h3>

      {!compact && (
        <Timeline
          moves={classified}
          selectedPly={selectedPly}
          onSelectPly={onSelectPly}
        />
      )}

      <DistributionByColor dist={dist} myColor={myColor} />

      <PhaseBreakdown stats={phaseStats} />

      {moments.length > 0 && (
        <Moments moments={moments} onSelectPly={onSelectPly} />
      )}
    </div>
  );
}

/* ============================================================ */
/* Timeline horizontal                                           */
/* ============================================================ */

function Timeline({
  moves,
  selectedPly,
  onSelectPly,
}: {
  moves: ReviewMove[];
  selectedPly?: number;
  onSelectPly?: (ply: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-wood-500">
          Línea de tiempo
        </span>
        <span className="text-[10px] text-wood-400">
          {moves.length} jugadas
        </span>
      </div>
      <div
        className="relative w-full overflow-x-auto pb-1 -mx-1 px-1"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="flex items-end gap-[2px] h-7">
          {moves.map((m) => {
            const k = m.classification!;
            const meta = CLASS_META[k];
            const isSelected = selectedPly === m.ply;
            const isNotable = NOTABLE.includes(k);
            const height =
              k === 'blunder' ? 22
              : k === 'mistake' ? 16
              : k === 'inaccuracy' ? 11
              : k === 'brilliant' ? 24
              : k === 'great' ? 18
              : k === 'best' ? 14
              : k === 'excellent' ? 12
              : 8;
            return (
              <button
                key={m.ply}
                type="button"
                onClick={() => onSelectPly?.(m.ply)}
                title={`${m.san} · ${meta.label}${m.cpLoss != null ? ` (−${Math.round(m.cpLoss)} cp)` : ''}`}
                className={[
                  'shrink-0 rounded-sm transition-all duration-200 ease-out',
                  'hover:scale-y-110 hover:-translate-y-0.5',
                  isSelected ? 'ring-2 ring-gold ring-offset-1 ring-offset-parch' : '',
                ].join(' ')}
                style={{
                  width: 4,
                  height,
                  background: meta.arrow,
                  boxShadow: isNotable
                    ? `0 0 8px -2px ${meta.glow}`
                    : undefined,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Distribución por color                                        */
/* ============================================================ */

function DistributionByColor({
  dist,
  myColor,
}: {
  dist: { all: Map<Classification, number>; w: Map<Classification, number>; b: Map<Classification, number> };
  myColor?: 'w' | 'b' | null;
}) {
  const ORDER: Classification[] = [
    'brilliant', 'great', 'best', 'excellent', 'good', 'book',
    'inaccuracy', 'mistake', 'blunder',
  ];
  const visible = ORDER.filter((k) => (dist.all.get(k) || 0) > 0);
  if (visible.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-wood-500 mb-2">
        Distribución
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-center text-sm">
        <div />
        <div className={`text-[10px] uppercase tracking-wider tabular-nums text-right ${myColor === 'w' ? 'text-gold font-medium' : 'text-wood-500'}`}>
          Blancas
        </div>
        <div className={`text-[10px] uppercase tracking-wider tabular-nums text-right ${myColor === 'b' ? 'text-gold font-medium' : 'text-wood-500'}`}>
          Negras
        </div>
        {visible.map((k) => (
          <div key={k} className="contents">
            <MoveBadge k={k} variant="chip" />
            <span className="tabular-nums text-right text-wood-700">
              {dist.w.get(k) || 0}
            </span>
            <span className="tabular-nums text-right text-wood-700">
              {dist.b.get(k) || 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================ */
/* Breakdown por fase                                            */
/* ============================================================ */

function PhaseBreakdown({
  stats,
}: {
  stats: Array<{ phase: Phase; total: number; accuracy: number | null }>;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-wood-500 mb-2">
        Precisión por fase
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <PhaseCard key={s.phase} phase={s.phase} total={s.total} accuracy={s.accuracy} />
        ))}
      </div>
    </div>
  );
}

function PhaseCard({
  phase, total, accuracy,
}: { phase: Phase; total: number; accuracy: number | null }) {
  const label =
    phase === 'opening' ? 'Apertura' :
    phase === 'middlegame' ? 'Medio juego' : 'Final';
  const pct = accuracy ?? 0;
  const tone =
    accuracy == null    ? 'bg-wood-50/50  text-wood-400 border-wood-100'
    : pct >= 85         ? 'bg-accent/10   text-accent   border-accent/30'
    : pct >= 65         ? 'bg-gold/15     text-wood-800 border-gold/40'
    :                     'bg-clay/10     text-clay     border-clay/30';
  return (
    <div className={`rounded-lg border px-3 py-2 transition-all ${tone}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-display text-xl tabular-nums leading-tight mt-0.5">
        {accuracy == null ? '—' : `${pct}%`}
      </div>
      <div className="text-[10px] opacity-70 tabular-nums">
        {total} {total === 1 ? 'jugada' : 'jugadas'}
      </div>
    </div>
  );
}

/* ============================================================ */
/* Momentos críticos                                             */
/* ============================================================ */

function Moments({
  moments,
  onSelectPly,
}: {
  moments: ReviewMove[];
  onSelectPly?: (ply: number) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-wood-500 mb-2">
        Momentos clave
      </div>
      <ul className="space-y-1.5">
        {moments.map((m) => (
          <li key={m.ply}>
            <button
              type="button"
              onClick={() => onSelectPly?.(m.ply)}
              className={[
                'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md',
                'border border-wood-100 bg-wood-50/40 hover:bg-wood-50',
                'transition-colors duration-150 text-left',
              ].join(' ')}
            >
              <div className="flex items-center gap-2 min-w-0">
                <MoveBadge k={m.classification!} variant="chip" pulse={m.classification === 'brilliant' || m.classification === 'great'} />
                <span className="text-xs text-wood-500 tabular-nums shrink-0">
                  {Math.ceil(m.ply / 2)}{m.color === 'w' ? '.' : '…'}
                </span>
                <span className="text-sm font-medium text-ink truncate">
                  {m.san}
                </span>
              </div>
              {m.cpLoss != null && m.cpLoss > 0 && (
                <span className="text-[10px] tabular-nums text-wood-500 shrink-0">
                  −{Math.round(m.cpLoss)} cp
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ReviewSummary;
