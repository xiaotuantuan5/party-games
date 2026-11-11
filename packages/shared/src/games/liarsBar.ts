/** joker 是万能牌，算作任何桌牌 */
export type LiarsBarRank = "K" | "Q" | "A" | "joker";
export type LiarsBarTableRank = Exclude<LiarsBarRank, "joker">;

export interface LiarsBarCard {
  id: number;
  rank: LiarsBarRank;
}

export const LIARS_BAR_RANKS: Record<LiarsBarRank, { label: string; emoji: string }> = {
  K: { label: "K", emoji: "👑" },
  Q: { label: "Q", emoji: "👸" },
  A: { label: "A", emoji: "🅰️" },
  joker: { label: "王", emoji: "🃏" },
};

export const LIARS_BAR_HAND_SIZE = 5;
export const LIARS_BAR_CHAMBERS = 6;
export const LIARS_BAR_MAX_PLAY = 3;

export type LiarsBarEventKind = "play" | "challenge" | "click" | "bang" | "round" | "leave";

/** text 中的 {target} 由前端替换成 targetId 对应的昵称 */
export interface LiarsBarLogEntry {
  /** 单局内递增，前端据此识别新事件并播放动画和音效 */
  seq: number;
  kind: LiarsBarEventKind;
  playerId: string;
  targetId?: string;
  count?: number;
  text: string;
}

export interface LiarsBarShowdown {
  /** 喊“骗子”的人 */
  callerId: string;
  /** 被质疑的人 */
  accusedId: string;
  /** 被翻开的牌，翻开后所有人可见 */
  cards: LiarsBarCard[];
  lie: boolean;
  /** 要开枪的人 */
  shooterId: string;
}

export interface LiarsBarView {
  gameId: "liarsBar";
  phase: "play" | "showdown" | "ended";
  round: number;
  tableRank: LiarsBarTableRank;
  order: string[];
  alive: string[];
  currentPlayerId: string;
  myHand: LiarsBarCard[];
  handCounts: Record<string, number>;
  /** 上一手：只公开谁出了几张，牌面朝下 */
  lastPlay: { playerId: string; count: number } | null;
  pileCount: number;
  /** 每个人已经扣过几次扳机。子弹位置只有服务端知道。 */
  pulls: Record<string, number>;
  /** 当前玩家只能喊骗子（其他人都没牌了，或自己没牌了） */
  mustChallenge: boolean;
  showdown: LiarsBarShowdown | null;
  log: LiarsBarLogEntry[];
  winnerId: string | null;
}

export type LiarsBarAction =
  | { gameId: "liarsBar"; type: "play"; cardIds: number[] }
  | { gameId: "liarsBar"; type: "challenge" }
  | { gameId: "liarsBar"; type: "pull" };
