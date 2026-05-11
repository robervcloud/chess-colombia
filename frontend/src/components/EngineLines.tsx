'use client';

import type { AnalysisLine } from '@/types/analysis';

interface Props {
  lines: AnalysisLine[];
  bestMoveSan: string | null;
  /** Texto extra arriba del panel (e.g. "Mejor: Nf3" o "Mate en 3") */
  caption?: string | null;
}

function formatScore(line: AnalysisLine): string {
  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0 ? `M${line.mate}` : `M${Math.abs(line.mate)}`;
  }
  if (line.cp === null || line.cp === undefined) return '—';
  const pawns = line.cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export default function EngineLines({ lines, bestMoveSan, caption }: Props) {
  if (!lines || lines.length === 0) {
    return (
      <div className="text-xs text-wood-500 italic">
        Sin líneas para esta posición.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {caption && (
        <div className="text-xs uppercase tracking-wider text-wood-500">{caption}</div>
      )}
      {lines.map((line) => {
        const isBest = bestMoveSan && line.moves[0] === bestMoveSan;
        return (
          <div
            key={line.rank}
            className={[
              'flex items-baseline gap-3 px-3 py-1.5 rounded-md',
              'border',
              isBest ? 'border-gold/40 bg-gold/5' : 'border-wood-100 bg-white',
            ].join(' ')}
          >
            <span
              className={[
                'tabular-nums text-xs font-semibold w-12 shrink-0',
                line.mate !== null
                  ? line.mate > 0 ? 'text-accent' : 'text-danger'
                  : 'text-wood-700',
              ].join(' ')}
            >
              {formatScore(line)}
            </span>
            <span className="text-sm text-ink truncate">
              {line.moves.slice(0, 8).join(' ')}
              {line.moves.length > 8 ? '…' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
