import type { BombCatAction, BombCatView } from "./bombCat.js";
import type { NumberBombAction, NumberBombView } from "./numberBomb.js";
import type { UndercoverAction, UndercoverView } from "./undercover.js";

export * from "./bombCat.js";
export * from "./numberBomb.js";
export * from "./undercover.js";

export type GameId = "numberBomb" | "undercover" | "bombCat";

export interface GameMeta {
  id: GameId;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export const GAMES: Record<GameId, GameMeta> = {
  numberBomb: {
    id: "numberBomb",
    name: "数字炸弹",
    description: "系统在 1~100 中藏一个炸弹数字，大家轮流猜，范围不断缩小，猜中的人“爆炸”出局。",
    minPlayers: 2,
    maxPlayers: 12,
  },
  undercover: {
    id: "undercover",
    name: "谁是卧底",
    description: "平民拿到同一个词，卧底拿到相近的词。轮流描述、投票，找出卧底。",
    minPlayers: 4,
    maxPlayers: 12,
  },
  bombCat: {
    id: "bombCat",
    name: "炸弹猫",
    description: "轮流出牌、摸牌，摸到炸弹猫又没有拆除牌就出局。用攻击、跳过、预言等功能牌躲开炸弹，活到最后的人获胜。",
    minPlayers: 2,
    maxPlayers: 10,
  },
};

export type GameView = NumberBombView | UndercoverView | BombCatView;
export type GameAction = NumberBombAction | UndercoverAction | BombCatAction;
