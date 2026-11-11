import { GAMES, type NumberBombAction, type NumberBombView } from "@party/shared";
import { GameError, randomInt, shuffle, type GameEngine } from "./types.js";

interface State {
  bomb: number;
  low: number;
  high: number;
  order: string[];
  turn: number;
  history: { playerId: string; guess: number }[];
  loserId: string | null;
}

const MIN = 1;
const MAX = 100;

export const numberBomb: GameEngine<State, NumberBombAction, NumberBombView> = {
  meta: GAMES.numberBomb,

  setup(players) {
    return {
      bomb: randomInt(MIN, MAX),
      // 开区间：可猜的数是 low+1 .. high-1
      low: MIN - 1,
      high: MAX + 1,
      order: shuffle(players.map((p) => p.id)),
      turn: 0,
      history: [],
      loserId: null,
    };
  },

  handleAction(s, playerId, action) {
    if (s.loserId) throw new GameError("游戏已结束");
    if (action.type !== "guess") throw new GameError("未知操作");
    if (s.order[s.turn] !== playerId) throw new GameError("还没轮到你");

    const v = action.value;
    if (!Number.isInteger(v) || v <= s.low || v >= s.high) {
      throw new GameError(`请输入 ${s.low + 1} ~ ${s.high - 1} 之间的整数`);
    }

    s.history.push({ playerId, guess: v });
    if (v === s.bomb) {
      s.loserId = playerId;
      return;
    }
    if (v < s.bomb) s.low = v;
    else s.high = v;
    s.turn = (s.turn + 1) % s.order.length;
  },

  viewFor(s) {
    const ended = s.loserId !== null;
    return {
      gameId: "numberBomb",
      phase: ended ? "ended" : "playing",
      low: s.low,
      high: s.high,
      order: s.order,
      currentPlayerId: s.order[s.turn]!,
      history: s.history,
      bomb: ended ? s.bomb : null,
      loserId: s.loserId,
    };
  },

  removePlayer(s, playerId) {
    const idx = s.order.indexOf(playerId);
    if (idx === -1) return true;
    s.order.splice(idx, 1);
    if (s.order.length < numberBomb.meta.minPlayers) return false;
    if (idx < s.turn) s.turn--;
    s.turn %= s.order.length;
    return true;
  },
};
