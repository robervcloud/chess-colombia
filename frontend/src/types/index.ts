export type Country = 'CO' | string;

export interface Bot {
  id: string;
  name: string;
  eloApprox: number;
  avatar: string;
  description: string;
  playStyle: string;
  personality: string;
  gradient: [string, string];
}

export interface User {
  id: string;
  username: string;
  email?: string;
  country: Country;
  rating: number;
  games_played?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  created_at?: string;
}

export type Color = 'w' | 'b';

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  promotion: string | null;
  fen: string;
  ts: number;
}

export interface PlayerInfo {
  userId: string;
  username: string;
  connected: boolean;
}

export interface GameStatePayload {
  gameId: string;
  color: Color;
  white: PlayerInfo;
  black: PlayerInfo;
  fen: string;
  pgn: string;
  turn: Color;
  countryFilter: 'CO' | 'GLOBAL';
  timeControl: string;
  isGameOver: boolean;
  whiteMs?: number;
  blackMs?: number;
}

export interface GameEndPayload {
  gameId: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  termination: string;
  fen: string;
  pgn: string;
  whiteMs?: number;
  blackMs?: number;
}

export interface HistoryItem {
  id: string;
  white_id: string | null;
  black_id: string | null;
  white_username: string;
  black_username: string;
  result: string | null;
  status: string;
  termination: string | null;
  time_control: string;
  created_at: string;
  ended_at: string | null;
}
