import {
  BOMB_CAT_CARDS,
  BOMB_CAT_CAT_TYPES,
  GAMES,
  type BombCatAction,
  type BombCatCard,
  type BombCatCardType,
  type BombCatLogEntry,
  type BombCatView,
} from "@party/shared";
import { GameError, randomInt, shuffle, type GameEngine } from "./types.js";

type Pending =
  | { type: "favor"; fromId: string; toId: string }
  | { type: "defuse"; playerId: string; bomb: BombCatCard };

interface State {
  /** 下标 0 是牌堆顶 */
  deck: BombCatCard[];
  discard: BombCatCard[];
  hands: Record<string, BombCatCard[]>;
  seats: string[];
  alive: string[];
  currentId: string;
  turnsLeft: number;
  pending: Pending | null;
  /** 玩家用“预言”看到的牌，回合交给别人时清除 */
  futures: Record<string, BombCatCard[]>;
  log: BombCatLogEntry[];
  winnerId: string | null;
}

const HAND_SIZE = 7;
const EXTRA_DEFUSES = 2;
const LOG_LIMIT = 50;
/** 每 5 名玩家一套功能牌 */
const ACTION_CARDS: [BombCatCardType, number][] = [
  ["attack", 4],
  ["skip", 4],
  ["favor", 4],
  ["shuffle", 4],
  ["seeFuture", 5],
  ...BOMB_CAT_CAT_TYPES.map((t): [BombCatCardType, number] => [t, 4]),
];

const label = (t: BombCatCardType) => `${BOMB_CAT_CARDS[t].emoji}${BOMB_CAT_CARDS[t].name}`;
const isCat = (t: BombCatCardType) => (BOMB_CAT_CAT_TYPES as BombCatCardType[]).includes(t);

function log(s: State, entry: BombCatLogEntry): void {
  s.log.push(entry);
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

/** 座位顺序中 fromId 之后的下一位存活玩家（fromId 自己可能已出局） */
function nextAlive(s: State, fromId: string): string {
  const start = s.seats.indexOf(fromId);
  for (let i = 1; i <= s.seats.length; i++) {
    const id = s.seats[(start + i) % s.seats.length]!;
    if (s.alive.includes(id) && id !== fromId) return id;
  }
  return fromId;
}

function passTurn(s: State, turns: number): void {
  delete s.futures[s.currentId];
  s.currentId = nextAlive(s, s.currentId);
  s.turnsLeft = turns;
}

function endOneTurn(s: State): void {
  if (s.turnsLeft > 1) s.turnsLeft--;
  else passTurn(s, 1);
}

function eliminate(s: State, playerId: string): void {
  const wasCurrent = s.currentId === playerId;
  s.alive = s.alive.filter((id) => id !== playerId);
  s.discard.push(...(s.hands[playerId] ?? []));
  s.hands[playerId] = [];
  if (s.alive.length === 1) {
    s.winnerId = s.alive[0]!;
    s.pending = null;
    return;
  }
  if (wasCurrent) passTurn(s, 1);
}

function takeFromHand(s: State, playerId: string, cardIds: number[]): BombCatCard[] {
  const hand = s.hands[playerId]!;
  const cards = cardIds.map((id) => hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) throw new GameError("你没有这张牌");
  s.hands[playerId] = hand.filter((c) => !cardIds.includes(c.id));
  return cards as BombCatCard[];
}

function requireTarget(s: State, playerId: string, targetId: unknown): string {
  if (typeof targetId !== "string" || !s.alive.includes(targetId)) throw new GameError("请选择一位场上的玩家");
  if (targetId === playerId) throw new GameError("不能选择自己");
  if ((s.hands[targetId]?.length ?? 0) === 0) throw new GameError("对方没有手牌");
  return targetId;
}

function play(s: State, playerId: string, cardIds: unknown, targetId: unknown): void {
  if (
    !Array.isArray(cardIds) ||
    cardIds.length < 1 ||
    cardIds.length > 2 ||
    !cardIds.every((id) => Number.isInteger(id)) ||
    new Set(cardIds).size !== cardIds.length
  ) {
    throw new GameError("请选择一张功能牌，或两张相同的猫咪牌");
  }
  const hand = s.hands[playerId]!;
  const types = cardIds.map((id) => hand.find((c) => c.id === id)?.type);
  if (types.some((t) => !t)) throw new GameError("你没有这张牌");
  const type = types[0]!;

  if (cardIds.length === 2) {
    if (!isCat(type) || types[1] !== type) throw new GameError("只有两张相同的猫咪牌才能一起打出");
    const target = requireTarget(s, playerId, targetId);
    s.discard.push(...takeFromHand(s, playerId, cardIds));
    const targetHand = s.hands[target]!;
    const [stolen] = targetHand.splice(randomInt(0, targetHand.length - 1), 1);
    s.hands[playerId]!.push(stolen!);
    log(s, { playerId, targetId: target, text: `打出一对${label(type)}，从 {target} 手里抽走了一张牌` });
    return;
  }

  if (type === "defuse") throw new GameError("拆除牌会在摸到炸弹猫时自动使用");
  if (isCat(type)) throw new GameError("猫咪牌需要两张相同的一起打出");

  // 先校验目标，再弃牌
  const target = type === "favor" ? requireTarget(s, playerId, targetId) : null;
  s.discard.push(...takeFromHand(s, playerId, cardIds));

  switch (type) {
    case "attack": {
      const next = nextAlive(s, playerId);
      log(s, { playerId, targetId: next, text: `打出${label(type)}，{target} 要连续进行 2 个回合` });
      passTurn(s, 2);
      return;
    }
    case "skip":
      log(s, { playerId, text: `打出${label(type)}` });
      endOneTurn(s);
      return;
    case "shuffle":
      s.deck = shuffle(s.deck);
      s.futures = {};
      log(s, { playerId, text: `打出${label(type)}，牌堆被重新洗乱` });
      return;
    case "seeFuture":
      s.futures[playerId] = s.deck.slice(0, 3);
      log(s, { playerId, text: `打出${label(type)}，偷看了牌堆顶的牌` });
      return;
    case "favor":
      s.pending = { type: "favor", fromId: playerId, toId: target! };
      log(s, { playerId, targetId: target!, text: `打出${label(type)}，向 {target} 要一张牌` });
      return;
    default:
      throw new GameError("这张牌不能打出");
  }
}

function draw(s: State, playerId: string): void {
  const card = s.deck.shift();
  // 只要还有 2 人存活，牌堆里就至少有一只炸弹猫，正常不会摸空
  if (!card) throw new GameError("牌堆已经空了");
  if (s.futures[playerId]) s.futures[playerId] = s.futures[playerId]!.slice(1);

  if (card.type !== "bomb") {
    s.hands[playerId]!.push(card);
    log(s, { playerId, text: "摸了一张牌" });
    endOneTurn(s);
    return;
  }

  const hand = s.hands[playerId]!;
  const defuseIdx = hand.findIndex((c) => c.type === "defuse");
  if (defuseIdx >= 0) {
    s.discard.push(...hand.splice(defuseIdx, 1));
    s.pending = { type: "defuse", playerId, bomb: card };
    log(s, { playerId, text: `摸到了${label("bomb")}，用${label("defuse")}化解了！` });
    return;
  }

  s.discard.push(card);
  log(s, { playerId, text: `摸到了${label("bomb")}，💥 爆炸出局` });
  eliminate(s, playerId);
}

export const bombCat: GameEngine<State, BombCatAction, BombCatView> = {
  meta: GAMES.bombCat,

  setup(players) {
    const n = players.length;
    const sets = Math.ceil(n / 5);
    let nextId = 1;
    const make = (type: BombCatCardType): BombCatCard => ({ id: nextId++, type });

    const pool: BombCatCard[] = [];
    for (const [type, count] of ACTION_CARDS) {
      for (let i = 0; i < count * sets; i++) pool.push(make(type));
    }
    const shuffled = shuffle(pool);

    const seats = shuffle(players.map((p) => p.id));
    const hands: Record<string, BombCatCard[]> = {};
    for (const id of seats) hands[id] = [...shuffled.splice(0, HAND_SIZE), make("defuse")];

    const deck = [...shuffled];
    for (let i = 0; i < n - 1; i++) deck.push(make("bomb"));
    for (let i = 0; i < EXTRA_DEFUSES; i++) deck.push(make("defuse"));

    return {
      deck: shuffle(deck),
      discard: [],
      hands,
      seats,
      alive: [...seats],
      currentId: seats[0]!,
      turnsLeft: 1,
      pending: null,
      futures: {},
      log: [],
      winnerId: null,
    };
  },

  handleAction(s, playerId, action) {
    if (s.winnerId) throw new GameError("游戏已结束");
    if (!s.alive.includes(playerId)) throw new GameError("你已出局");
    const p = s.pending;

    if (action.type === "giveFavor") {
      if (p?.type !== "favor" || p.toId !== playerId) throw new GameError("现在不需要你给牌");
      const [card] = takeFromHand(s, playerId, [action.cardId]);
      s.hands[p.fromId]!.push(card!);
      s.pending = null;
      log(s, { playerId, targetId: p.fromId, text: "给了 {target} 一张牌" });
      return;
    }

    if (action.type === "placeBomb") {
      if (p?.type !== "defuse" || p.playerId !== playerId) throw new GameError("现在不需要放炸弹猫");
      const pos = action.position;
      if (!Number.isInteger(pos) || pos < 0 || pos > s.deck.length) throw new GameError("位置无效");
      s.deck.splice(pos, 0, p.bomb);
      s.pending = null;
      // 牌堆顺序变了，之前的预言不再准确
      s.futures = {};
      log(s, { playerId, text: `把${label("bomb")}悄悄放回了牌堆` });
      endOneTurn(s);
      return;
    }

    if (p) throw new GameError(p.type === "favor" ? "等待对方给牌…" : "等待对方放回炸弹猫…");
    if (s.currentId !== playerId) throw new GameError("还没轮到你");

    if (action.type === "draw") return draw(s, playerId);
    if (action.type === "play") return play(s, playerId, action.cardIds, action.targetId);
    throw new GameError("未知操作");
  },

  viewFor(s, playerId) {
    const pending = s.pending;
    return {
      gameId: "bombCat",
      phase: s.winnerId ? "ended" : "playing",
      order: s.seats,
      alive: s.alive,
      currentPlayerId: s.currentId,
      turnsLeft: s.turnsLeft,
      myHand: s.hands[playerId] ?? [],
      handCounts: Object.fromEntries(s.seats.map((id) => [id, s.hands[id]?.length ?? 0])),
      deckCount: s.deck.length,
      discardTop: s.discard.at(-1)?.type ?? null,
      // 不把待放回的炸弹牌对象发给客户端
      pending: !pending
        ? null
        : pending.type === "favor"
          ? pending
          : { type: "defuse", playerId: pending.playerId },
      future: s.futures[playerId]?.map((c) => c.type) ?? null,
      log: s.log.slice(-30),
      winnerId: s.winnerId,
    };
  },

  removePlayer(s, playerId) {
    if (s.winnerId || !s.alive.includes(playerId)) return true;
    const p = s.pending;
    if (p?.type === "favor" && (p.fromId === playerId || p.toId === playerId)) s.pending = null;
    if (p?.type === "defuse" && p.playerId === playerId) {
      s.discard.push(p.bomb);
      s.pending = null;
    }
    log(s, { playerId, text: "离开了游戏" });
    eliminate(s, playerId);
    return true;
  },
};
