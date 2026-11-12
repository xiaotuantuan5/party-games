import {
  GAMES,
  WEREWOLF_ROLES,
  werewolfRoleSetup,
  type WerewolfAction,
  type WerewolfDeath,
  type WerewolfDeathCause,
  type WerewolfLogEntry,
  type WerewolfNightView,
  type WerewolfPhase,
  type WerewolfRole,
  type WerewolfTeam,
  type WerewolfView,
  type WerewolfVoteResult,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface State {
  roles: Record<string, WerewolfRole>;
  seats: string[];
  alive: string[];
  /** 第几个夜晚 / 白天，天黑时 +1 */
  round: number;
  phase: WerewolfPhase;
  nightStep: "wolf" | "witch";
  /** 每个狼人选的目标；所有存活狼人选同一个人才锁定 */
  wolfVotes: Record<string, string>;
  /** 锁定的刀口 */
  wolfTarget: string | null;
  seerDone: boolean;
  seerChecks: { round: number; targetId: string; isWolf: boolean }[];
  potions: { antidote: boolean; poison: boolean };
  lastNightDeaths: string[] | null;
  /** 猎人开枪，then 表示开完枪接着进入白天还是黑夜 */
  hunter: { hunterId: string; then: "day" | "night" } | null;
  speakOrder: string[];
  ready: string[];
  votes: Record<string, string | null>;
  deaths: WerewolfDeath[];
  voteResults: WerewolfVoteResult[];
  log: WerewolfLogEntry[];
  seq: number;
  winner: WerewolfTeam | null;
}

const LOG_LIMIT = 60;

const isWolf = (s: State, id: string) => s.roles[id] === "wolf";
const aliveWith = (s: State, role: WerewolfRole) => s.alive.filter((id) => s.roles[id] === role);

function log(s: State, entry: Omit<WerewolfLogEntry, "seq">): void {
  s.log.push({ ...entry, seq: ++s.seq });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function bySeat(s: State, ids: string[]): string[] {
  return [...ids].sort((a, b) => s.seats.indexOf(a) - s.seats.indexOf(b));
}

function kill(s: State, id: string, cause: WerewolfDeathCause): void {
  if (!s.alive.includes(id)) return;
  s.alive = s.alive.filter((x) => x !== id);
  s.deaths.push({ playerId: id, round: s.round, cause });
}

function checkWinner(s: State): boolean {
  const wolves = s.alive.filter((id) => isWolf(s, id)).length;
  const good = s.alive.length - wolves;
  if (wolves === 0) s.winner = "good";
  else if (wolves >= good) s.winner = "wolf";
  if (!s.winner) return false;
  s.phase = "ended";
  s.hunter = null;
  log(s, { kind: "end", text: s.winner === "good" ? "狼人全部出局，好人获胜！" : "狼人数量不少于好人，狼人获胜！" });
  return true;
}

function startNight(s: State): void {
  s.round++;
  s.phase = "night";
  s.nightStep = "wolf";
  s.wolfVotes = {};
  s.wolfTarget = null;
  s.seerDone = aliveWith(s, "seer").length === 0;
  s.lastNightDeaths = null;
  s.ready = [];
  s.votes = {};
  log(s, { kind: "night", text: `第 ${s.round} 夜，天黑请闭眼` });
  advanceNight(s);
}

/** 所有存活狼人都选了同一个人 */
function lockedWolfTarget(s: State): string | null {
  const wolves = aliveWith(s, "wolf");
  const picks = wolves.map((id) => s.wolfVotes[id]);
  const first = picks[0];
  if (!first || picks.some((t) => t !== first)) return null;
  return first;
}

/** 检查夜里的行动是否都做完了，做完就进入下一步 */
function advanceNight(s: State): void {
  if (s.phase !== "night") return;
  if (s.nightStep === "wolf") {
    const target = lockedWolfTarget(s);
    if (!target || !s.seerDone) return;
    s.wolfTarget = target;
    s.nightStep = "witch";
  }
  const witch = aliveWith(s, "witch")[0];
  if (!witch || (!s.potions.antidote && !s.potions.poison)) resolveNight(s, false, null);
}

function resolveNight(s: State, saved: boolean, poisonId: string | null): void {
  const dead = new Set<string>();
  const knifed = saved ? null : s.wolfTarget;
  if (knifed && s.alive.includes(knifed)) dead.add(knifed);
  if (poisonId && s.alive.includes(poisonId)) dead.add(poisonId);
  const deaths = bySeat(s, [...dead]);
  for (const id of deaths) kill(s, id, "night");
  s.lastNightDeaths = deaths;
  log(s, {
    kind: "dawn",
    playerIds: deaths,
    text: deaths.length ? `天亮了，昨晚倒下的是：{players}` : "天亮了，昨晚是平安夜",
  });

  // 猎人被刀能开枪，被毒不能
  const hunter = knifed && knifed !== poisonId && s.roles[knifed] === "hunter" ? knifed : null;
  if (hunter) {
    s.phase = "hunter";
    s.hunter = { hunterId: hunter, then: "day" };
    return;
  }
  continueAfterDeaths(s, "day");
}

function continueAfterDeaths(s: State, next: "day" | "night"): void {
  s.hunter = null;
  if (checkWinner(s)) return;
  if (next === "night") startNight(s);
  else startDay(s);
}

function startDay(s: State): void {
  s.phase = "day";
  s.ready = [];
  s.votes = {};
  // 从昨晚第一个死者的下一位开始发言，平安夜就按轮次轮换起点
  const n = s.seats.length;
  const firstDead = s.lastNightDeaths?.[0];
  const start = firstDead ? s.seats.indexOf(firstDead) + 1 : (s.round - 1) % n;
  const rotated = [...s.seats.slice(start % n), ...s.seats.slice(0, start % n)];
  s.speakOrder = rotated.filter((id) => s.alive.includes(id));
}

function checkReady(s: State): void {
  if (s.phase !== "day") return;
  if (!s.alive.every((id) => s.ready.includes(id))) return;
  s.phase = "vote";
  s.votes = {};
}

function tallyIfComplete(s: State): void {
  if (s.phase !== "vote") return;
  if (!s.alive.every((id) => id in s.votes)) return;

  const counts = new Map<string, number>();
  for (const t of Object.values(s.votes)) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  const top = [...counts].filter(([, c]) => c === max).map(([id]) => id);
  const exiledId = max > 0 && top.length === 1 ? top[0]! : null;

  s.voteResults.push({ round: s.round, votes: { ...s.votes }, exiledId });
  if (!exiledId) {
    log(s, { kind: "vote", text: max > 0 ? "平票，今天没有人出局" : "大家都弃票了，今天没有人出局" });
    continueAfterDeaths(s, "night");
    return;
  }
  kill(s, exiledId, "vote");
  log(s, { kind: "exile", playerIds: [exiledId], text: `{players} 以 ${max} 票被投出局` });
  if (s.roles[exiledId] === "hunter") {
    s.phase = "hunter";
    s.hunter = { hunterId: exiledId, then: "night" };
    return;
  }
  continueAfterDeaths(s, "night");
}

function requireAliveTarget(s: State, targetId: unknown, msg = "请选择一位场上的玩家"): string {
  if (typeof targetId !== "string" || !s.alive.includes(targetId)) throw new GameError(msg);
  return targetId;
}

function hunterShoot(s: State, playerId: string, targetId: unknown): void {
  if (s.phase !== "hunter" || s.hunter?.hunterId !== playerId) throw new GameError("现在不能开枪");
  const then = s.hunter.then;
  const hunter = `${WEREWOLF_ROLES.hunter.emoji} 猎人 {players}`;
  if (targetId !== null) {
    const target = requireAliveTarget(s, targetId);
    if (target === playerId) throw new GameError("不能打自己");
    kill(s, target, "shot");
    log(s, { kind: "shot", playerIds: [playerId], targetId: target, text: `${hunter} 开枪带走了 {target}` });
  } else {
    log(s, { kind: "shot", playerIds: [playerId], text: `${hunter} 没有开枪` });
  }
  continueAfterDeaths(s, then);
}

export const werewolf: GameEngine<State, WerewolfAction, WerewolfView> = {
  meta: GAMES.werewolf,

  setup(players) {
    const seats = shuffle(players.map((p) => p.id));
    const roleList = shuffle(werewolfRoleSetup(seats.length));
    const roles: Record<string, WerewolfRole> = {};
    seats.forEach((id, i) => (roles[id] = roleList[i]!));

    const s: State = {
      roles,
      seats,
      alive: [...seats],
      round: 0,
      phase: "night",
      nightStep: "wolf",
      wolfVotes: {},
      wolfTarget: null,
      seerDone: false,
      seerChecks: [],
      potions: { antidote: true, poison: true },
      lastNightDeaths: null,
      hunter: null,
      speakOrder: [],
      ready: [],
      votes: {},
      deaths: [],
      voteResults: [],
      log: [],
      seq: 0,
      winner: null,
    };
    startNight(s);
    return s;
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("游戏已结束");
    if (!s.seats.includes(playerId)) throw new GameError("你不在这局游戏里");
    // 猎人开枪时已经死了，所以在存活检查之前处理
    if (action.type === "hunterShoot") return hunterShoot(s, playerId, action.targetId);
    if (!s.alive.includes(playerId)) throw new GameError("你已经出局了，安静观战吧");
    const role = s.roles[playerId]!;

    switch (action.type) {
      case "wolfKill": {
        if (s.phase !== "night" || s.nightStep !== "wolf" || role !== "wolf") throw new GameError("现在不是你行动的时候");
        const target = requireAliveTarget(s, action.targetId);
        if (isWolf(s, target)) throw new GameError("不能刀狼队友");
        s.wolfVotes[playerId] = target;
        advanceNight(s);
        return;
      }
      case "seerCheck": {
        if (s.phase !== "night" || s.nightStep !== "wolf" || role !== "seer") throw new GameError("现在不是你行动的时候");
        if (s.seerDone) throw new GameError("今晚已经查验过了");
        const target = requireAliveTarget(s, action.targetId);
        if (target === playerId) throw new GameError("不能查验自己");
        s.seerChecks.push({ round: s.round, targetId: target, isWolf: isWolf(s, target) });
        s.seerDone = true;
        advanceNight(s);
        return;
      }
      case "witch": {
        if (s.phase !== "night" || s.nightStep !== "witch" || role !== "witch") throw new GameError("现在不是你行动的时候");
        const save = action.save === true;
        const poisonId = action.poisonId ?? null;
        if (save && poisonId) throw new GameError("同一晚只能用一瓶药");
        if (save) {
          if (!s.potions.antidote) throw new GameError("解药已经用过了");
          if (!s.wolfTarget) throw new GameError("今晚没有人需要救");
          if (s.wolfTarget === playerId) throw new GameError("女巫不能自救");
          s.potions.antidote = false;
        }
        if (poisonId) {
          if (!s.potions.poison) throw new GameError("毒药已经用过了");
          const target = requireAliveTarget(s, poisonId);
          if (target === playerId) throw new GameError("不能毒自己");
          s.potions.poison = false;
        }
        resolveNight(s, save, poisonId);
        return;
      }
      case "ready": {
        if (s.phase !== "day") throw new GameError("现在不是讨论阶段");
        s.ready = s.ready.filter((id) => id !== playerId);
        if (action.ready === true) s.ready.push(playerId);
        checkReady(s);
        return;
      }
      case "vote": {
        if (s.phase !== "vote") throw new GameError("现在还不能投票");
        if (playerId in s.votes) throw new GameError("你已经投过票了");
        const target = action.targetId === null ? null : requireAliveTarget(s, action.targetId, "只能投给场上的玩家");
        if (target === playerId) throw new GameError("不能投自己");
        s.votes[playerId] = target;
        tallyIfComplete(s);
        return;
      }
      default:
        throw new GameError("未知操作");
    }
  },

  viewFor(s, playerId) {
    const role = s.roles[playerId] ?? "villager";
    const alive = s.alive.includes(playerId);
    const ended = s.phase === "ended";

    let night: WerewolfNightView | null = null;
    if (s.phase === "night" && alive) {
      const wolfStep = s.nightStep === "wolf";
      const hasPotion = s.potions.antidote || s.potions.poison;
      let task: WerewolfNightView["task"] = null;
      if (wolfStep && role === "wolf") task = "wolf";
      else if (wolfStep && role === "seer" && !s.seerDone) task = "seer";
      else if (!wolfStep && role === "witch" && hasPotion) task = "witch";
      night = {
        task,
        done: (role === "wolf" && !wolfStep) || (role === "seer" && s.seerDone),
        wolfVotes: task === "wolf" ? { ...s.wolfVotes } : null,
        wolfTargetId: task === "witch" && s.potions.antidote ? s.wolfTarget : null,
      };
    }

    return {
      gameId: "werewolf",
      phase: s.phase,
      round: s.round,
      order: s.seats,
      alive: s.alive,
      myRole: role,
      wolfTeam: role === "wolf" ? s.seats.filter((id) => isWolf(s, id)) : null,
      night,
      seerChecks: role === "seer" ? s.seerChecks : null,
      potions: role === "witch" ? { ...s.potions } : null,
      lastNightDeaths: s.phase === "night" ? null : s.lastNightDeaths,
      speakOrder: s.speakOrder,
      readyIds: s.ready,
      votedIds: Object.keys(s.votes),
      hunterId: s.phase === "hunter" ? (s.hunter?.hunterId ?? null) : null,
      deaths: s.deaths,
      voteResults: s.voteResults,
      log: s.log.slice(-30),
      winner: s.winner,
      reveal: ended ? s.roles : null,
    };
  },

  removePlayer(s, playerId) {
    if (s.phase === "ended" || !s.seats.includes(playerId)) return true;
    const wasAlive = s.alive.includes(playerId);
    const role = s.roles[playerId];

    // 猎人开枪阶段走掉了，就当他不开枪
    if (s.phase === "hunter" && s.hunter?.hunterId === playerId) {
      log(s, { kind: "leave", playerIds: [playerId], text: "{players} 离开了游戏" });
      continueAfterDeaths(s, s.hunter.then);
      return true;
    }
    if (!wasAlive) return true;

    kill(s, playerId, "leave");
    log(s, { kind: "leave", playerIds: [playerId], text: "{players} 离开了游戏" });
    delete s.wolfVotes[playerId];
    for (const [w, t] of Object.entries(s.wolfVotes)) if (t === playerId) delete s.wolfVotes[w];
    if (s.wolfTarget === playerId) s.wolfTarget = null;
    if (role === "seer") s.seerDone = true;
    s.ready = s.ready.filter((id) => id !== playerId);
    delete s.votes[playerId];
    for (const [v, t] of Object.entries(s.votes)) if (t === playerId) delete s.votes[v];
    s.speakOrder = s.speakOrder.filter((id) => id !== playerId);

    if (checkWinner(s)) return true;
    if (s.phase === "night") {
      if (s.nightStep === "witch" && role === "witch") resolveNight(s, false, null);
      else advanceNight(s);
    } else if (s.phase === "day") checkReady(s);
    else if (s.phase === "vote") tallyIfComplete(s);
    return true;
  },
};
