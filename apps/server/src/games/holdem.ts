import {
  GAMES,
  HOLDEM_BLINDS,
  HOLDEM_HANDS_PER_LEVEL,
  HOLDEM_RESULT_SECONDS,
  HOLDEM_START_CHIPS,
  HOLDEM_STREET_LABEL,
  HOLDEM_TURN_SECONDS,
  bestHand,
  compareHands,
  type HandValue,
  type HoldemAction,
  type HoldemHandResult,
  type HoldemLogEntry,
  type HoldemPotResult,
  type HoldemStreet,
  type HoldemView,
  type PokerCard,
  type PokerSuit,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface Seat {
  id: string;
  chips: number;
  bet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** 不参与当前及之后的牌局：筹码输光，或者离开了房间 */
  out: boolean;
  /** 离开了房间，不再显示 */
  left: boolean;
  /** 本轮下注圈还需要表态 */
  needsAction: boolean;
  /**
   * 还能不能加注。有人完整加注后其他人重新获得加注权；
   * 有人全下但加的不够一个最小加注额时，已经表过态的人只能跟注或弃牌。
   */
  mayRaise: boolean;
  lastAction: string | null;
  cards: PokerCard[];
  shown: boolean;
  handName: string | null;
}

interface State {
  seats: Seat[];
  handNo: number;
  dealerIdx: number;
  sbIdx: number;
  bbIdx: number;
  deck: PokerCard[];
  board: PokerCard[];
  street: HoldemStreet;
  phase: "betting" | "result" | "ended";
  currentBet: number;
  /** 最小加注幅度：大盲，或者本轮上一次完整加注的幅度 */
  minRaise: number;
  turnIdx: number | null;
  turnLeft: number;
  resultLeft: number;
  result: HoldemHandResult | null;
  log: HoldemLogEntry[];
  seq: number;
  winnerId: string | null;
  nextCardId: number;
}

const LOG_LIMIT = 40;
const SUITS: PokerSuit[] = ["s", "h", "d", "c"];

function log(s: State, playerId: string, kind: HoldemLogEntry["kind"], text: string): void {
  s.log.push({ seq: ++s.seq, kind, playerId, text });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function blinds(s: State): [number, number] {
  const level = Math.min(Math.floor((s.handNo - 1) / HOLDEM_HANDS_PER_LEVEL), HOLDEM_BLINDS.length - 1);
  return HOLDEM_BLINDS[Math.max(level, 0)]!;
}

const inHand = (p: Seat) => !p.out && !p.folded;
const canAct = (p: Seat) => inHand(p) && !p.allIn;

/** 从 from 之后（不含 from）顺时针找第一个满足条件的座位 */
function nextIdx(s: State, from: number, pred: (p: Seat) => boolean): number | null {
  const n = s.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i + n) % n;
    if (pred(s.seats[idx]!)) return idx;
  }
  return null;
}

function newDeck(s: State): PokerCard[] {
  const deck: PokerCard[] = [];
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push({ id: s.nextCardId++, rank, suit });
  return shuffle(deck);
}

function pay(p: Seat, amount: number): number {
  const paid = Math.min(amount, p.chips);
  p.chips -= paid;
  p.bet += paid;
  p.totalBet += paid;
  if (p.chips === 0) p.allIn = true;
  return paid;
}

function startHand(s: State): void {
  const active = s.seats.filter((p) => !p.out);
  if (active.length <= 1) {
    s.phase = "ended";
    s.winnerId = active[0]?.id ?? null;
    s.turnIdx = null;
    return;
  }

  s.handNo++;
  const [sb, bb] = blinds(s);
  s.dealerIdx = s.handNo === 1 ? s.seats.indexOf(active[0]!) : nextIdx(s, s.dealerIdx, (p) => !p.out)!;
  if (active.length === 2) {
    // 单挑：庄家下小盲，翻牌前先说话，翻牌后后说话
    s.sbIdx = s.dealerIdx;
    s.bbIdx = nextIdx(s, s.dealerIdx, (p) => !p.out)!;
  } else {
    s.sbIdx = nextIdx(s, s.dealerIdx, (p) => !p.out)!;
    s.bbIdx = nextIdx(s, s.sbIdx, (p) => !p.out)!;
  }

  s.deck = newDeck(s);
  s.board = [];
  s.street = "preflop";
  s.phase = "betting";
  s.result = null;
  for (const p of s.seats) {
    Object.assign(p, {
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      needsAction: !p.out,
      mayRaise: true,
      lastAction: null,
      cards: p.out ? [] : s.deck.splice(0, 2),
      shown: false,
      handName: null,
    });
  }

  const sbSeat = s.seats[s.sbIdx]!;
  const bbSeat = s.seats[s.bbIdx]!;
  log(s, s.seats[s.dealerIdx]!.id, "hand", `是庄家 · 第 ${s.handNo} 手，盲注 ${sb}/${bb}`);
  pay(sbSeat, sb);
  sbSeat.lastAction = `小盲 ${sbSeat.bet}`;
  pay(bbSeat, bb);
  bbSeat.lastAction = `大盲 ${bbSeat.bet}`;
  for (const p of s.seats) if (p.allIn) p.needsAction = false;
  // 大盲没下够也按完整大盲算跟注额
  s.currentBet = bb;
  s.minRaise = bb;
  proceed(s, s.bbIdx);
}

/** 这个人现在还需不需要说话：轮到过他但别人又加注了，或者本轮还没表态 */
function pending(s: State, p: Seat): boolean {
  if (!canAct(p) || !p.needsAction) return false;
  if (p.bet < s.currentBet) return true;
  // 其他人都全下或弃牌了，自己也已经跟够了，就没什么可做的
  return s.seats.some((o) => o !== p && canAct(o));
}

/** 一个人行动完之后：找下一个要说话的人，或者进入下一条街 */
function proceed(s: State, fromIdx: number): void {
  const live = s.seats.filter(inHand);
  if (live.length === 1) {
    winUncontested(s, live[0]!);
    return;
  }
  const next = nextIdx(s, fromIdx, (p) => pending(s, p));
  if (next !== null) {
    s.turnIdx = next;
    s.turnLeft = HOLDEM_TURN_SECONDS;
    return;
  }
  nextStreet(s);
}

function nextStreet(s: State): void {
  for (;;) {
    for (const p of s.seats) {
      p.bet = 0;
      if (canAct(p)) p.lastAction = null;
    }
    s.currentBet = 0;
    s.minRaise = blinds(s)[1];
    s.turnIdx = null;

    if (s.street === "river") {
      showdown(s);
      return;
    }
    s.street = s.street === "preflop" ? "flop" : s.street === "flop" ? "turn" : "river";
    s.board.push(...s.deck.splice(0, s.street === "flop" ? 3 : 1));
    log(s, "", "street", `${HOLDEM_STREET_LABEL[s.street]}：发出 ${s.street === "flop" ? 3 : 1} 张公共牌`);

    const actors = s.seats.filter(canAct);
    if (actors.length >= 2) {
      for (const p of actors) {
        p.needsAction = true;
        p.mayRaise = true;
      }
      s.turnIdx = nextIdx(s, s.dealerIdx, canAct);
      s.turnLeft = HOLDEM_TURN_SECONDS;
      return;
    }
    // 最多只剩一个人还有筹码可下：不用再下注，直接把公共牌发完
  }
}

function winUncontested(s: State, winner: Seat): void {
  const pot = s.seats.reduce((sum, p) => sum + p.totalBet, 0);
  winner.chips += pot;
  const net = Object.fromEntries(s.seats.map((p) => [p.id, (p === winner ? pot : 0) - p.totalBet]));
  log(s, winner.id, "win", `其他人都弃牌了，赢下 ${pot}`);
  finishHand(s, { pots: [{ amount: pot, winners: [winner.id], handName: null }], net, uncontested: true, winningCardIds: [] });
}

function showdown(s: State): void {
  s.street = "showdown";
  const values = new Map<Seat, HandValue>();
  for (const p of s.seats.filter(inHand)) {
    const v = bestHand([...p.cards, ...s.board])!;
    values.set(p, v);
    p.shown = true;
    p.handName = v.name;
  }

  // 按全下的档位切分主池、边池
  const won = new Map<Seat, number>();
  const pots: HoldemPotResult[] = [];
  const levels = [...new Set(s.seats.filter(inHand).map((p) => p.totalBet))].sort((a, b) => a - b);
  let prev = 0;
  let winningCardIds: number[] = [];
  levels.forEach((level, li) => {
    let amount = 0;
    for (const p of s.seats) amount += Math.max(0, Math.min(p.totalBet, level) - prev);
    // 弃牌的人比最高档投得还多（很少见），多出来的也算进最后一个池
    if (li === levels.length - 1) for (const p of s.seats) amount += Math.max(0, p.totalBet - level);
    prev = level;
    if (amount === 0) return;

    const eligible = s.seats.filter((p) => inHand(p) && p.totalBet >= level);
    let best: Seat[] = [];
    for (const p of eligible) {
      const cmp = best.length ? compareHands(values.get(p)!, values.get(best[0]!)!) : 1;
      if (cmp > 0) best = [p];
      else if (cmp === 0) best.push(p);
    }
    // 从庄家左边开始排，零头给最靠前的赢家
    best.sort((a, b) => order(s, a) - order(s, b));
    const share = Math.floor(amount / best.length);
    best.forEach((p, i) => won.set(p, (won.get(p) ?? 0) + share + (i === 0 ? amount - share * best.length : 0)));

    // 只有一个人有资格的池是没人跟的多余下注，直接退回，不算一个池
    if (eligible.length > 1) {
      pots.push({ amount, winners: best.map((p) => p.id), handName: values.get(best[0]!)!.name });
      if (winningCardIds.length === 0) winningCardIds = best.flatMap((p) => values.get(p)!.best.map((c) => c.id));
    }
  });

  for (const [p, amount] of won) p.chips += amount;
  const net = Object.fromEntries(s.seats.map((p) => [p.id, (won.get(p) ?? 0) - p.totalBet]));
  for (const pot of pots) {
    for (const id of pot.winners) log(s, id, "win", `${pot.winners.length > 1 ? "平分" : "赢下"} ${pot.amount}（${pot.handName}）`);
  }
  finishHand(s, { pots, net, uncontested: false, winningCardIds: [...new Set(winningCardIds)] });
}

/** 从庄家左边开始的顺序 */
function order(s: State, p: Seat): number {
  const n = s.seats.length;
  return (s.seats.indexOf(p) - s.dealerIdx - 1 + n) % n;
}

function finishHand(s: State, result: HoldemHandResult): void {
  s.result = result;
  s.turnIdx = null;
  for (const p of s.seats) {
    if (!p.out && p.chips === 0) {
      p.out = true;
      log(s, p.id, "bust", "输光了筹码，出局");
    }
  }
  const alive = s.seats.filter((p) => !p.out);
  if (alive.length <= 1) {
    s.phase = "ended";
    s.winnerId = alive[0]?.id ?? null;
    return;
  }
  s.phase = "result";
  s.resultLeft = HOLDEM_RESULT_SECONDS;
}

function act(s: State, idx: number, action: HoldemAction): void {
  const p = s.seats[idx]!;
  const toCall = Math.max(0, s.currentBet - p.bet);

  const raiseTo = (to: number) => {
    const maxTo = p.bet + p.chips;
    if (!p.mayRaise) throw new GameError("别人的全下没有加够最小加注额，你只能跟注或弃牌");
    if (to <= s.currentBet) throw new GameError("加注要比当前最高注多");
    if (to > maxTo) throw new GameError("筹码不够");
    if (to < s.currentBet + s.minRaise && to !== maxTo) throw new GameError(`最少加到 ${s.currentBet + s.minRaise}`);
    const increase = to - s.currentBet;
    pay(p, to - p.bet);
    const full = increase >= s.minRaise;
    if (full) s.minRaise = increase;
    s.currentBet = to;
    for (const o of s.seats) {
      if (o === p || !canAct(o)) continue;
      o.needsAction = true;
      if (full) o.mayRaise = true;
    }
    p.lastAction = p.allIn ? `全下 ${p.bet}` : `加注到 ${to}`;
    log(s, p.id, p.allIn ? "allin" : "raise", p.allIn ? `全下，本轮共 ${p.bet}` : `加注到 ${to}`);
  };

  switch (action.type) {
    case "fold":
      p.folded = true;
      p.lastAction = "弃牌";
      log(s, p.id, "fold", "弃牌");
      break;
    case "check":
      if (toCall > 0) throw new GameError(`需要跟注 ${toCall}，不能过牌`);
      p.lastAction = "过牌";
      log(s, p.id, "check", "过牌");
      break;
    case "call": {
      if (toCall === 0) throw new GameError("没有人下注，可以直接过牌");
      const paid = pay(p, toCall);
      p.lastAction = p.allIn ? `全下 ${p.bet}` : `跟注 ${p.bet}`;
      log(s, p.id, p.allIn ? "allin" : "call", p.allIn ? `全下跟注 ${paid}` : `跟注 ${paid}`);
      break;
    }
    case "raise":
      if (!Number.isInteger(action.to)) throw new GameError("加注金额要是整数");
      raiseTo(action.to);
      break;
    case "allin": {
      const maxTo = p.bet + p.chips;
      if (p.chips === 0) throw new GameError("你已经全下了");
      if (maxTo <= s.currentBet) {
        const paid = pay(p, p.chips);
        p.lastAction = `全下 ${p.bet}`;
        log(s, p.id, "allin", `全下跟注 ${paid}`);
      } else {
        raiseTo(maxTo);
      }
      break;
    }
    default:
      throw new GameError("未知操作");
  }

  p.needsAction = false;
  p.mayRaise = false;
  proceed(s, idx);
}

export const holdem: GameEngine<State, HoldemAction, HoldemView> = {
  meta: GAMES.holdem,

  setup(players) {
    const seats: Seat[] = shuffle(players.map((p) => p.id)).map((id) => ({
      id,
      chips: HOLDEM_START_CHIPS,
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      out: false,
      left: false,
      needsAction: false,
      mayRaise: false,
      lastAction: null,
      cards: [],
      shown: false,
      handName: null,
    }));
    const s: State = {
      seats,
      handNo: 0,
      dealerIdx: 0,
      sbIdx: 0,
      bbIdx: 0,
      deck: [],
      board: [],
      street: "preflop",
      phase: "betting",
      currentBet: 0,
      minRaise: 0,
      turnIdx: null,
      turnLeft: 0,
      resultLeft: 0,
      result: null,
      log: [],
      seq: 0,
      winnerId: null,
      nextCardId: 1,
    };
    startHand(s);
    return s;
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("游戏已结束");
    if (s.phase !== "betting" || s.turnIdx === null) throw new GameError("等下一手开始");
    const idx = s.seats.findIndex((p) => p.id === playerId);
    if (idx < 0 || s.seats[idx]!.out) throw new GameError("你已经出局了");
    if (idx !== s.turnIdx) throw new GameError("还没轮到你");
    act(s, idx, action);
  },

  tick(s) {
    if (s.phase === "betting" && s.turnIdx !== null) {
      if (--s.turnLeft > 0) return false;
      const idx = s.turnIdx;
      const p = s.seats[idx]!;
      const canCheck = p.bet >= s.currentBet;
      log(s, p.id, "timeout", canCheck ? "超时，自动过牌" : "超时，自动弃牌");
      act(s, idx, { gameId: "holdem", type: canCheck ? "check" : "fold" });
      return true;
    }
    if (s.phase === "result") {
      if (--s.resultLeft > 0) return false;
      startHand(s);
      return true;
    }
    return false;
  },

  viewFor(s, playerId) {
    const me = s.seats.find((p) => p.id === playerId);
    const myTurn = s.phase === "betting" && s.turnIdx !== null && s.seats[s.turnIdx]?.id === playerId && !!me;
    const [sb, bb] = blinds(s);
    return {
      gameId: "holdem",
      phase: s.phase,
      handNo: s.handNo,
      street: s.street,
      seats: s.seats
        .filter((p) => !p.left)
        .map((p) => ({
          id: p.id,
          chips: p.chips,
          bet: p.bet,
          totalBet: p.totalBet,
          folded: p.folded,
          allIn: p.allIn,
          out: p.out,
          lastAction: p.lastAction,
          shownCards: p.shown ? p.cards : null,
          handName: p.handName,
        })),
      dealerId: s.seats[s.dealerIdx]!.id,
      sbId: s.seats[s.sbIdx]!.id,
      bbId: s.seats[s.bbIdx]!.id,
      smallBlind: sb,
      bigBlind: bb,
      handsToNextLevel:
        Math.floor((s.handNo - 1) / HOLDEM_HANDS_PER_LEVEL) >= HOLDEM_BLINDS.length - 1
          ? 0
          : HOLDEM_HANDS_PER_LEVEL - ((s.handNo - 1) % HOLDEM_HANDS_PER_LEVEL),
      board: s.board,
      pot: s.seats.reduce((sum, p) => sum + p.totalBet, 0),
      currentBet: s.currentBet,
      minRaiseTo: s.currentBet + s.minRaise,
      turnId: s.turnIdx !== null && s.phase === "betting" ? s.seats[s.turnIdx]!.id : null,
      turnSecondsLeft: s.turnIdx !== null ? s.turnLeft : 0,
      nextHandIn: s.phase === "result" ? s.resultLeft : 0,
      myCards: me && !me.out ? me.cards : [],
      canCheck: myTurn && me!.bet >= s.currentBet,
      callAmount: myTurn ? Math.min(Math.max(0, s.currentBet - me!.bet), me!.chips) : 0,
      canRaise: myTurn && me!.mayRaise && me!.bet + me!.chips > s.currentBet,
      maxRaiseTo: me ? me.bet + me.chips : 0,
      result: s.result,
      log: s.log.slice(-20),
      winnerId: s.winnerId,
    };
  },

  removePlayer(s, playerId) {
    const idx = s.seats.findIndex((p) => p.id === playerId);
    const p = s.seats[idx];
    if (!p || p.left) return true;
    const wasInHand = inHand(p);
    p.left = true;
    if (s.phase === "ended") return true;
    log(s, p.id, "leave", "离开了牌桌");
    p.out = true;
    p.folded = true;
    p.chips = 0;

    const remaining = s.seats.filter((o) => !o.out);
    if (remaining.length <= 1) {
      // 只剩一个人：下注中的话他赢走底池（亮牌阶段底池已经分完了），游戏结束
      const last = remaining[0];
      if (last && s.phase === "betting") last.chips += s.seats.reduce((sum, o) => sum + o.totalBet, 0);
      s.phase = "ended";
      s.turnIdx = null;
      s.winnerId = last?.id ?? null;
      return true;
    }
    if (s.phase === "betting" && wasInHand) {
      if (s.turnIdx === idx) proceed(s, idx);
      else if (s.seats.filter(inHand).length === 1) winUncontested(s, s.seats.find(inHand)!);
      else if (s.turnIdx !== null && !pending(s, s.seats[s.turnIdx]!)) proceed(s, s.turnIdx);
    }
    return true;
  },
};
