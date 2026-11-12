import type { GameId } from "@party/shared";
import { avalon } from "./avalon.js";
import { bombCat } from "./bombCat.js";
import { jenga } from "./jenga.js";
import { liarsBar } from "./liarsBar.js";
import { midway } from "./midway.js";
import { numberBomb } from "./numberBomb.js";
import { quest } from "./quest.js";
import type { AnyGameEngine } from "./types.js";
import { undercover } from "./undercover.js";
import { uno } from "./uno.js";
import { werewolf } from "./werewolf.js";

/** 新游戏在这里注册，并在 @party/shared 的 GAMES 里加元信息 */
export const ENGINES: Record<GameId, AnyGameEngine> = {
  numberBomb,
  undercover,
  bombCat,
  liarsBar,
  uno,
  jenga,
  werewolf,
  avalon,
  midway,
  quest,
};
