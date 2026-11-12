import {
  GAMES,
  QUEST_CRYSTAL_RADIUS,
  QUEST_CRYSTALS,
  QUEST_FALL_Y,
  QUEST_ISLANDS,
  QUEST_PLATES,
  questInGoal,
  questOnPlate,
  questPlatesNeeded,
  type PlayerInfo,
  type QuestAction,
  type QuestEventKind,
  type QuestLogEntry,
  type QuestMove,
  type QuestView,
} from "@party/shared";
import { GameError, type GameEngine } from "./types.js";

interface QuestState {
  order: string[];
  names: Record<string, string>;
  startedAt: number;
  finishedAt: number | null;
  crystals: (string | null)[];
  plates: (string | null)[];
  gateOpen: boolean;
  inGoal: string[];
  falls: Record<string, number>;
  positions: Record<string, QuestMove>;
  lastWave: Record<string, number>;
  log: QuestLogEntry[];
  seq: number;
}

const LOG_LIMIT = 30;
/** 坐标范围：关卡大约在 x ±20、z 10 ~ -110 之内，留足余量 */
const BOUND = 200;
const WAVE_COOLDOWN_MS = 1500;

function addLog(s: QuestState, kind: QuestEventKind, playerId: string, text: string): void {
  s.log.push({ seq: ++s.seq, kind, playerId, text });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

/** 只接受有限、范围合理的数字，其他一律丢弃 */
function parseMove(data: unknown): QuestMove | null {
  if (typeof data !== "object" || data === null) return null;
  const { x, y, z, ry, anim } = data as Record<string, unknown>;
  const nums = [x, y, z, ry];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < BOUND)) return null;
  if (anim !== 0 && anim !== 1 && anim !== 2 && anim !== 3) return null;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(x as number), y: r(y as number), z: r(z as number), ry: r(ry as number), anim };
}

function spawnPositions(order: string[]): Record<string, QuestMove> {
  const [sx, sy, sz] = QUEST_ISLANDS[0]!.respawn;
  const out: Record<string, QuestMove> = {};
  order.forEach((id, i) => {
    // 在出生点排成一个小半圆，面朝前方
    const a = Math.PI * (0.25 + (0.5 * i) / Math.max(1, order.length - 1));
    const spread = order.length > 1 ? 2 : 0;
    out[id] = { x: sx + Math.cos(a) * spread, y: sy, z: sz + Math.sin(a) * spread * 0.5, ry: Math.PI, anim: 0 };
  });
  return out;
}

/** 根据最新位置重新判定机关、结界、终点。返回状态是否有变化 */
function evaluate(s: QuestState, playerId: string): boolean {
  let changed = false;
  const pos = s.positions[playerId];
  if (!pos) return false;

  // 捡水晶
  QUEST_CRYSTALS.forEach((c, i) => {
    if (s.crystals[i] !== null) return;
    if (Math.hypot(pos.x - c.x, pos.y - c.y, pos.z - c.z) < QUEST_CRYSTAL_RADIUS) {
      s.crystals[i] = playerId;
      addLog(s, "crystal", playerId, "捡到了一颗星辉水晶");
      changed = true;
    }
  });

  // 机关：每块记一个站在上面的人。结界打开后机关就不再变化
  if (!s.gateOpen) {
    const plates = QUEST_PLATES.map((plate, i) => {
      const cur = s.plates[i];
      if (cur && s.positions[cur] && questOnPlate(s.positions[cur]!, plate)) return cur;
      return s.order.find((id) => s.positions[id] && questOnPlate(s.positions[id]!, plate)) ?? null;
    });
    if (plates.some((p, i) => p !== s.plates[i])) {
      s.plates = plates;
      changed = true;
    }
    if (plates.filter(Boolean).length >= questPlatesNeeded(s.order.length)) {
      s.gateOpen = true;
      addLog(s, "gate", playerId, "和队友一起打开了结界！");
    }
  }

  // 终点：所有人同时在光圈里
  const inGoal = s.order.filter((id) => s.positions[id] && questInGoal(s.positions[id]!));
  if (inGoal.length !== s.inGoal.length || inGoal.some((id, i) => id !== s.inGoal[i])) {
    if (inGoal.includes(playerId) && !s.inGoal.includes(playerId)) addLog(s, "goal", playerId, "到达了神像");
    s.inGoal = inGoal;
    changed = true;
  }
  if (s.gateOpen && s.order.length > 0 && inGoal.length === s.order.length && s.finishedAt === null) {
    s.finishedAt = Date.now();
    changed = true;
  }
  return changed;
}

export const quest: GameEngine<QuestState, QuestAction, QuestView> = {
  meta: GAMES.quest,

  setup(players: PlayerInfo[]): QuestState {
    const order = players.map((p) => p.id);
    return {
      order,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      startedAt: Date.now(),
      finishedAt: null,
      crystals: QUEST_CRYSTALS.map(() => null),
      plates: QUEST_PLATES.map(() => null),
      gateOpen: false,
      inGoal: [],
      falls: Object.fromEntries(order.map((id) => [id, 0])),
      positions: spawnPositions(order),
      lastWave: {},
      log: [],
      seq: 0,
    };
  },

  handleAction(s, playerId, action) {
    if (!s.order.includes(playerId)) throw new GameError("你不在这局游戏里");
    if (action.type !== "wave") throw new GameError("未知操作");
    const now = Date.now();
    if (now - (s.lastWave[playerId] ?? 0) < WAVE_COOLDOWN_MS) return;
    s.lastWave[playerId] = now;
    addLog(s, "wave", playerId, "👋");
  },

  move(s, playerId, data) {
    if (s.finishedAt !== null || !s.order.includes(playerId)) return null;
    const move = parseMove(data);
    if (!move) return null;
    const prev = s.positions[playerId];
    s.positions[playerId] = move;
    let changed = false;
    if (prev && prev.y >= QUEST_FALL_Y && move.y < QUEST_FALL_Y) {
      s.falls[playerId] = (s.falls[playerId] ?? 0) + 1;
      addLog(s, "fall", playerId, "掉下去了");
      changed = true;
    }
    if (evaluate(s, playerId)) changed = true;
    return { relay: move, changed };
  },

  viewFor(s): QuestView {
    return {
      gameId: "quest",
      phase: s.finishedAt === null ? "playing" : "ended",
      order: s.order,
      startedAt: s.startedAt,
      serverNow: Date.now(),
      finishedAt: s.finishedAt,
      crystals: s.crystals,
      plates: s.plates,
      platesNeeded: questPlatesNeeded(s.order.length),
      gateOpen: s.gateOpen,
      inGoal: s.inGoal,
      falls: s.falls,
      positions: s.positions,
      log: s.log,
    };
  },

  removePlayer(s, playerId) {
    s.order = s.order.filter((id) => id !== playerId);
    delete s.positions[playerId];
    s.plates = s.plates.map((p) => (p === playerId ? null : p));
    s.inGoal = s.inGoal.filter((id) => id !== playerId);
    if (s.order.length === 0) return false;
    // 人已经不在房间了，前端查不到昵称，所以直接写进文字里
    addLog(s, "leave", playerId, `${s.names[playerId] ?? "有人"} 离开了队伍`);
    // 剩下的人可能已经都在终点了
    if (s.gateOpen && s.finishedAt === null && s.inGoal.length === s.order.length) s.finishedAt = Date.now();
    return true;
  },
};
