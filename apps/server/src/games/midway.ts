import {
  GAMES,
  MIDWAY_DISCUSS_MS,
  MIDWAY_MAX_STRIKES,
  MIDWAY_SHEET_SIZE,
  midwayExtremes,
  type MidwayAccusation,
  type MidwayAction,
  type MidwayExtremes,
  type MidwayLogEntry,
  type MidwayOutcome,
  type MidwayOutReason,
  type MidwayPhase,
  type MidwayResult,
  type MidwayView,
  type MidwayZeroCase,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface State {
  seats: string[];
  cards: Record<string, number>;
  phase: MidwayPhase;
  sheets: Record<string, number[]>;
  submitted: string[];
  announce: MidwayExtremes | null;
  out: Record<string, MidwayOutReason>;
  revealedCards: Record<string, number>;
  revealedSheets: string[];
  strikes: Record<string, number>;
  accusations: MidwayAccusation[];
  queriesLeft: Record<string, number>;
  queries: Record<string, { digit: number; count: number }[]>;
  pendingZero: { accuserId: string; targetId: string } | null;
  discussEndsAt: number | null;
  ready: string[];
  modified: string[];
  log: MidwayLogEntry[];
  seq: number;
  result: MidwayResult | null;
}

const LOG_LIMIT = 60;

const alive = (s: State) => s.seats.filter((id) => !(id in s.out));
const isAlive = (s: State, id: string) => s.seats.includes(id) && !(id in s.out);
const zeroHolder = (s: State) => s.seats.find((id) => s.cards[id] === 0)!;

function log(s: State, entry: Omit<MidwayLogEntry, "seq">): void {
  s.log.push({ ...entry, seq: ++s.seq });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function requireDigit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 9) throw new GameError("请选择 0~9 中的数字");
  return raw;
}

/** 所有纸条里某个数字一共出现几次 */
function totalCount(s: State, digit: number): number {
  return Object.values(s.sheets).reduce((n, sheet) => n + sheet.filter((d) => d === digit).length, 0);
}

/** 只统计在场数字（本局发出去的牌），没人写的记 0 次 */
function inPlayCounts(s: State): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const id of s.seats) counts[s.cards[id]!] = 0;
  for (const sheet of Object.values(s.sheets)) for (const d of sheet) if (d in counts) counts[d]!++;
  return counts;
}

function describe(digits: number[]): string {
  return digits.length ? digits.join("、") : "无";
}

function startDiscussion(s: State): void {
  s.phase = "discuss";
  s.announce = midwayExtremes(inPlayCounts(s));
  s.discussEndsAt = Date.now() + MIDWAY_DISCUSS_MS;
  s.ready = [];
  log(s, {
    kind: "announce",
    text: s.announce.max.length
      ? `首轮统计：最多的是 ${describe(s.announce.max)}，最少的是 ${describe(s.announce.min)}`
      : "首轮统计：在场数字被写的次数全都一样",
  });
}

function checkSubmitted(s: State): void {
  if (s.phase !== "submit") return;
  if (alive(s).every((id) => s.submitted.includes(id))) startDiscussion(s);
}

function checkReady(s: State): void {
  if (s.phase !== "discuss" || s.pendingZero) return;
  if (!alive(s).every((id) => s.ready.includes(id))) return;
  s.phase = "modify";
  s.modified = [];
}

function checkModified(s: State): void {
  if (s.phase !== "modify") return;
  if (alive(s).every((id) => s.modified.includes(id))) settle(s);
}

function settle(s: State): void {
  const counts = inPlayCounts(s);
  const extremes = midwayExtremes(counts);
  const holder = zeroHolder(s);
  const outcomes: Record<string, MidwayOutcome> = {};
  const outText: Record<MidwayOutReason, string> = {
    caught: "被指认出局",
    strikes: `指错 ${MIDWAY_MAX_STRIKES} 次出局`,
    leave: "中途离开",
  };
  for (const [id, reason] of Object.entries(s.out)) outcomes[id] = { won: false, reason: outText[reason] };

  let zeroCase: MidwayZeroCase;
  if (counts[0] === 0 && isAlive(s, holder)) {
    zeroCase = "nobody";
    for (const id of alive(s)) {
      outcomes[id] =
        id === holder ? { won: true, reason: "没人写 0，你单独获胜！" } : { won: false, reason: "没人写 0，拿 0 的人单独获胜" };
    }
  } else {
    const inMax = extremes.max.includes(0);
    const inMin = extremes.min.includes(0);
    const set = inMax ? extremes.max : inMin ? extremes.min : [];
    zeroCase = set.length === 1 ? "unique" : set.length > 1 ? "tie" : "middle";
    const where = inMax ? "最多" : "最少";

    for (const id of alive(s)) {
      const card = s.cards[id]!;
      const wrote0 = s.sheets[id]!.includes(0);
      if (id === holder) {
        outcomes[id] =
          zeroCase === "unique"
            ? { won: false, reason: `0 是唯一${where}的数字` }
            : zeroCase === "tie"
              ? { won: true, reason: `0 和别的数字并列${where}，不算输` }
              : { won: true, reason: "0 不多不少" };
      } else if (wrote0 && zeroCase === "unique") {
        outcomes[id] = { won: false, reason: `你写了 0，而 0 是唯一${where}的数字` };
      } else if (wrote0 && zeroCase === "tie") {
        outcomes[id] = { won: true, reason: `你写了 0，0 并列${where}，不算输` };
      } else if (extremes.max.includes(card)) {
        outcomes[id] = { won: false, reason: `你的 ${card} 被写了 ${counts[card]} 次，是最多的` };
      } else if (extremes.min.includes(card)) {
        outcomes[id] = { won: false, reason: `你的 ${card} 被写了 ${counts[card]} 次，是最少的` };
      } else {
        outcomes[id] = { won: true, reason: `你的 ${card} 被写了 ${counts[card]} 次，不上不下` };
      }
    }
  }

  s.result = { counts, extremes, zeroCase, outcomes };
  s.phase = "ended";
  s.pendingZero = null;
  const winners = s.seats.filter((id) => outcomes[id]?.won);
  log(s, {
    kind: "end",
    playerIds: winners,
    text: winners.length ? "结算完成，获胜的是：{players}" : "结算完成，这局没有人获胜",
  });
}

function eliminate(s: State, id: string, reason: MidwayOutReason): void {
  s.out[id] = reason;
  s.ready = s.ready.filter((x) => x !== id);
  if (!s.revealedSheets.includes(id)) s.revealedSheets.push(id);
}

function revealSheet(s: State, id: string): void {
  if (!s.revealedSheets.includes(id)) s.revealedSheets.push(id);
}

function accuse(s: State, playerId: string, targetId: unknown, digitRaw: unknown): void {
  if (s.phase !== "discuss") throw new GameError("只有自由交流阶段可以指认");
  if (s.pendingZero) throw new GameError("等被指认的人先把数字改成 0");
  if (typeof targetId !== "string" || !isAlive(s, targetId)) throw new GameError("请选择一位还在场的玩家");
  if (targetId === playerId) throw new GameError("不能指认自己");
  const guess = requireDigit(digitRaw);
  const correct = s.cards[targetId] === guess;
  s.accusations.push({ accuserId: playerId, targetId, guess, correct });

  if (correct) {
    eliminate(s, targetId, "caught");
    s.revealedCards[targetId] = guess;
    s.queriesLeft[playerId] = (s.queriesLeft[playerId] ?? 0) + 1;
    log(s, { kind: "caught", playerIds: [playerId], targetId, text: `{players} 指认 {target} 是 ${guess}，指对了！{target} 出局` });
    checkReady(s);
    return;
  }

  s.strikes[playerId] = (s.strikes[playerId] ?? 0) + 1;
  revealSheet(s, playerId);
  const sheet = s.sheets[playerId]!;
  log(s, {
    kind: "miss",
    playerIds: [playerId],
    targetId,
    text: `{players} 指认 {target} 是 ${guess}，指错了，公开纸条：${sheet.join("、")}`,
  });
  if (guess === 0 && !sheet.includes(0)) s.pendingZero = { accuserId: playerId, targetId };
  if (s.strikes[playerId]! >= MIDWAY_MAX_STRIKES) {
    eliminate(s, playerId, "strikes");
    log(s, { kind: "struckOut", playerIds: [playerId], text: `{players} 指错 ${MIDWAY_MAX_STRIKES} 次，直接失败` });
  }
  checkReady(s);
}

function validateSheet(numbers: unknown): number[] {
  if (!Array.isArray(numbers) || numbers.length !== MIDWAY_SHEET_SIZE) throw new GameError(`请写 ${MIDWAY_SHEET_SIZE} 个数字`);
  const sheet = numbers.map(requireDigit);
  if (new Set(sheet).size !== sheet.length) throw new GameError("3 个数字不能重复");
  return sheet;
}

export const midway: GameEngine<State, MidwayAction, MidwayView> = {
  meta: GAMES.midway,

  setup(players) {
    const seats = shuffle(players.map((p) => p.id));
    const digits = shuffle([0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, seats.length - 1)]);
    const cards: Record<string, number> = {};
    seats.forEach((id, i) => (cards[id] = digits[i]!));
    return {
      seats,
      cards,
      phase: "submit",
      sheets: {},
      submitted: [],
      announce: null,
      out: {},
      revealedCards: {},
      revealedSheets: [],
      strikes: {},
      accusations: [],
      queriesLeft: {},
      queries: {},
      pendingZero: null,
      discussEndsAt: null,
      ready: [],
      modified: [],
      log: [],
      seq: 0,
      result: null,
    };
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("游戏已结束");
    if (!s.seats.includes(playerId)) throw new GameError("你不在这局游戏里");

    // 出局的人只能用掉之前指对换来的询问机会，以及完成“改成 0”
    if (action.type === "query") {
      if (s.phase !== "discuss" && s.phase !== "modify") throw new GameError("现在不能询问");
      if (!(s.queriesLeft[playerId]! > 0)) throw new GameError("指对一次才能问一次");
      const digit = requireDigit(action.digit);
      s.queriesLeft[playerId]!--;
      (s.queries[playerId] ??= []).push({ digit, count: totalCount(s, digit) });
      return;
    }
    if (action.type === "zeroPick") {
      if (s.pendingZero?.targetId !== playerId) throw new GameError("现在不需要你选");
      const sheet = s.sheets[s.pendingZero.accuserId]!;
      const index = action.index;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= sheet.length) {
        throw new GameError("请选择一个数字");
      }
      const old = sheet[index]!;
      sheet[index] = 0;
      log(s, {
        kind: "zeroed",
        playerIds: [playerId],
        targetId: s.pendingZero.accuserId,
        text: `{players} 把 {target} 纸上的 ${old} 改成了 0`,
      });
      s.pendingZero = null;
      checkReady(s);
      return;
    }

    if (!isAlive(s, playerId)) throw new GameError("你已经出局了");

    switch (action.type) {
      case "submit": {
        if (s.phase !== "submit") throw new GameError("现在不是写数字的时候");
        if (s.submitted.includes(playerId)) throw new GameError("你已经交过了");
        const sheet = validateSheet(action.numbers);
        const card = s.cards[playerId]!;
        if (card !== 0 && !sheet.includes(card)) throw new GameError(`首轮必须写上自己的牌 ${card}`);
        s.sheets[playerId] = sheet;
        s.submitted.push(playerId);
        checkSubmitted(s);
        return;
      }
      case "accuse":
        return accuse(s, playerId, action.targetId, action.digit);
      case "ready": {
        if (s.phase !== "discuss") throw new GameError("现在不是自由交流阶段");
        s.ready = s.ready.filter((id) => id !== playerId);
        if (action.ready === true) s.ready.push(playerId);
        checkReady(s);
        return;
      }
      case "modify": {
        if (s.phase !== "modify") throw new GameError("现在不是修改阶段");
        if (s.modified.includes(playerId)) throw new GameError("你已经确认过了");
        const sheet = s.sheets[playerId]!;
        if (action.index !== null) {
          const index = action.index;
          if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= sheet.length) {
            throw new GameError("请选择要改的数字");
          }
          const digit = requireDigit(action.digit);
          if (digit !== sheet[index] && sheet.includes(digit)) throw new GameError("3 个数字不能重复");
          sheet[index] = digit;
        }
        s.modified.push(playerId);
        checkModified(s);
        return;
      }
      default:
        throw new GameError("未知操作");
    }
  },

  viewFor(s, playerId) {
    const ended = s.phase === "ended";
    const revealedSheets: Record<string, number[]> = {};
    for (const id of s.revealedSheets) revealedSheets[id] = [...s.sheets[id]!];
    return {
      gameId: "midway",
      phase: s.phase,
      order: s.seats,
      myCard: s.cards[playerId] ?? 0,
      mySheet: s.sheets[playerId] ? [...s.sheets[playerId]!] : null,
      inPlayCount: s.seats.length,
      announce: s.announce,
      submittedIds: s.submitted,
      out: s.out,
      revealedCards: s.revealedCards,
      revealedSheets,
      strikes: s.strikes,
      accusations: s.accusations,
      myQueriesLeft: s.queriesLeft[playerId] ?? 0,
      myQueries: s.queries[playerId] ?? [],
      pendingZero: s.pendingZero,
      discussEndsAt: s.phase === "discuss" ? s.discussEndsAt : null,
      readyIds: s.ready,
      modifiedIds: s.phase === "modify" ? s.modified : [],
      log: s.log.slice(-30),
      result: s.result,
      reveal: ended ? { cards: s.cards, sheets: s.sheets } : null,
    };
  },

  removePlayer(s, playerId) {
    if (s.phase === "ended" || !isAlive(s, playerId)) return true;
    eliminate(s, playerId, "leave");
    s.sheets[playerId] ??= [];
    log(s, { kind: "leave", playerIds: [playerId], text: "{players} 离开了游戏，纸条照样计入统计" });
    // 被误指为 0 的人走了，就自动改第一个不是 0 的数字
    if (s.pendingZero?.targetId === playerId) {
      const sheet = s.sheets[s.pendingZero.accuserId]!;
      const i = sheet.findIndex((d) => d !== 0);
      if (i >= 0) sheet[i] = 0;
      s.pendingZero = null;
    }
    if (alive(s).length === 0) {
      settle(s);
      return true;
    }
    checkSubmitted(s);
    checkReady(s);
    checkModified(s);
    return true;
  },
};
