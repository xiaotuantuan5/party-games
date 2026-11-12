/**
 * 不上不下（原创）
 * 每人一张数字牌，写 3 个数字。结算时只看“在场数字”（本局发出去的牌）各被写了几次：
 * 自己的数字被写得最多或最少都算输。0 是特殊牌，一定会发出。
 */

/** 每张纸上写几个数字 */
export const MIDWAY_SHEET_SIZE = 3;
/** 指错几次直接失败 */
export const MIDWAY_MAX_STRIKES = 2;
/** 自由交流建议时长，到时间只是提醒，大家都点“结束讨论”才进入修改 */
export const MIDWAY_DISCUSS_MS = 5 * 60 * 1000;

export type MidwayPhase = "submit" | "discuss" | "modify" | "ended";

/** 最多 / 最少的数字（并列时都列出来）。所有在场数字次数一样时两项都为空 */
export interface MidwayExtremes {
  max: number[];
  min: number[];
}

export function midwayExtremes(counts: Record<number, number>): MidwayExtremes {
  const values = Object.values(counts);
  if (values.length === 0) return { max: [], min: [] };
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  if (hi === lo) return { max: [], min: [] };
  const digits = Object.keys(counts).map(Number).sort((a, b) => a - b);
  return { max: digits.filter((d) => counts[d] === hi), min: digits.filter((d) => counts[d] === lo) };
}

export interface MidwayAccusation {
  accuserId: string;
  targetId: string;
  guess: number;
  correct: boolean;
}

export type MidwayOutReason = "caught" | "strikes" | "leave";

/** 结算时 0 的情况 */
export type MidwayZeroCase = "nobody" | "unique" | "tie" | "middle";

export interface MidwayOutcome {
  won: boolean;
  reason: string;
}

export interface MidwayResult {
  /** 在场数字 → 最终被写的次数 */
  counts: Record<number, number>;
  extremes: MidwayExtremes;
  zeroCase: MidwayZeroCase;
  outcomes: Record<string, MidwayOutcome>;
}

export type MidwayEventKind = "announce" | "caught" | "miss" | "struckOut" | "zeroed" | "modify" | "leave" | "end";

export interface MidwayLogEntry {
  seq: number;
  kind: MidwayEventKind;
  /** text 中的 {players} 由前端替换成这些人的昵称 */
  playerIds?: string[];
  /** text 中的 {target} 由前端替换成这个人的昵称 */
  targetId?: string;
  text: string;
}

export interface MidwayView {
  gameId: "midway";
  phase: MidwayPhase;
  order: string[];
  myCard: number;
  /** 自己写的 3 个数字，还没交就是 null */
  mySheet: number[] | null;
  /** 本局一共发了几张牌（不公开是哪几张） */
  inPlayCount: number;
  /** 首轮交完后公布的最多 / 最少数字 */
  announce: MidwayExtremes | null;
  submittedIds: string[];
  /** 出局的人和原因 */
  out: Record<string, MidwayOutReason>;
  /** 公开的手牌（被指认出局的人） */
  revealedCards: Record<string, number>;
  /** 公开的纸条（指错的人、出局的人） */
  revealedSheets: Record<string, number[]>;
  strikes: Record<string, number>;
  accusations: MidwayAccusation[];
  /** 自己指对后还能问几次 */
  myQueriesLeft: number;
  /** 自己问到的结果 */
  myQueries: { digit: number; count: number }[];
  /** 有人指认 0 指错了，等被指认的人从指认者的数字里挑一个改成 0 */
  pendingZero: { accuserId: string; targetId: string } | null;
  /** 自由交流的建议截止时间（服务器时间戳） */
  discussEndsAt: number | null;
  readyIds: string[];
  /** 修改阶段已经确认的人 */
  modifiedIds: string[];
  log: MidwayLogEntry[];
  result: MidwayResult | null;
  /** 结束后公开所有人的手牌和纸条 */
  reveal: { cards: Record<string, number>; sheets: Record<string, number[]> } | null;
}

export type MidwayAction =
  | { gameId: "midway"; type: "submit"; numbers: number[] }
  | { gameId: "midway"; type: "accuse"; targetId: string; digit: number }
  /** 指对后询问某个数字现在一共被写了几次 */
  | { gameId: "midway"; type: "query"; digit: number }
  /** 被误指为 0 的人：把指认者纸上第 index 个数字改成 0 */
  | { gameId: "midway"; type: "zeroPick"; index: number }
  | { gameId: "midway"; type: "ready"; ready: boolean }
  /** index 为 null 表示不改 */
  | { gameId: "midway"; type: "modify"; index: number | null; digit?: number };
