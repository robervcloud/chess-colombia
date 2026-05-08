'use client';

import { Chessboard } from 'react-chessboard';
import type { Color } from '@/types';

interface Props {
  fen: string;
  myColor: Color | null;
  draggable: boolean;
  onMove: (from: string, to: string, promotion?: string) => Promise<boolean>;
  boardWidth?: number;
}

/**
 * Envoltorio sobre react-chessboard. Maneja la promoción al
 * coronar un peón pidiendo siempre 'q' (lo más común). Si más
 * adelante quieres dar a elegir, react-chessboard tiene API para eso.
 */
export default function ChessBoardView({
  fen,
  myColor,
  draggable,
  onMove,
  boardWidth = 480,
}: Props) {
    function handleDrop(
    sourceSquare: string,
    targetSquare: string,
    piece: string
  ): boolean {
    if (!draggable) return false;

    // Detectar promoción: peón llegando a la última fila (8 para blancas, 1 para negras)
    const isPawn = piece?.toLowerCase().endsWith('p');
    const targetRank = targetSquare[1];

    const isPromotion =
      isPawn && (targetRank === '8' || targetRank === '1');

    onMove(
      sourceSquare,
      targetSquare,
      isPromotion ? 'q' : undefined
    );

    return true;
  }
  
  return (
    <Chessboard
      position={fen === 'start' ? undefined : fen}
      onPieceDrop={handleDrop}
      boardOrientation={myColor === 'b' ? 'black' : 'white'}
      arePiecesDraggable={draggable}
      boardWidth={boardWidth}
      customBoardStyle={{
        borderRadius: '12px',
        boxShadow: '0 12px 40px -12px rgba(58,39,22,0.35)',
      }}
      customDarkSquareStyle={{ backgroundColor: '#6e4a26' }}
      customLightSquareStyle={{ backgroundColor: '#f0dcb5' }}
    />
  );
}
