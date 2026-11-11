export interface NumberBombView {
  gameId: "numberBomb";
  phase: "playing" | "ended";
  /** 当前安全范围（开区间端点，炸弹在 low 与 high 之间，不含两端） */
  low: number;
  high: number;
  order: string[];
  currentPlayerId: string;
  history: { playerId: string; guess: number }[];
  /** 仅在结束后公开 */
  bomb: number | null;
  loserId: string | null;
}

export type NumberBombAction = { gameId: "numberBomb"; type: "guess"; value: number };
