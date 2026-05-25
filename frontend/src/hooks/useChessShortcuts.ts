'use client';

import { useEffect } from 'react';

/**
 * Atajos de teclado estilo Lichess/Chess.com para análisis:
 *   - ←        → ply anterior
 *   - →        → ply siguiente
 *   - Home / ⇱ → posición inicial
 *   - End  / ⇲ → última posición
 *   - f        → girar tablero (flip)
 *
 * No dispara si el foco está en input/textarea (evita conflictos
 * con el textarea de PGN o cualquier formulario).
 */
export interface ChessShortcutHandlers {
  onPrev?: () => void;
  onNext?: () => void;
  onFirst?: () => void;
  onLast?: () => void;
  onFlip?: () => void;
}

export function useChessShortcuts(handlers: ChessShortcutHandlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignorar si el usuario está escribiendo en un input/textarea
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          if (handlers.onPrev) { e.preventDefault(); handlers.onPrev(); }
          break;
        case 'ArrowRight':
          if (handlers.onNext) { e.preventDefault(); handlers.onNext(); }
          break;
        case 'Home':
          if (handlers.onFirst) { e.preventDefault(); handlers.onFirst(); }
          break;
        case 'End':
          if (handlers.onLast) { e.preventDefault(); handlers.onLast(); }
          break;
        case 'f':
        case 'F':
          // Sólo si no hay modificadores (Ctrl+F = buscar)
          if (!e.ctrlKey && !e.metaKey && handlers.onFlip) {
            e.preventDefault();
            handlers.onFlip();
          }
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers.onPrev, handlers.onNext, handlers.onFirst, handlers.onLast, handlers.onFlip]);
}
