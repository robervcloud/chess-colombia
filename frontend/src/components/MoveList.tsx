'use client';

import type { MoveAnalysis, Classification } from '@/types/analysis';

interface Props {
  moves: MoveAnalysis[];
  selectedPly: number; // 0 = posición inicial; 1..N = después de la jugada N
  onSelect: (ply: number) => void;
}

const KLASS_LABEL: Record<Classification, string> = {
  best: '✓',
  excellent: '★',
  good: '·',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

const KLASS_COLOR: Record<Classification, string> = {
  best:        'text-accent-light',
  excellent:   'text-gold',
  good:        'text-wood-400',
  inaccuracy:  'text-clay-light',
  mistake:     'text-clay',
  blunder:     'text-danger',
};

export default function MoveList({ moves, selectedPly, onSelect }: Props) {
  // Agrupamos en pares (white, black) por número de jugada
  const rows: { num: number; w?: MoveAnalysis; b?: MoveAnalysis }[] = [];
  for (const m of moves) {
    const num = Math.ceil(m.ply / 2);
    let row = rows[rows.length - 1];
    if (!row || row.num !== num) {
      row = { num };
      rows.push(row);
    }
    if (m.color === 'w') row.w = m;
    else row.b = m;
  }

  return (
    <div className="overflow-y-auto max-h-[420px] pr-1 -mr-1 text-sm">
      {rows.map((r) => (
        <div key={r.num} className="grid grid-cols-[2.5rem_1fr_1fr] gap-1 items-baseline py-0.5">
          <div className="text-wood-400 tabular-nums text-right pr-1">{r.num}.</div>
          <MoveCell move={r.w} selected={r.w?.ply === selectedPly} onSelect={onSelect} />
          <MoveCell move={r.b} selected={r.b?.ply === selectedPly} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

function MoveCell({
  move,
  selected,
  onSelect,
}: {
  move?: MoveAnalysis;
  selected: boolean;
  onSelect: (ply: number) => void;
}) {
  if (!move) return <div />;
  return (
    <button
      onClick={() => onSelect(move.ply)}
      className={[
        'flex items-baseline gap-1.5 px-2 py-0.5 rounded text-left transition-colors',
        'hover:bg-wood-50',
        selected ? 'bg-wood-100 text-ink font-semibold' : 'text-wood-800',
      ].join(' ')}
      title={move.classification}
    >
      <span className={`text-xs font-bold ${KLASS_COLOR[move.classification]}`}>
        {KLASS_LABEL[move.classification]}
      </span>
      <span>{move.san}</span>
    </button>
  );
}
