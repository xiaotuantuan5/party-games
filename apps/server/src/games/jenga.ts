import {
  GAMES,
  JENGA_LAYERS,
  JENGA_PER_LAYER,
  jengaCanPull,
  jengaNextTopSlot,
  jengaPullRisk,
  type JengaAction,
  type JengaCollapse,
  type JengaLayers,
  type JengaLogEntry,
  type JengaView,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface State {
  layers: JengaLayers;
  seats: string[];
  currentId: string;
  pulls: number;
  pullCounts: Record<string, number>;
  collapse: JengaCollapse | null;
  loserId: string | null;
  log: JengaLogEntry[];
  seq: number;
}

const LOG_LIMIT = 50;

function log(s: State, entry: Omit<JengaLogEntry, "seq">): void {
  s.log.push({ ...entry, seq: ++s.seq });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function nextSeat(s: State, id: string): string {
  const i = s.seats.indexOf(id);
  return s.seats[(i + 1) % s.seats.length]!;
}

function findBlock(layers: JengaLayers, blockId: number): { layer: number; pos: number } | null {
  for (let layer = 0; layer < layers.length; layer++) {
    const pos = layers[layer]!.indexOf(blockId);
    if (pos >= 0) return { layer, pos };
  }
  return null;
}

export const jenga: GameEngine<State, JengaAction, JengaView> = {
  meta: GAMES.jenga,

  setup(players) {
    const layers: JengaLayers = Array.from({ length: JENGA_LAYERS }, (_, layer) =>
      Array.from({ length: JENGA_PER_LAYER }, (_, pos) => layer * JENGA_PER_LAYER + pos),
    );
    const seats = shuffle(players.map((p) => p.id));
    return {
      layers,
      seats,
      currentId: seats[0]!,
      pulls: 0,
      pullCounts: Object.fromEntries(seats.map((id) => [id, 0])),
      collapse: null,
      loserId: null,
      log: [],
      seq: 0,
    };
  },

  handleAction(s, playerId, action) {
    if (s.loserId) throw new GameError("塔已经倒了");
    if (s.currentId !== playerId) throw new GameError("还没轮到你");
    if (action.type !== "pull") throw new GameError("未知操作");

    const { blockId } = action;
    if (!Number.isInteger(blockId)) throw new GameError("请选择一根木块");
    const from = findBlock(s.layers, blockId);
    if (!from) throw new GameError("没有这根木块");
    if (!jengaCanPull(s.layers, from.layer, from.pos)) throw new GameError("最上面的完整层和它上面的木块不能抽");
    // 手稳程度由客户端的小游戏给出；这是聚会游戏，只做范围校验
    const steadiness = typeof action.steadiness === "number" && Number.isFinite(action.steadiness) ? action.steadiness : 0;
    const clamped = Math.min(1, Math.max(0, steadiness));

    const risk = jengaPullRisk(s.layers, from.layer, from.pos, clamped);
    s.layers[from.layer]![from.pos] = null;

    if (Math.random() < risk) {
      s.collapse = { playerId, blockId, layer: from.layer, pos: from.pos, angle: Math.random() * Math.PI * 2 };
      s.loserId = playerId;
      log(s, { kind: "collapse", playerId, blockId, from, steadiness: clamped, text: "抽木块时把塔推倒了！💥" });
      return;
    }

    const to = jengaNextTopSlot(s.layers);
    if (to.layer === s.layers.length) s.layers.push(Array(JENGA_PER_LAYER).fill(null));
    s.layers[to.layer]![to.pos] = blockId;
    s.pulls++;
    s.pullCounts[playerId] = (s.pullCounts[playerId] ?? 0) + 1;
    log(s, { kind: "pull", playerId, blockId, from, to, steadiness: clamped, text: `从第 ${from.layer + 1} 层抽出一根木块，放到了塔顶` });
    s.currentId = nextSeat(s, playerId);
  },

  viewFor(s) {
    return {
      gameId: "jenga",
      phase: s.loserId ? "ended" : "playing",
      order: s.seats,
      currentPlayerId: s.currentId,
      layers: s.layers,
      pulls: s.pulls,
      pullCounts: s.pullCounts,
      collapse: s.collapse,
      loserId: s.loserId,
      log: s.log.slice(-30),
    };
  },

  removePlayer(s, playerId) {
    if (s.loserId || !s.seats.includes(playerId)) return true;
    const next = nextSeat(s, playerId);
    s.seats = s.seats.filter((id) => id !== playerId);
    if (s.seats.length === 0) return false;
    if (s.currentId === playerId) s.currentId = next;
    log(s, { kind: "leave", playerId, text: "离开了游戏" });
    return true;
  },
};
