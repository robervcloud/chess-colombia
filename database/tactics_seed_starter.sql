-- =========================================================
-- Seed inicial de puzzles tácticos
-- =========================================================
-- 30 puzzles curados a mano, compatibles con el formato de Lichess.
-- Cada `moves_uci` es la secuencia esperada: la PRIMERA jugada es del
-- oponente (para situar la posición), la SEGUNDA la del usuario, etc.
--
-- Para importar la base completa de Lichess (~4M puzzles), ver
-- `docs/tactics_import_lichess.md`.
-- =========================================================
-- Formato: id, fen (después de la jugada del oponente),
--          moves_uci (secuencia esperada: oponente, usuario, oponente, usuario...),
--          rating, themes
-- =========================================================

insert into puzzles (id, fen, moves_uci, rating, themes, popularity) values

-- ----- Banda 600-900: tácticas elementales -----
('seed001','r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
 'g7g6 f3f7', 700, '{mate,mateIn1}', 90),
('seed002','rnbqkbnr/pppp1ppp/8/8/3pP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3',
 'd1h5 a7a6 h5f7', 750, '{mate,mateIn2,scholarsMate}', 88),
('seed003','r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
 'f3f7 e8d7 c4f7', 820, '{mate,mateIn2}', 80),
('seed004','rnb1kbnr/pp1ppppp/2p5/q7/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq - 1 3',
 'c3b5 c6b5 d1a4 b5b4 a4a5', 880, '{fork,winningPiece}', 75),
('seed005','r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 4 3',
 'g7g6 h5e5 f8e7 e5h8', 900, '{mate,mateIn3}', 70),

-- ----- Banda 900-1300: motivos clásicos -----
('seed006','r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w kq - 0 6',
 'c1g5 c6d4 g5f6 d4f3 g2f3 d8f6', 1050, '{discoveredAttack,middlegame}', 70),
('seed007','r2q1rk1/ppp2ppp/2np1n2/2b1p1B1/2B1P1b1/3P1N2/PPP2PPP/RN1Q1RK1 w - - 6 8',
 'g5f6 d8f6 b1c3 g4f3 d1f3 f6f3 g2f3', 1100, '{pin,fork}', 68),
('seed008','r3kb1r/ppp1qppp/2n2n2/3p4/3P4/2N2N2/PPP1QPPP/R1B1K2R b KQkq - 4 7',
 'e8c8 c1g5 f6e4 c3e4 d5e4 e2e4', 1200, '{pin,centralization}', 65),
('seed009','r1b1k2r/pp1n1ppp/2p1pn2/q2p4/1bPP4/2NBPN2/PP3PPP/R1BQ1RK1 w kq - 0 8',
 'd1c2 a5h5 c3e2 b4d6 e2g3 h5h6', 1250, '{trappedPiece,middlegame}', 60),
('seed010','r4rk1/pp3ppp/2n1bn2/q1ppp3/4P3/2PP1N2/PPB2PPP/R1BQ1RK1 b - - 0 12',
 'c5c4 d3c4 d5c4 c2e4 c6d4 f3d4 e5d4', 1300, '{fork,discoveredAttack}', 60),

-- ----- Banda 1300-1700: combinaciones medias -----
('seed011','r4rk1/pp1nqppp/2pbpn2/3p4/3P4/2NBPN2/PPQ2PPP/R4RK1 w - - 0 12',
 'c3b5 d6b4 b5c7 b4c5 c7a8', 1400, '{fork,trappedPiece}', 55),
('seed012','r1bq1rk1/pp3ppp/2n1pn2/2bp4/3P4/2NBPN2/PPQ2PPP/R1B2RK1 w - - 0 9',
 'd3h7 g8h7 f3g5 h7g8 c2h7', 1500, '{sacrifice,mate,mateIn3,greekGift}', 80),
('seed013','r1b2rk1/pp1nbppp/2p1pn2/q7/2PP4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 9',
 'a2a3 a5a3 b2a3 b4a3 c1a3', 1450, '{winningPiece,positional}', 50),
('seed014','r1bq1rk1/ppp2ppp/2n2n2/3pp3/1b1PP3/2N2N2/PPP1BPPP/R1BQ1RK1 b - - 0 6',
 'b4c3 b2c3 e5d4 c3d4 c6d4 f3d4 d8d4', 1550, '{deflection,fork}', 50),
('seed015','r2q1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NPBN1P/PP3PP1/R2Q1RK1 b - - 0 10',
 'f6e4 d3e4 e7g5 e3g5 d8g5', 1600, '{discoveredAttack,fork}', 48),

-- ----- Banda 1700-2100: combinaciones avanzadas -----
('seed016','r1b1r1k1/pp2qppp/2n1pn2/3p4/1b1P4/2NBPN2/PPQ2PPP/R1B1R1K1 w - - 0 12',
 'd3h7 g8h7 f3g5 h7g6 c2g6 f7g6 g5e6', 1750, '{sacrifice,mate,mateIn4,greekGift}', 70),
('seed017','r1bq1rk1/pp2nppp/2n1p3/3pP3/3P4/P1N2N2/1P3PPP/R1BQR1K1 w - - 0 13',
 'c3b5 c6d4 f3d4 d8d4 e1e4 d4d3 c1g5', 1850, '{deflection,winningPiece}', 45),
('seed018','r2qr1k1/pb1n1ppp/1p2pn2/2pp4/2PP4/2NBPN1P/PP2QPP1/R1B2RK1 w - - 0 11',
 'd3h7 g8h7 g2g4 d8e7 g4g5 f6g8 e2d3', 1950, '{attack,sacrifice}', 50),
('seed019','r4rk1/pp1qppbp/2np1np1/8/2BNP3/2N1B3/PPP2PPP/R2Q1RK1 b - - 0 10',
 'g6g5 d4f5 e7f5 e4f5 c6b4 e3b6 d7d2 d1d2 b4c2', 2050, '{trappedPiece,exchange}', 40),
('seed020','r1b2rk1/pp1n1pbp/2pp1np1/q3p3/2PPP3/2N1BN2/PP1QBPPP/R4RK1 w - - 0 11',
 'd4e5 d6e5 e3b6 a5b6 d2d8 f8d8 a1d1', 2100, '{deflection,mate}', 45),

-- ----- Banda 2100-2500: maestría -----
('seed021','r2qkb1r/pp1n1ppp/2pbpn2/3p4/2PP4/2N1PN2/PPQ1BPPP/R1B1K2R w KQkq - 6 8',
 'c4d5 e6d5 c3d5 c6d5 c2c8 d6f8 c8a8', 2200, '{deflection,exchange}', 38),
('seed022','r1b2rk1/pp1nqppp/2p1pn2/3p4/2PP4/2NQPN2/PPB2PPP/R4RK1 w - - 0 11',
 'c4d5 e6d5 c2h7 g8h7 f3g5 h7g6 d3h3', 2300, '{sacrifice,attack,mateIn5}', 55),
('seed023','r3r1k1/pp1q1ppp/2pb1n2/3p1Q2/3P4/2N1PN2/PP3PPP/R3R1K1 w - - 0 14',
 'f5h7 g8h7 f3g5 h7g6 e3e4 d5e4 c3e4 f6e4 e1e4 d6f8 e4g4', 2400, '{sacrifice,mate,attack}', 50),
('seed024','2r3k1/pp3pp1/3b3p/3p4/3P4/P1qBPN1P/1Pr2PP1/R2QR1K1 b - - 0 21',
 'c3a3 b2a3 c2c1 d1c1 c8c1 e1c1 d6a3', 2150, '{xRayAttack,winningPiece}', 42),
('seed025','5rk1/pp3rpp/4N3/3qp3/3p4/3Q1P2/PP3P1P/3R1RK1 w - - 0 24',
 'e6f4 e5f4 d3d4 d5d4 d1d4 f7f3', 2250, '{exchange,equality}', 40),

-- ----- Finales: técnica -----
('seed026','8/8/4k3/8/4P3/4K3/8/8 w - - 0 1',
 'e3d4 e6f5 e4e5 f5g6 d4e4 g6f7 e4f5 f7e7 e5e6 e7d8 f5f6', 1000, '{endgame,pawnEndgame}', 70),
('seed027','8/5k2/8/8/8/2K5/Q7/8 w - - 0 1',
 'a2g8 f7e7 c3c4 e7d6 c4d4 d6e6 g8c4 e6f6 d4e4 f6g6 c4g4 g6f6 e4f4', 1200, '{endgame,mate}', 60),
('seed028','8/8/8/4k3/8/4K3/8/R7 w - - 0 1',
 'a1a5 e5d6 e3d4 d6c6 a5h5 c6b6 h5c5 b6a6 d4c4 a6b6 c5b5 b6c6 b5c5 c6d6 c4d4', 1100, '{endgame,mate}', 55),
('seed029','8/p4ppp/8/8/8/8/PP3PPP/8 w - - 0 1',
 'b2b4 g7g5 a2a4 h7h5 b4b5 a7a6 b5a6 g5g4', 1400, '{endgame,pawnEndgame,passedPawn}', 50),
('seed030','6k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1',
 'c1c8 g8h7 c8c7 h7g6 c7a7 g6f6 a7a6 f6e5 a6a5 e5e4 a5a4 e4e3 a4a3', 900, '{endgame,rookEndgame}', 65)

on conflict (id) do nothing;
