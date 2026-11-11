export type UndercoverRole = "civilian" | "undercover";

export interface UndercoverView {
  gameId: "undercover";
  phase: "describe" | "vote" | "ended";
  round: number;
  /** 自己的词。玩家不知道自己是不是卧底。 */
  myWord: string;
  alive: string[];
  /** 本轮描述顺序与当前描述者 */
  order: string[];
  currentSpeakerId: string | null;
  /** 所有轮次的描述，按轮次分组 */
  descriptions: { round: number; playerId: string; text: string }[];
  /** 投票阶段：已投票的玩家（不公开投给谁） */
  votedPlayerIds: string[];
  /** 每轮结果。votes 在该轮结束后公开。 */
  results: { round: number; eliminatedId: string | null; votes: Record<string, string> }[];
  winner: UndercoverRole | null;
  /** 结束后公开所有身份和词 */
  reveal: { roles: Record<string, UndercoverRole>; civilianWord: string; undercoverWord: string } | null;
}

export type UndercoverAction =
  | { gameId: "undercover"; type: "describe"; text: string }
  | { gameId: "undercover"; type: "vote"; targetId: string };

export const UNDERCOVER_MAX_DESCRIPTION = 30;
