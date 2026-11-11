import {
  GAMES,
  LIARS_BAR_CHAMBERS,
  LIARS_BAR_HAND_SIZE,
  LIARS_BAR_MAX_PLAY,
  LIARS_BAR_RANKS,
  type LiarsBarAction,
  type LiarsBarCard,
  type LiarsBarLogEntry,
  type LiarsBarShowdown,
  type LiarsBarTableRank,
  type LiarsBarView,
} from "@party/shared";
import { GameError, randomInt, shuffle, type GameEngine } from "./types.js";

interface State {
  seats: string[];
  alive: string[];
  hands: Record<string, LiarsBarCard[]>;
  tableRank: LiarsBarTableRank;
  round: number;
  currentId: string;
  lastPlay: { playerId: string; cards: LiarsBarCard[] } | null;
  pile: LiarsBarCard[];
  /** bullet：子弹在第几发（0~5），pulls：已经扣过几次。子弹位置不下发给客户端。 */
  guns: Record<string, { bullet: number; pulls: number }>;
  phase: "play" | "showdown" | "ended";
  showdown: LiarsBarShowdown | null;
  log: LiarsBarLogEntry[];
  seq: number;
  winnerId: string | null;
  /** 每轮重新发牌时卡牌 id 继续递增，避免前端把新牌当成旧牌 */
  nextCardId: number;
}

const TABLE_RANKS: LiarsBarTableRank[] = ["K", "Q", "A"];
const LOG_LIMIT = 50;

const rankLabel = (r: LiarsBarTableRank) => `${LIARS_BAR_RANKS[r].emoji}${LIARS_BAR_RANKS[r].label}`;

function log(s: State, entry: Omit<LiarsBarLogEntry, "seq">): void {
  s.log.push({ ...entry, seq: ++s.seq });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

/** 牌堆大小随人数变化：4 人及以下是经典的 6K 6Q 6A 2王，更多人时加牌，保证每人 5 张 */
function buildDeck(s: State, players: number): LiarsBarCard[] {
  const perRank = players <= 4 ? 6 : 9;
  const jokers = players <= 4 ? 2 : 3;
  const deck: LiarsBarCard[] = [];
  for (const rank of TABLE_RANKS) for (let i = 0; i < perRank; i++) deck.push({ id: s.nextCardId++, rank });
  for (let i = 0; i < jokers; i++) deck.push({ id: s.nextCardId++, rank: "joker" });
  return shuffle(deck);
}

function nextAliveAfter(s: State, fromId: string): string {
  const start = s.seats.indexOf(fromId);
  for (let i = 1; i <= s.seats.length; i++) {
    const id = s.seats[(start + i) % s.seats.length]!;
    if (s.alive.includes(id) && id !== fromId) return id;
  }
  return fromId;
}

/** 下一位有牌的存活玩家；如果其他人都没牌了，就轮到下一位存活玩家（他只能喊骗子） */
function nextTurn(s: State, fromId: string): string {
  const start = s.seats.indexOf(fromId);
  for (let i = 1; i <= s.seats.length; i++) {
    const id = s.seats[(start + i) % s.seats.length]!;
    if (id !== fromId && s.alive.includes(id) && (s.hands[id]?.length ?? 0) > 0) return id;
  }
  return nextAliveAfter(s, fromId);
}

function mustChallenge(s: State, playerId: string): boolean {
  if (!s.lastPlay) return false;
  if ((s.hands[playerId]?.length ?? 0) === 0) return true;
  // 只有自己还有牌：再出牌也没人能质疑，只能喊骗子
  return s.alive.every((id) => id === playerId || (s.hands[id]?.length ?? 0) === 0);
}

function startRound(s: State, starterId: string): void {
  s.round++;
  s.tableRank = TABLE_RANKS[randomInt(0, TABLE_RANKS.length - 1)]!;
  const deck = buildDeck(s, s.alive.length);
  s.hands = {};
  for (const id of s.seats) s.hands[id] = s.alive.includes(id) ? deck.splice(0, LIARS_BAR_HAND_SIZE) : [];
  s.lastPlay = null;
  s.pile = [];
  s.showdown = null;
  s.phase = "play";
  s.currentId = s.alive.includes(starterId) ? starterId : nextAliveAfter(s, starterId);
  log(s, {
    kind: "round",
    playerId: s.currentId,
    text: `先出牌 · 第 ${s.round} 轮，桌牌是 ${rankLabel(s.tableRank)}`,
  });
}

function eliminate(s: State, playerId: string): boolean {
  s.alive = s.alive.filter((id) => id !== playerId);
  s.hands[playerId] = [];
  if (s.alive.length === 1) {
    s.winnerId = s.alive[0]!;
    s.phase = "ended";
    s.showdown = null;
    return true;
  }
  return false;
}

export const liarsBar: GameEngine<State, LiarsBarAction, LiarsBarView> = {
  meta: GAMES.liarsBar,

  setup(players) {
    const seats = shuffle(players.map((p) => p.id));
    const guns: State["guns"] = {};
    for (const id of seats) guns[id] = { bullet: randomInt(0, LIARS_BAR_CHAMBERS - 1), pulls: 0 };
    const s: State = {
      seats,
      alive: [...seats],
      hands: {},
      tableRank: "K",
      round: 0,
      currentId: seats[0]!,
      lastPlay: null,
      pile: [],
      guns,
      phase: "play",
      showdown: null,
      log: [],
      seq: 0,
      winnerId: null,
      nextCardId: 1,
    };
    startRound(s, seats[0]!);
    return s;
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("游戏已结束");
    if (!s.alive.includes(playerId)) throw new GameError("你已出局");

    if (action.type === "pull") {
      if (s.phase !== "showdown" || s.showdown?.shooterId !== playerId) throw new GameError("现在不需要你开枪");
      const gun = s.guns[playerId]!;
      const died = gun.pulls === gun.bullet;
      gun.pulls++;
      if (died) {
        log(s, { kind: "bang", playerId, count: gun.pulls, text: "💥 砰！中弹出局" });
        if (eliminate(s, playerId)) return;
        startRound(s, nextAliveAfter(s, playerId));
      } else {
        log(s, { kind: "click", playerId, count: gun.pulls, text: `咔嗒……空枪，活了下来（已扣 ${gun.pulls} 次）` });
        startRound(s, playerId);
      }
      return;
    }

    if (s.phase === "showdown") throw new GameError("等待开枪…");
    if (s.currentId !== playerId) throw new GameError("还没轮到你");

    if (action.type === "challenge") {
      const last = s.lastPlay;
      if (!last) throw new GameError("还没有人出牌，不能喊骗子");
      const lie = last.cards.some((c) => c.rank !== s.tableRank && c.rank !== "joker");
      const shooterId = lie ? last.playerId : playerId;
      s.showdown = { callerId: playerId, accusedId: last.playerId, cards: last.cards, lie, shooterId };
      s.phase = "showdown";
      log(s, {
        kind: "challenge",
        playerId,
        targetId: last.playerId,
        text: lie ? "喊 {target} 是骗子——抓到了！" : "喊 {target} 是骗子——喊错了！",
      });
      return;
    }

    if (action.type === "play") {
      if (mustChallenge(s, playerId)) throw new GameError("其他人都没牌了，你只能喊骗子");
      const ids = action.cardIds;
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > LIARS_BAR_MAX_PLAY ||
        !ids.every((id) => Number.isInteger(id)) ||
        new Set(ids).size !== ids.length
      ) {
        throw new GameError(`一次出 1~${LIARS_BAR_MAX_PLAY} 张牌`);
      }
      const hand = s.hands[playerId]!;
      const cards = ids.map((id) => hand.find((c) => c.id === id));
      if (cards.some((c) => !c)) throw new GameError("你没有这张牌");
      s.hands[playerId] = hand.filter((c) => !ids.includes(c.id));
      s.pile.push(...(cards as LiarsBarCard[]));
      s.lastPlay = { playerId, cards: cards as LiarsBarCard[] };
      log(s, { kind: "play", playerId, count: ids.length, text: `打出 ${ids.length} 张，声称都是 ${rankLabel(s.tableRank)}` });
      s.currentId = nextTurn(s, playerId);
      return;
    }

    throw new GameError("未知操作");
  },

  viewFor(s, playerId) {
    return {
      gameId: "liarsBar",
      phase: s.phase,
      round: s.round,
      tableRank: s.tableRank,
      order: s.seats,
      alive: s.alive,
      currentPlayerId: s.currentId,
      myHand: s.hands[playerId] ?? [],
      handCounts: Object.fromEntries(s.seats.map((id) => [id, s.hands[id]?.length ?? 0])),
      lastPlay: s.lastPlay ? { playerId: s.lastPlay.playerId, count: s.lastPlay.cards.length } : null,
      pileCount: s.pile.length,
      pulls: Object.fromEntries(s.seats.map((id) => [id, s.guns[id]!.pulls])),
      mustChallenge: s.phase === "play" && s.currentId === playerId && mustChallenge(s, playerId),
      showdown: s.showdown,
      log: s.log.slice(-30),
      winnerId: s.winnerId,
    };
  },

  removePlayer(s, playerId) {
    if (s.phase === "ended" || !s.alive.includes(playerId)) return true;
    log(s, { kind: "leave", playerId, text: "离开了酒馆" });
    if (eliminate(s, playerId)) return true;
    // 有人离开后重新开一轮，避免出现“上一手是离开者”之类的残局
    startRound(s, s.currentId === playerId || s.showdown ? nextAliveAfter(s, playerId) : s.currentId);
    return true;
  },
};
