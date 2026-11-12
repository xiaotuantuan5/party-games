import {
  GAMES,
  UNO_COLORS,
  UNO_COLOR_INFO,
  UNO_HAND_SIZE,
  isUnoWild,
  unoCanPlay,
  unoCardName,
  type UnoAction,
  type UnoCard,
  type UnoColor,
  type UnoLogEntry,
  type UnoValue,
  type UnoView,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface State {
  /** 末尾是牌堆顶 */
  deck: UnoCard[];
  /** 末尾是桌面上的牌 */
  discard: UnoCard[];
  hands: Record<string, UnoCard[]>;
  seats: string[];
  direction: 1 | -1;
  currentId: string;
  currentColor: UnoColor;
  /** 当前玩家摸到了一张能出的牌，等他决定出不出 */
  drawn: { playerId: string; cardId: number } | null;
  /** 剩 1 张并且喊过 UNO */
  unoSafe: string[];
  /** 剩 1 张没喊 UNO，在下一个人行动前都可以被抓 */
  catchable: string[];
  log: UnoLogEntry[];
  seq: number;
  winnerId: string | null;
}

const LOG_LIMIT = 50;
const CATCH_PENALTY = 2;
const NUMBER_VALUES: UnoValue[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function buildDeck(): UnoCard[] {
  let nextId = 1;
  const cards: UnoCard[] = [];
  const add = (color: UnoColor | null, value: UnoValue, count: number) => {
    for (let i = 0; i < count; i++) cards.push({ id: nextId++, color, value });
  };
  for (const color of UNO_COLORS) {
    add(color, "0", 1);
    for (const v of NUMBER_VALUES.slice(1)) add(color, v, 2);
    add(color, "skip", 2);
    add(color, "reverse", 2);
    add(color, "draw2", 2);
  }
  add(null, "wild", 4);
  add(null, "wild4", 4);
  return shuffle(cards); // 108 张
}

function log(s: State, entry: Omit<UnoLogEntry, "seq">): void {
  s.log.push({ ...entry, seq: ++s.seq });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function nextFrom(s: State, id: string, steps = 1): string {
  const n = s.seats.length;
  const i = s.seats.indexOf(id);
  return s.seats[(((i + s.direction * steps) % n) + n) % n]!;
}

/** 手牌数量变了以后同步 UNO 状态：不是 1 张就既不安全也不能被抓 */
function syncUno(s: State, playerId: string): void {
  if (s.hands[playerId]?.length === 1) return;
  s.unoSafe = s.unoSafe.filter((id) => id !== playerId);
  s.catchable = s.catchable.filter((id) => id !== playerId);
}

/** 牌堆摸空时，把桌面以外的弃牌洗回牌堆 */
function refill(s: State): boolean {
  if (s.deck.length > 0) return true;
  if (s.discard.length <= 1) return false;
  const top = s.discard.pop()!;
  s.deck = shuffle(s.discard);
  s.discard = [top];
  log(s, { kind: "reshuffle", playerId: s.currentId, text: "牌堆摸完了，把弃牌洗回牌堆" });
  return true;
}

function drawCards(s: State, playerId: string, n: number): UnoCard[] {
  const got: UnoCard[] = [];
  for (let i = 0; i < n && refill(s); i++) got.push(s.deck.pop()!);
  s.hands[playerId]!.push(...got);
  syncUno(s, playerId);
  return got;
}

/** 出牌后结算功能牌效果并把回合交给下一位 */
function applyEffect(s: State, playerId: string, card: UnoCard): void {
  const next = nextFrom(s, playerId);
  switch (card.value) {
    case "skip":
      log(s, { kind: "skipped", playerId, targetId: next, text: "被禁止了，跳过这回合" });
      s.currentId = nextFrom(s, playerId, 2);
      return;
    case "reverse":
      if (s.seats.length === 2) {
        log(s, { kind: "skipped", playerId, targetId: next, text: "被反转跳过了这回合" });
        s.currentId = playerId;
        return;
      }
      s.direction = s.direction === 1 ? -1 : 1;
      log(s, { kind: "reverse", playerId, text: "反转了出牌方向" });
      s.currentId = nextFrom(s, playerId);
      return;
    case "draw2":
    case "wild4": {
      const n = card.value === "draw2" ? 2 : 4;
      const got = drawCards(s, next, n);
      log(s, { kind: "penalty", playerId, targetId: next, count: got.length, text: `让 {target} 摸了 ${got.length} 张牌并跳过回合` });
      s.currentId = nextFrom(s, playerId, 2);
      return;
    }
    default:
      s.currentId = next;
  }
}

function play(s: State, playerId: string, action: Extract<UnoAction, { type: "play" }>): void {
  if (s.drawn && action.cardId !== s.drawn.cardId) throw new GameError("只能打出刚摸到的那张牌，或者选择不出");
  const hand = s.hands[playerId]!;
  const idx = hand.findIndex((c) => c.id === action.cardId);
  if (idx < 0) throw new GameError("你没有这张牌");
  const card = hand[idx]!;
  const top = s.discard.at(-1)!;
  if (!unoCanPlay(card, top, s.currentColor)) throw new GameError("这张牌接不上：要同颜色、同数字或同符号");

  let color: UnoColor;
  if (isUnoWild(card.value)) {
    if (typeof action.color !== "string" || !UNO_COLORS.includes(action.color)) throw new GameError("请选择一个颜色");
    color = action.color;
  } else {
    color = card.color!;
  }

  hand.splice(idx, 1);
  s.discard.push(card);
  s.currentColor = color;
  s.drawn = null;
  const colorText = isUnoWild(card.value) ? `，指定${UNO_COLOR_INFO[color].name}色` : "";
  log(s, { kind: "play", playerId, card, text: `打出 ${unoCardName(card)}${colorText}` });

  if (hand.length === 0) {
    s.winnerId = playerId;
    syncUno(s, playerId);
    return;
  }
  if (hand.length === 1) {
    if (action.uno === true) {
      s.unoSafe.push(playerId);
      log(s, { kind: "uno", playerId, text: "喊了 UNO！" });
    } else {
      s.catchable.push(playerId);
    }
  }
  applyEffect(s, playerId, card);
}

function draw(s: State, playerId: string): void {
  if (s.drawn) throw new GameError("你已经摸过牌了，出这张牌或者选择不出");
  const [card] = drawCards(s, playerId, 1);
  if (!card) {
    log(s, { kind: "pass", playerId, text: "没牌可摸，跳过" });
    s.currentId = nextFrom(s, playerId);
    return;
  }
  if (unoCanPlay(card, s.discard.at(-1)!, s.currentColor)) {
    s.drawn = { playerId, cardId: card.id };
    log(s, { kind: "draw", playerId, count: 1, text: "摸了一张牌" });
    return;
  }
  log(s, { kind: "draw", playerId, count: 1, text: "摸了一张牌，出不了，轮到下家" });
  s.currentId = nextFrom(s, playerId);
}

export const uno: GameEngine<State, UnoAction, UnoView> = {
  meta: GAMES.uno,

  setup(players) {
    const deck = buildDeck();
    const seats = shuffle(players.map((p) => p.id));
    const hands: Record<string, UnoCard[]> = {};
    for (const id of seats) hands[id] = deck.splice(-UNO_HAND_SIZE);

    // 起始牌用数字牌，避免开局就要结算功能牌
    let startIdx = deck.length - 1;
    while (!NUMBER_VALUES.includes(deck[startIdx]!.value)) startIdx--;
    const [start] = deck.splice(startIdx, 1);

    return {
      deck,
      discard: [start!],
      hands,
      seats,
      direction: 1,
      currentId: seats[0]!,
      currentColor: start!.color!,
      drawn: null,
      unoSafe: [],
      catchable: [],
      log: [],
      seq: 0,
      winnerId: null,
    };
  },

  handleAction(s, playerId, action) {
    if (s.winnerId) throw new GameError("游戏已结束");
    if (!s.seats.includes(playerId)) throw new GameError("你不在这局游戏里");

    // 抓 UNO 和补喊 UNO 不需要轮到自己
    if (action.type === "callUno") {
      if (!s.catchable.includes(playerId)) throw new GameError("现在不需要喊 UNO");
      s.catchable = s.catchable.filter((id) => id !== playerId);
      s.unoSafe.push(playerId);
      log(s, { kind: "uno", playerId, text: "补喊了 UNO！" });
      return;
    }
    if (action.type === "catch") {
      const target = action.targetId;
      if (typeof target !== "string" || !s.catchable.includes(target)) throw new GameError("抓晚了，对方已经安全了");
      if (target === playerId) throw new GameError("不能抓自己，点“UNO!”补喊吧");
      s.catchable = s.catchable.filter((id) => id !== target);
      const got = drawCards(s, target, CATCH_PENALTY);
      log(s, { kind: "caught", playerId, targetId: target, count: got.length, text: `抓到 {target} 没喊 UNO，罚摸 ${got.length} 张` });
      return;
    }

    if (s.currentId !== playerId) throw new GameError("还没轮到你");
    // 下一位玩家开始行动，上一位没喊 UNO 的就安全了
    s.catchable = [];

    switch (action.type) {
      case "play":
        return play(s, playerId, action);
      case "draw":
        return draw(s, playerId);
      case "pass":
        if (!s.drawn) throw new GameError("先摸一张牌，或者出一张牌");
        s.drawn = null;
        log(s, { kind: "pass", playerId, text: "摸到的牌没出，轮到下家" });
        s.currentId = nextFrom(s, playerId);
        return;
      default:
        throw new GameError("未知操作");
    }
  },

  viewFor(s, playerId) {
    return {
      gameId: "uno",
      phase: s.winnerId ? "ended" : "playing",
      order: s.seats,
      currentPlayerId: s.currentId,
      direction: s.direction,
      myHand: s.hands[playerId] ?? [],
      handCounts: Object.fromEntries(s.seats.map((id) => [id, s.hands[id]?.length ?? 0])),
      deckCount: s.deck.length,
      topCard: s.discard.at(-1)!,
      currentColor: s.currentColor,
      drawnCardId: s.drawn?.playerId === playerId ? s.drawn.cardId : null,
      awaitingDrawDecision: s.drawn !== null,
      unoSafe: s.unoSafe,
      unoCatchable: s.catchable,
      log: s.log.slice(-30),
      winnerId: s.winnerId,
    };
  },

  removePlayer(s, playerId) {
    if (s.winnerId || !s.seats.includes(playerId)) return true;
    const wasCurrent = s.currentId === playerId;
    const next = nextFrom(s, playerId);

    s.deck = shuffle([...s.deck, ...(s.hands[playerId] ?? [])]);
    delete s.hands[playerId];
    s.seats = s.seats.filter((id) => id !== playerId);
    s.unoSafe = s.unoSafe.filter((id) => id !== playerId);
    s.catchable = s.catchable.filter((id) => id !== playerId);
    log(s, { kind: "leave", playerId, text: "离开了游戏，手牌洗回了牌堆" });

    if (s.seats.length === 0) return false;
    if (wasCurrent) {
      s.drawn = null;
      s.currentId = next;
    }
    if (s.seats.length === 1) s.winnerId = s.seats[0]!;
    return true;
  },
};
