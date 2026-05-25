'use client';

import { memo } from 'react';

import { MoveBadge } from '@/components/MoveBadge';
import type { MoveAnalysis } from '@/types/analysis';

interface Props {
  moves: MoveAnalysis[];
  selectedPly: number; // 0 = posición inicial; 1..N = después de la jugada N
  onSelect: (ply: number) => void;
}

/**
 * Lista de jugadas pareada en formato PGN.
 *
 * Usa `MoveBadge` variante 'icon' para mostrar la calidad de cada
 * jugada de forma compacta (símbolo a la izquierda del SAN). Soporta
 * los 9 niveles de Classification, incluido book/brilliant/great que
 * faltaban en la versión previa.
 */
function MoveList({ moves, selectedPly, onSelect }: Props) {
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
    <div className="overflow-y-auto pr-1 -mr-1 text-sm">
      {rows.length === 0 && (
        <p className="text-xs text-wood-500 italic px-1 py-2">Sin jugadas aún…</p>
      )}
      {rows.map((r) => (
        <div
          key={r.num}
          className="grid grid-cols-[2.5rem_1fr_1fr] gap-1 items-baseline py-0.5"
        >
          <div className="text-wood-400 tabular-nums text-right pr-1 text-xs">
            {r.num}.
          </div>
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
  const k = move.classification;
  const notable = k === 'brilliant' || k === 'great' || k === 'blunder';
  return (
    <button
      onClick={() => onSelect(move.ply)}
      className={[
        'move-row',
        selected ? 'move-row-active' : '',
      ].join(' ')}
      title={`${move.san} · ${k}`}
    >
      <MoveBadge k={k} variant="icon" />
      <span className={notable ? 'font-medium' : ''}>{move.san}</span>
    </button>
  );
}

/**
 * Memoizado con comparator: re-renderiza solo si cambia la longitud
 * de moves, el ply seleccionado, o la última clasificación (streaming).
 * Reduce drásticamente rerenders durante el polling del análisis live.
 */
export default memo(MoveList, (prev, next) => {
  if (prev.selectedPly !== next.selectedPly) return false;
  if (prev.onSelect !== next.onSelect) return false;
  if (prev.moves.length !== next.moves.length) return false;
  // Comparar últimas clasificaciones (caso streaming: misma length, classification cambia)
  const lastIdx = prev.moves.length - 1;
  if (lastIdx >= 0 && prev.moves[lastIdx].classification !== next.moves[lastIdx].classification) {
    return false;
  }
  return true;
});
