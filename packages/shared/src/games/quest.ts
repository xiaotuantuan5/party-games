/**
 * 秘境闯关：多人实时 3D 合作闯关。
 *
 * 和回合制游戏不同，这里每个人的移动是实时的：
 * - 角色移动、跳跃、滑翔由各自的客户端计算（客户端权威），每秒约 12 次把位置发给服务端，服务端转发给同房间其他人。
 * - 服务端根据收到的位置判定会影响所有人的事件：捡水晶、踩机关、开结界、全员到达终点。
 *
 * 关卡数据前后端共用：服务端用来判定，前端用来渲染和做碰撞。坐标单位是米，y 向上，前进方向是 -z。
 */

/** 实时位置包，尽量小 */
export interface QuestMove {
  x: number;
  y: number;
  z: number;
  /** 朝向（绕 y 轴的弧度） */
  ry: number;
  /** 0 站立 1 跑 2 空中 3 滑翔 */
  anim: 0 | 1 | 2 | 3;
}

/** 可以站上去、会挡路的实体。box 用最小 / 最大角点表示；cyl 是竖直圆柱 */
export type QuestSolid =
  | { kind: "box"; min: [number, number, number]; max: [number, number, number]; look: "wood" | "stone" | "rune" }
  | { kind: "cyl"; x: number; z: number; r: number; top: number; bottom: number; look: "island" | "pillar" };

export interface QuestIsland {
  x: number;
  z: number;
  r: number;
  top: number;
  /** 掉下去以后回到这里 */
  respawn: [number, number, number];
}

export interface QuestPoint {
  x: number;
  y: number;
  z: number;
}

export const QUEST_ISLANDS: QuestIsland[] = [
  { x: 0, z: 0, r: 9, top: 0, respawn: [0, 0, 5] },
  { x: 0, z: -31, r: 8, top: 1.5, respawn: [0, 1.5, -26] },
  { x: 0, z: -64, r: 9, top: 1.5, respawn: [0, 1.5, -57.5] },
  { x: 2, z: -96, r: 9, top: 0, respawn: [2, 0, -90] },
];

const pillar = (x: number, z: number, top: number, r = 1.4): QuestSolid => ({
  kind: "cyl",
  x,
  z,
  r,
  top,
  bottom: top - 7,
  look: "pillar",
});

/** 方形石台：中心 (x, z)，边长 size，顶面高度 top */
const step = (x: number, z: number, top: number, size = 2.4): QuestSolid => ({
  kind: "box",
  min: [x - size / 2, top - 4, z - size / 2],
  max: [x + size / 2, top, z + size / 2],
  look: "stone",
});

export const QUEST_SOLIDS: QuestSolid[] = [
  ...QUEST_ISLANDS.map(
    (i): QuestSolid => ({ kind: "cyl", x: i.x, z: i.z, r: i.r, top: i.top, bottom: i.top - 1, look: "island" }),
  ),
  // 第一段：跳石柱
  pillar(0, -11.6, 0.6),
  pillar(2, -14.9, 1.1),
  pillar(-0.6, -18.1, 1.6),
  pillar(0.8, -21.3, 1.5),
  // 第二段：结界后面的石桥
  { kind: "box", min: [-1.6, 0.9, -55.5], max: [1.6, 1.5, -38], look: "wood" },
  // 结界两边的石柱
  { kind: "box", min: [-3.4, -1, -43.2], max: [-2.5, 7.5, -41.8], look: "rune" },
  { kind: "box", min: [2.5, -1, -43.2], max: [3.4, 7.5, -41.8], look: "rune" },
  // 第三段：往上跳到高台
  step(-5, -66.5, 2.6),
  step(-6, -69.6, 3.7),
  step(-4, -72.2, 4.8),
  step(-1, -73.6, 5.9),
  step(2, -73.1, 7),
  { kind: "box", min: [3.5, -3, -76], max: [7.5, 8.1, -71], look: "stone" },
];

/** 结界：两块机关同时有人站时打开，打开前是一堵墙 */
export const QUEST_GATE: Extract<QuestSolid, { kind: "box" }> = {
  kind: "box",
  min: [-2.5, 1.5, -43],
  max: [2.5, 7, -42],
  look: "rune",
};

export const QUEST_PLATES: QuestPoint[] = [
  { x: -3.5, y: 1.5, z: -31 },
  { x: 3.5, y: 1.5, z: -31 },
];
export const QUEST_PLATE_RADIUS = 1.3;

/** 水晶的位置是底部，模型浮在上面一点 */
export const QUEST_CRYSTALS: QuestPoint[] = [
  { x: -5, y: 0, z: -3 },
  { x: 2, y: 1.1, z: -14.9 },
  { x: 0.8, y: 1.5, z: -21.3 },
  { x: -5, y: 1.5, z: -28 },
  { x: 5, y: 1.5, z: -28 },
  { x: 0, y: 1.5, z: -48 },
  { x: -6, y: 1.5, z: -60 },
  { x: 6, y: 1.5, z: -63 },
  { x: -4, y: 4.8, z: -72.2 },
  { x: 5.5, y: 8.1, z: -73.5 },
  // 滑翔路上的空中水晶
  { x: 4.5, y: 6, z: -81 },
  { x: 7, y: 0, z: -98 },
];
export const QUEST_CRYSTAL_RADIUS = 1.5;

export const QUEST_GOAL = { x: 2, y: 0, z: -99, r: 3.5 };

/** 史莱姆绕圈巡逻，位置只由时间决定，所以各端不用同步也能看到一样的画面 */
export const QUEST_SLIMES = [
  { x: -1, y: 1.5, z: -61, r: 2.5, speed: 0.7, phase: 0 },
  { x: 3, y: 1.5, z: -67, r: 2.4, speed: -0.9, phase: 2 },
  { x: 0, y: 1.5, z: -30, r: 2, speed: 0.5, phase: 1 },
];

export function questSlimePos(i: number, seconds: number): QuestPoint {
  const s = QUEST_SLIMES[i]!;
  const a = s.phase + seconds * s.speed;
  return { x: s.x + Math.cos(a) * s.r, y: s.y, z: s.z + Math.sin(a) * s.r };
}

/** 掉到这个高度以下算掉出地图 */
export const QUEST_FALL_Y = -12;

export function questOnPlate(p: QuestMove, plate: QuestPoint): boolean {
  return Math.hypot(p.x - plate.x, p.z - plate.z) < QUEST_PLATE_RADIUS && Math.abs(p.y - plate.y) < 0.6;
}

export function questInGoal(p: QuestMove): boolean {
  return Math.hypot(p.x - QUEST_GOAL.x, p.z - QUEST_GOAL.z) < QUEST_GOAL.r && Math.abs(p.y - QUEST_GOAL.y) < 1.5;
}

/** 需要同时踩住几块机关：一般是 2 块，只剩 1 个人时 1 块就够 */
export function questPlatesNeeded(players: number): number {
  return Math.min(QUEST_PLATES.length, Math.max(1, players));
}

export type QuestEventKind = "crystal" | "gate" | "fall" | "goal" | "wave" | "leave";

export interface QuestLogEntry {
  seq: number;
  kind: QuestEventKind;
  playerId: string;
  text: string;
}

export interface QuestView {
  gameId: "quest";
  phase: "playing" | "ended";
  order: string[];
  /** 服务端时间（毫秒）。前端用 serverNow 估算时钟差，让史莱姆在各端位置一致 */
  startedAt: number;
  serverNow: number;
  finishedAt: number | null;
  /** 每颗水晶被谁捡走了 */
  crystals: (string | null)[];
  /** 每块机关上站着谁 */
  plates: (string | null)[];
  platesNeeded: number;
  gateOpen: boolean;
  inGoal: string[];
  falls: Record<string, number>;
  /** 每个人最后一次上报的位置，刚进来 / 重连时用来摆放角色 */
  positions: Record<string, QuestMove>;
  log: QuestLogEntry[];
}

export type QuestAction = { gameId: "quest"; type: "wave" };
