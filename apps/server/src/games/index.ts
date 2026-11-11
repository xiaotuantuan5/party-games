import type { GameId } from "@party/shared";
import { bombCat } from "./bombCat.js";
import { numberBomb } from "./numberBomb.js";
import type { AnyGameEngine } from "./types.js";
import { undercover } from "./undercover.js";

/** 新游戏在这里注册，并在 @party/shared 的 GAMES 里加元信息 */
export const ENGINES: Record<GameId, AnyGameEngine> = {
  numberBomb,
  undercover,
  bombCat,
};
