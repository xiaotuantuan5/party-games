export type UnoColor = "red" | "yellow" | "green" | "blue";
export type UnoValue =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "skip"
  | "reverse"
  | "draw2"
  | "wild"
  | "wild4";

export interface UnoCard {
  id: number;
  /** 万能牌没有颜色 */
  color: UnoColor | null;
  value: UnoValue;
}

export const UNO_COLORS: UnoColor[] = ["red", "yellow", "green", "blue"];

export const UNO_COLOR_INFO: Record<UnoColor, { name: string; hex: string }> = {
  red: { name: "红", hex: "#e8333a" },
  yellow: { name: "黄", hex: "#f5c400" },
  green: { name: "绿", hex: "#3aa845" },
  blue: { name: "蓝", hex: "#1f6fd1" },
};

/** 牌面上显示的符号和名称 */
export const UNO_VALUE_INFO: Record<UnoValue, { symbol: string; name: string }> = {
  "0": { symbol: "0", name: "0" },
  "1": { symbol: "1", name: "1" },
  "2": { symbol: "2", name: "2" },
  "3": { symbol: "3", name: "3" },
  "4": { symbol: "4", name: "4" },
  "5": { symbol: "5", name: "5" },
  "6": { symbol: "6", name: "6" },
  "7": { symbol: "7", name: "7" },
  "8": { symbol: "8", name: "8" },
  "9": { symbol: "9", name: "9" },
  skip: { symbol: "⊘", name: "禁止" },
  reverse: { symbol: "⇄", name: "反转" },
  draw2: { symbol: "+2", name: "+2" },
  wild: { symbol: "★", name: "变色" },
  wild4: { symbol: "+4", name: "变色+4" },
};

export const UNO_HAND_SIZE = 7;

export const isUnoWild = (v: UnoValue) => v === "wild" || v === "wild4";

/** 这张牌能不能接在当前桌面上：同色、同数字 / 同符号，或者万能牌 */
export function unoCanPlay(card: UnoCard, top: UnoCard, currentColor: UnoColor): boolean {
  if (isUnoWild(card.value)) return true;
  return card.color === currentColor || card.value === top.value;
}

export function unoCardName(card: Pick<UnoCard, "color" | "value">): string {
  const v = UNO_VALUE_INFO[card.value].name;
  return card.color ? `${UNO_COLOR_INFO[card.color].name}${v}` : v;
}

export type UnoEventKind =
  | "play"
  | "draw"
  | "pass"
  /** 被 +2 / +4 罚摸 */
  | "penalty"
  | "skipped"
  | "reverse"
  | "uno"
  /** 有人抓到别人剩 1 张没喊 UNO */
  | "caught"
  | "reshuffle"
  | "leave";

/** text 中的 {target} 由前端替换成 targetId 对应的昵称 */
export interface UnoLogEntry {
  /** 单局内递增，前端据此识别新事件并播放动画和音效 */
  seq: number;
  kind: UnoEventKind;
  playerId: string;
  targetId?: string;
  card?: UnoCard;
  count?: number;
  text: string;
}

export interface UnoView {
  gameId: "uno";
  phase: "playing" | "ended";
  order: string[];
  currentPlayerId: string;
  /** 1 为座位顺序，-1 为反向 */
  direction: 1 | -1;
  myHand: UnoCard[];
  handCounts: Record<string, number>;
  deckCount: number;
  topCard: UnoCard;
  /** 当前要跟的颜色（万能牌打出后由出牌人指定） */
  currentColor: UnoColor;
  /** 当前玩家摸了一张能出的牌，正在决定出不出。只有摸牌人能看到是哪张。 */
  drawnCardId: number | null;
  awaitingDrawDecision: boolean;
  /** 已经喊过 UNO 的玩家（手里剩 1 张） */
  unoSafe: string[];
  /** 剩 1 张却没喊 UNO、可以被抓的玩家 */
  unoCatchable: string[];
  log: UnoLogEntry[];
  winnerId: string | null;
}

export type UnoAction =
  /** color：打出万能牌时指定的颜色。uno：出倒数第二张牌时顺便喊 UNO */
  | { gameId: "uno"; type: "play"; cardId: number; color?: UnoColor; uno?: boolean }
  | { gameId: "uno"; type: "draw" }
  /** 摸到能出的牌但选择不出 */
  | { gameId: "uno"; type: "pass" }
  /** 剩 1 张时补喊 UNO */
  | { gameId: "uno"; type: "callUno" }
  /** 抓没喊 UNO 的人，他罚摸 2 张 */
  | { gameId: "uno"; type: "catch"; targetId: string };
