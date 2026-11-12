/** 德州扑克（无限注）。牌型计算放在共享包里，服务端用来比牌，前端用来提示“你现在是什么牌”。 */

export type PokerSuit = "s" | "h" | "d" | "c";

export interface PokerCard {
  /** 单局内唯一，前端用来播放发牌动画 */
  id: number;
  /** 2~14，11=J 12=Q 13=K 14=A */
  rank: number;
  suit: PokerSuit;
}

export const POKER_SUITS: Record<PokerSuit, { symbol: string; red: boolean }> = {
  s: { symbol: "♠", red: false },
  h: { symbol: "♥", red: true },
  d: { symbol: "♦", red: true },
  c: { symbol: "♣", red: false },
};

export function pokerRankLabel(rank: number): string {
  return rank <= 10 ? String(rank) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank]!;
}

export const HOLDEM_START_CHIPS = 1000;
/** 盲注级别（小盲 / 大盲），每 HOLDEM_HANDS_PER_LEVEL 手升一级，保证一局能打完 */
export const HOLDEM_BLINDS: [number, number][] = [
  [10, 20],
  [15, 30],
  [25, 50],
  [50, 100],
  [75, 150],
  [100, 200],
  [150, 300],
  [200, 400],
  [300, 600],
  [500, 1000],
];
export const HOLDEM_HANDS_PER_LEVEL = 5;
/** 每次行动的思考时间，超时自动过牌（不能过牌就弃牌） */
export const HOLDEM_TURN_SECONDS = 40;
/** 一手牌结束后亮牌展示多久再发下一手 */
export const HOLDEM_RESULT_SECONDS = 7;

/** 牌型从小到大 */
export const HAND_CATEGORIES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺", "皇家同花顺"] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number];

export interface HandValue {
  /** HAND_CATEGORIES 的下标 */
  category: number;
  name: HandCategory;
  /** 用于比较：[牌型, 关键牌点数…]，逐位比大小 */
  score: number[];
  /** 组成牌型的 5 张牌 */
  best: PokerCard[];
}

export function compareHands(a: HandValue, b: HandValue): number {
  for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
    const d = (a.score[i] ?? 0) - (b.score[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 5 张牌的牌型 */
function evaluate5(cards: PokerCard[]): HandValue {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const flush = sorted.every((c) => c.suit === sorted[0]!.suit);
  const ranks = sorted.map((c) => c.rank);
  const unique = [...new Set(ranks)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (ranks[0]! - ranks[4]! === 4) straightHigh = ranks[0]!;
    // A-2-3-4-5，A 当 1
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5;
  }

  // 按“张数多的在前，点数大的在前”分组
  const groups = unique
    .map((r) => ({ r, n: ranks.filter((x) => x === r).length }))
    .sort((a, b) => b.n - a.n || b.r - a.r);
  const kickers = groups.map((g) => g.r);

  let category: number;
  let score: number[];
  if (straightHigh && flush) {
    category = straightHigh === 14 ? 9 : 8;
    score = [straightHigh];
  } else if (groups[0]!.n === 4) {
    category = 7;
    score = kickers;
  } else if (groups[0]!.n === 3 && groups[1]!.n === 2) {
    category = 6;
    score = kickers;
  } else if (flush) {
    category = 5;
    score = ranks;
  } else if (straightHigh) {
    category = 4;
    score = [straightHigh];
  } else if (groups[0]!.n === 3) {
    category = 3;
    score = kickers;
  } else if (groups[0]!.n === 2 && groups[1]!.n === 2) {
    category = 2;
    score = kickers;
  } else if (groups[0]!.n === 2) {
    category = 1;
    score = kickers;
  } else {
    category = 0;
    score = ranks;
  }
  // 皇家同花顺也按同花顺比较，只是名字不同
  const cmpCategory = category === 9 ? 8 : category;
  return { category, name: HAND_CATEGORIES[category]!, score: [cmpCategory, ...score], best: sorted };
}

/** 从 5~7 张牌里挑出最大的 5 张 */
export function bestHand(cards: PokerCard[]): HandValue | null {
  if (cards.length < 5) return null;
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || compareHands(v, best) > 0) best = v;
          }
  return best;
}

/** 翻牌前只有两张手牌时的简单描述 */
export function describeHole(cards: PokerCard[]): string {
  if (cards.length !== 2) return "";
  const [a, b] = cards as [PokerCard, PokerCard];
  if (a.rank === b.rank) return `口袋对 ${pokerRankLabel(a.rank)}`;
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  return `${pokerRankLabel(hi)}${pokerRankLabel(lo)}${a.suit === b.suit ? " 同花" : ""}`;
}

export type HoldemStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

export const HOLDEM_STREET_LABEL: Record<HoldemStreet, string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "摊牌",
};

export interface HoldemSeat {
  id: string;
  chips: number;
  /** 本轮下注圈已经下的注 */
  bet: number;
  /** 本手一共投入的筹码 */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** 筹码输光出局（或离开房间），不再发牌 */
  out: boolean;
  /** 本手最后一次操作，显示在座位上 */
  lastAction: string | null;
  /** 摊牌时公开的手牌，其他时候只有自己能看到（在 myCards 里） */
  shownCards: PokerCard[] | null;
  /** 摊牌时的牌型 */
  handName: string | null;
}

export interface HoldemPotResult {
  amount: number;
  winners: string[];
  /** 赢下这个池的牌型，所有人弃牌时为 null */
  handName: string | null;
}

export interface HoldemHandResult {
  pots: HoldemPotResult[];
  /** 本手每个人净赢 / 输多少 */
  net: Record<string, number>;
  /** 所有人弃牌，没有摊牌 */
  uncontested: boolean;
  /** 赢家组成牌型的 5 张牌 id，用来高亮 */
  winningCardIds: number[];
}

export type HoldemEventKind = "hand" | "fold" | "check" | "call" | "raise" | "allin" | "blind" | "street" | "win" | "timeout" | "leave" | "bust";

export interface HoldemLogEntry {
  seq: number;
  kind: HoldemEventKind;
  playerId: string;
  text: string;
}

export interface HoldemView {
  gameId: "holdem";
  phase: "betting" | "result" | "ended";
  handNo: number;
  street: HoldemStreet;
  /** 座位顺序（不含已离开房间的人） */
  seats: HoldemSeat[];
  dealerId: string;
  sbId: string;
  bbId: string;
  smallBlind: number;
  bigBlind: number;
  /** 再打几手升盲 */
  handsToNextLevel: number;
  board: PokerCard[];
  /** 底池（包括本轮还在桌面上的下注） */
  pot: number;
  /** 当前下注圈的最高注 */
  currentBet: number;
  /** 加注时最少要加到多少 */
  minRaiseTo: number;
  /** 轮到谁，没有人需要行动时为 null */
  turnId: string | null;
  /** 当前行动者还剩几秒（收到视图时的值，前端自己倒计时） */
  turnSecondsLeft: number;
  /** 本手结束后多久发下一手 */
  nextHandIn: number;
  myCards: PokerCard[];
  /** 轮到我时能做的操作 */
  canCheck: boolean;
  callAmount: number;
  canRaise: boolean;
  /** 我最多能加到多少（全下） */
  maxRaiseTo: number;
  result: HoldemHandResult | null;
  log: HoldemLogEntry[];
  winnerId: string | null;
}

export type HoldemAction =
  | { gameId: "holdem"; type: "fold" }
  | { gameId: "holdem"; type: "check" }
  | { gameId: "holdem"; type: "call" }
  /** to：本轮下注圈加到多少（不是额外加多少） */
  | { gameId: "holdem"; type: "raise"; to: number }
  | { gameId: "holdem"; type: "allin" };
