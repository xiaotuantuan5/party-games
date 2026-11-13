/** 单人游戏：纯前端运行，不需要开房间，最高分存在本机 */

export type SoloGameId = "spaceShooter" | "stickman";

export interface SoloGameMeta {
  id: SoloGameId;
  name: string;
  emoji: string;
  tagline: string;
  tags: string[];
  color: string;
}

export const SOLO_GAMES: Record<SoloGameId, SoloGameMeta> = {
  spaceShooter: {
    id: "spaceShooter",
    name: "星际穿梭",
    emoji: "🚀",
    tagline: "穿越陨石带，击毁巨型战舰",
    tags: ["3D", "射击", "单人"],
    color: "#00c2ff",
  },
  stickman: {
    id: "stickman",
    name: "火柴人刷图",
    emoji: "⚔️",
    tagline: "水墨横版刷图，连招浮空，万剑归宗",
    tags: ["水墨", "动作", "横屏"],
    color: "#ffb03a",
  },
};

export const SOLO_ORDER: SoloGameId[] = ["stickman", "spaceShooter"];

const bestKey = (id: SoloGameId) => `party.solo.${id}.best`;

export function getBest(id: SoloGameId): number {
  return Number(localStorage.getItem(bestKey(id))) || 0;
}

/** 返回是否破了纪录 */
export function saveBest(id: SoloGameId, score: number): boolean {
  if (score <= getBest(id)) return false;
  localStorage.setItem(bestKey(id), String(score));
  return true;
}
