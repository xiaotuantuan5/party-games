import {
  CF_MAX_SHOTS,
  GAMES,
  cfBuildBodies,
  cfClampAim,
  cfFrame,
  cfLaunchPoint,
  cfLaunchVelocity,
  cfValidateBuild,
  type CatapultAction,
  type CatapultView,
  type CfBody,
  type CfBuild,
  type CfLogEntry,
  type CfShot,
} from "@party/shared";
import { CatapultSim } from "@party/shared/catapult-sim";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface State {
  seats: string[];
  /** 开战时的座位顺序，决定地块位置，中途有人走了也不变 */
  plots: string[];
  phase: CatapultView["phase"];
  builds: Record<string, CfBuild>;
  ready: string[];
  bodies: CfBody[];
  currentId: string;
  shots: Record<string, number>;
  kills: Record<string, number>;
  shot: CfShot | null;
  winnerIds: string[];
  log: CfLogEntry[];
  seq: number;
}

const LOG_LIMIT = 40;

function log(s: State, playerId: string, text: string): void {
  s.log.push({ seq: ++s.seq, playerId, text });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function aliveCounts(s: State): Record<string, number> {
  const alive: Record<string, number> = Object.fromEntries(s.seats.map((id) => [id, 0]));
  for (const b of s.bodies) if (b.kind === "soldier" && b.owner in alive) alive[b.owner]!++;
  return alive;
}

function startBattle(s: State): void {
  s.plots = [...s.seats];
  s.bodies = [];
  s.plots.forEach((id, seat) => {
    const frame = cfFrame(seat, s.plots.length);
    s.bodies.push(...cfBuildBodies(id, frame, s.builds[id]!, s.bodies.length));
  });
  s.phase = "battle";
  s.currentId = s.seats[0]!;
  log(s, s.currentId, "先发射！开战 ⚔️");
}

/** 看看是不是已经分出胜负；没有的话轮到下一个还有士兵的人 */
function advance(s: State, from: string, aliveBefore: string[]): void {
  const alive = aliveCounts(s);
  const standing = s.seats.filter((id) => alive[id]! > 0);
  if (standing.length <= 1) {
    s.phase = "ended";
    // 最后一发同归于尽：发射前还活着的人算平局
    s.winnerIds = standing.length === 1 ? standing : aliveBefore.filter((id) => s.seats.includes(id));
    return;
  }
  if (standing.every((id) => (s.shots[id] ?? 0) >= CF_MAX_SHOTS)) {
    s.phase = "ended";
    const best = Math.max(...standing.map((id) => alive[id]!));
    s.winnerIds = standing.filter((id) => alive[id] === best);
    return;
  }
  let i = s.seats.indexOf(from);
  for (let k = 0; k < s.seats.length; k++) {
    i = (i + 1) % s.seats.length;
    const id = s.seats[i]!;
    if (alive[id]! > 0 && (s.shots[id] ?? 0) < CF_MAX_SHOTS) {
      s.currentId = id;
      return;
    }
  }
}

export const catapult: GameEngine<State, CatapultAction, CatapultView> = {
  meta: GAMES.catapult,

  setup(players) {
    const seats = shuffle(players.map((p) => p.id));
    return {
      seats,
      plots: [...seats],
      phase: "build",
      builds: {},
      ready: [],
      bodies: [],
      currentId: seats[0]!,
      shots: Object.fromEntries(seats.map((id) => [id, 0])),
      kills: Object.fromEntries(seats.map((id) => [id, 0])),
      shot: null,
      winnerIds: [],
      log: [],
      seq: 0,
    };
  },

  handleAction(s, playerId, action) {
    if (!s.seats.includes(playerId)) throw new GameError("你不在这局游戏里");
    if (s.phase === "ended") throw new GameError("游戏已经结束了");

    if (action.type === "build" || action.type === "unready") {
      if (s.phase !== "build") throw new GameError("已经开战了");
      if (action.type === "unready") {
        s.ready = s.ready.filter((id) => id !== playerId);
        return;
      }
      const build = cfValidateBuild(action.build);
      if (typeof build === "string") throw new GameError(build);
      s.builds[playerId] = build;
      if (!s.ready.includes(playerId)) s.ready.push(playerId);
      if (s.seats.every((id) => s.ready.includes(id))) startBattle(s);
      return;
    }

    if (action.type !== "fire") throw new GameError("未知操作");
    if (s.phase !== "battle") throw new GameError("还在搭城堡");
    if (s.currentId !== playerId) throw new GameError("还没轮到你");
    const aim = cfClampAim(action.aim);
    if (!aim) throw new GameError("瞄准参数不对");

    const seat = s.plots.indexOf(playerId);
    const frame = cfFrame(seat, s.plots.length);
    const p = cfLaunchPoint(frame);
    const from: [number, number, number] = [p.x, p.y, p.z];
    const vel = cfLaunchVelocity(frame, aim);
    const before = s.bodies;
    const aliveBefore = s.seats.filter((id) => aliveCounts(s)[id]! > 0);

    const sim = new CatapultSim(before, from, vel);
    sim.run();
    const result = sim.result();
    s.bodies = result.bodies;
    s.shots[playerId] = (s.shots[playerId] ?? 0) + 1;

    const killed = result.killed.map((b) => ({ id: b.id, owner: b.owner }));
    const enemies = killed.filter((k) => k.owner !== playerId).length;
    const own = killed.length - enemies;
    s.kills[playerId] = (s.kills[playerId] ?? 0) + enemies;
    s.shot = { seq: s.seq + 1, shooterId: playerId, aim, from, vel, before, killed };

    let text = "发射！";
    if (enemies) text += `砸倒了 ${enemies} 个敌人 💥`;
    if (own) text += `${enemies ? "，" : ""}误伤了 ${own} 个自己人 😵`;
    if (!killed.length) text += "没砸到人";
    log(s, playerId, text);
    const alive = aliveCounts(s);
    for (const id of aliveBefore) if (alive[id] === 0) log(s, id, "的士兵全军覆没，出局了 🏳️");

    advance(s, playerId, aliveBefore);
  },

  viewFor(s, playerId) {
    return {
      gameId: "catapult",
      phase: s.phase,
      order: s.phase === "build" ? s.seats : s.plots,
      ready: s.ready,
      myBuild: s.builds[playerId] ?? null,
      currentPlayerId: s.currentId,
      bodies: s.phase === "build" ? [] : s.bodies,
      alive: aliveCounts(s),
      shots: s.shots,
      kills: s.kills,
      shot: s.shot,
      winnerIds: s.winnerIds,
      log: s.log.slice(-20),
    };
  },

  removePlayer(s, playerId) {
    if (!s.seats.includes(playerId)) return true;
    if (s.seats.length <= 2 && s.phase !== "ended") return false;
    s.seats = s.seats.filter((id) => id !== playerId);
    s.ready = s.ready.filter((id) => id !== playerId);
    if (s.phase === "build") {
      s.plots = [...s.seats];
      if (s.seats.every((id) => s.ready.includes(id))) startBattle(s);
      return true;
    }
    if (s.phase === "ended") return true;
    // 走了的人的士兵撤下战场，城堡留着当障碍物
    const aliveBefore = s.seats.filter((id) => aliveCounts(s)[id]! > 0);
    s.bodies = s.bodies.filter((b) => !(b.kind === "soldier" && b.owner === playerId));
    log(s, playerId, "离开了战场");
    const wasCurrent = s.currentId === playerId;
    // 用离开的人在原来座位上的位置往后找下一个
    if (wasCurrent || aliveBefore.length <= 1) {
      const order = [...s.plots];
      const i = order.indexOf(playerId);
      const prev = order.slice(0, i).reverse().find((id) => s.seats.includes(id)) ?? order.slice(i + 1).reverse().find((id) => s.seats.includes(id));
      advance(s, prev ?? s.seats[0]!, aliveBefore);
    }
    return true;
  },
};
