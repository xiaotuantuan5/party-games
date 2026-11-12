import {
  GAMES,
  IC_DOORS,
  IC_FISH_PER_RUNNER,
  IC_ROOMS,
  IC_TURNS_PER_PLAYER,
  IcecoolSim,
  icClampFlick,
  icRoomAt,
  icStartPieces,
  type IcLogEntry,
  type IcPiece,
  type IcRoundResult,
  type IcScore,
  type IcShot,
  type IcecoolAction,
  type IcecoolView,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface State {
  seats: string[];
  /** 当老师的顺序，每人一轮 */
  catcherOrder: string[];
  round: number;
  catcherId: string;
  currentId: string;
  turn: number;
  pieces: IcPiece[];
  targets: Record<string, number[]>;
  collected: Record<string, number[]>;
  caught: string[];
  scores: Record<string, IcScore>;
  /** 本轮开始时的分数，用来算本轮得分 */
  roundStart: Record<string, number>;
  phase: IcecoolView["phase"];
  shot: IcShot | null;
  lastRound: IcRoundResult | null;
  winnerIds: string[];
  log: IcLogEntry[];
  seq: number;
}

const LOG_LIMIT = 40;

function log(s: State, playerId: string, text: string): void {
  s.log.push({ seq: ++s.seq, playerId, text });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

const total = (sc: IcScore | undefined) => (sc ? sc.fish + sc.catches : 0);

function nextSeat(s: State, id: string): string {
  const i = s.seats.indexOf(id);
  return s.seats[(i + 1) % s.seats.length]!;
}

function maxTurns(s: State): number {
  return s.seats.length * IC_TURNS_PER_PLAYER;
}

function startRound(s: State): void {
  const catcherId = s.catcherOrder[s.round]!;
  const runners = s.seats.filter((id) => id !== catcherId);
  s.catcherId = catcherId;
  s.pieces = icStartPieces(shuffle(runners), catcherId);
  s.targets = {};
  s.collected = {};
  for (const id of runners) {
    s.targets[id] = shuffle(IC_DOORS.map((d) => d.id)).slice(0, IC_FISH_PER_RUNNER);
    s.collected[id] = [];
  }
  s.caught = [];
  s.turn = 0;
  s.shot = null;
  s.roundStart = Object.fromEntries(s.seats.map((id) => [id, total(s.scores[id])]));
  // 老师的下家先弹
  s.currentId = nextSeat(s, catcherId);
  s.phase = "playing";
}

function endRound(s: State, reason: string, playerId?: string): void {
  s.lastRound = {
    round: s.round,
    catcherId: s.catcherId,
    reason,
    playerId,
    gained: Object.fromEntries(s.seats.map((id) => [id, total(s.scores[id]) - (s.roundStart[id] ?? 0)])),
  };
  if (s.round + 1 >= s.catcherOrder.length) {
    s.phase = "ended";
    const best = Math.max(...s.seats.map((id) => total(s.scores[id])));
    s.winnerIds = s.seats.filter((id) => total(s.scores[id]) === best);
  } else {
    s.phase = "roundOver";
  }
}

function runners(s: State): string[] {
  return s.seats.filter((id) => id !== s.catcherId);
}

export const icecool: GameEngine<State, IcecoolAction, IcecoolView> = {
  meta: GAMES.icecool,

  setup(players) {
    const seats = shuffle(players.map((p) => p.id));
    const s: State = {
      seats,
      catcherOrder: [...seats],
      round: 0,
      catcherId: seats[0]!,
      currentId: seats[0]!,
      turn: 0,
      pieces: [],
      targets: {},
      collected: {},
      caught: [],
      scores: Object.fromEntries(seats.map((id) => [id, { fish: 0, catches: 0 }])),
      roundStart: {},
      phase: "playing",
      shot: null,
      lastRound: null,
      winnerIds: [],
      log: [],
      seq: 0,
    };
    startRound(s);
    return s;
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("游戏已经结束了");

    if (action.type === "nextRound") {
      if (s.phase !== "roundOver") throw new GameError("这一轮还没结束");
      s.round++;
      startRound(s);
      log(s, s.catcherId, `第 ${s.round + 1} 轮开始，当老师 🎓`);
      return;
    }

    if (action.type !== "flick") throw new GameError("未知操作");
    if (s.phase !== "playing") throw new GameError("这一轮已经结束了");
    if (s.currentId !== playerId) throw new GameError("还没轮到你");
    const flick = icClampFlick(action.flick);
    if (!flick) throw new GameError("用力一点再松手");

    const before = s.pieces.map((p) => ({ ...p }));
    const sim = new IcecoolSim(before, playerId, flick);
    const events = sim.run();
    s.pieces = sim.pieces();

    const isCatcher = playerId === s.catcherId;
    const fish: IcShot["fish"] = [];
    const caught: string[] = [];
    for (const e of events) {
      if (e.kind === "door") {
        const target = s.targets[e.pieceId];
        const got = s.collected[e.pieceId];
        if (target?.includes(e.door) && got && !got.includes(e.door)) {
          got.push(e.door);
          s.scores[e.pieceId]!.fish++;
          fish.push({ playerId: e.pieceId, door: e.door });
        }
      } else if (e.kind === "bump" && isCatcher) {
        const other = e.a === playerId ? e.b : e.b === playerId ? e.a : null;
        if (other && !s.caught.includes(other)) {
          s.caught.push(other);
          s.scores[playerId]!.catches++;
          caught.push(other);
        }
      }
    }

    s.shot = { seq: s.seq + 1, shooterId: playerId, flick, before, fish, caught };
    const me = s.pieces.find((p) => p.id === playerId)!;
    const room = IC_ROOMS[icRoomAt(me.x, me.z)]?.name ?? "走廊";
    const parts: string[] = [];
    for (const f of fish) parts.push(f.playerId === playerId ? "抓到一条鱼 🐟" : "把别人撞过门，送了 Ta 一条鱼");
    if (caught.length) parts.push(`抓住了 ${caught.length} 个学生 🚨`);
    log(s, playerId, `滑到了${room}${parts.length ? "，" + parts.join("，") : ""}`);
    s.turn++;

    const done = runners(s).find((id) => (s.collected[id]?.length ?? 0) >= IC_FISH_PER_RUNNER);
    if (done) endRound(s, "抓齐了 3 条鱼", done);
    else if (runners(s).every((id) => s.caught.includes(id))) endRound(s, "老师抓住了所有学生");
    else if (s.turn >= maxTurns(s)) endRound(s, "本轮次数用完了");
    else s.currentId = nextSeat(s, playerId);
  },

  viewFor(s) {
    return {
      gameId: "icecool",
      phase: s.phase,
      order: s.seats,
      round: s.round,
      totalRounds: s.catcherOrder.length,
      catcherId: s.catcherId,
      nextCatcherId: s.catcherOrder[s.round + 1] ?? null,
      currentPlayerId: s.currentId,
      turn: s.turn,
      maxTurns: maxTurns(s),
      pieces: s.pieces,
      targets: s.targets,
      collected: s.collected,
      caught: s.caught,
      scores: s.scores,
      shot: s.shot,
      lastRound: s.lastRound,
      winnerIds: s.winnerIds,
      log: s.log.slice(-20),
    };
  },

  removePlayer(s, playerId) {
    if (!s.seats.includes(playerId)) return true;
    if (s.seats.length <= 2) return false;
    if (s.phase === "ended") return true;
    const next = nextSeat(s, playerId);
    s.seats = s.seats.filter((id) => id !== playerId);
    s.pieces = s.pieces.filter((p) => p.id !== playerId);
    delete s.targets[playerId];
    delete s.collected[playerId];
    s.caught = s.caught.filter((id) => id !== playerId);
    // 还没当过老师的人里去掉 Ta；当前这轮的老师走了，直接结束这一轮
    const upcoming = s.catcherOrder.slice(s.round + 1).filter((id) => id !== playerId);
    s.catcherOrder = [...s.catcherOrder.slice(0, s.round + 1), ...upcoming];
    log(s, playerId, "离开了游戏");
    if (s.catcherId === playerId && s.phase === "playing") {
      endRound(s, "老师离开了");
      return true;
    }
    if (s.currentId === playerId) s.currentId = next;
    return true;
  },
};
