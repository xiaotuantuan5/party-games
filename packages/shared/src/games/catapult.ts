/**
 * Catapult Feud 投石大战：每人在自己的地块上用方块搭城堡、安排士兵，
 * 然后轮流用投石机发射石弹，把别人的士兵砸倒、砸下城楼。
 *
 * 物理模拟（cannon-es）在 ./catapultSim.ts，单独作为 @party/shared/catapult-sim 导出，
 * 这样首页不会把物理引擎打包进去。
 */

/** 地块 5 列 × 3 排，第 0 排是最前面（朝向场地中央） */
export const CF_COLS = 5;
export const CF_ROWS = 3;
export const CF_CELLS = CF_COLS * CF_ROWS;
export const CF_MAX_HEIGHT = 4;
export const CF_BLOCKS = 16;
export const CF_SOLDIERS = 3;
/** 方块边长，相邻格子之间留一点缝 */
export const CF_BLOCK = 1;
export const CF_CELL = 1.04;
export const CF_SOLDIER_HALF = { x: 0.17, y: 0.38, z: 0.17 };
export const CF_STONE_R = 0.32;
/** 每人最多发射几次，打完还没分出胜负就比剩下的士兵 */
export const CF_MAX_SHOTS = 10;
/** 场地边界，飞出去的方块和士兵会被移走 */
export const CF_ARENA = 32;
export const CF_GRAVITY = 12;

export const CF_YAW_RANGE = 50;
export const CF_PITCH_MIN = 15;
export const CF_PITCH_MAX = 70;
export const CF_SPEED_MIN = 9;
export const CF_SPEED_MAX = 24;

export interface CfBuild {
  /** 每格方块的层数，下标 = row * CF_COLS + col */
  heights: number[];
  /** 士兵站在哪几格（站在那一格最上面） */
  soldiers: number[];
}

export function cfValidateBuild(b: unknown): CfBuild | string {
  const raw = b as Partial<CfBuild> | null;
  if (!raw || !Array.isArray(raw.heights) || !Array.isArray(raw.soldiers)) return "城堡数据不对";
  if (raw.heights.length !== CF_CELLS) return "城堡数据不对";
  const heights = raw.heights.map(Number);
  if (heights.some((h) => !Number.isInteger(h) || h < 0 || h > CF_MAX_HEIGHT)) return `每格最多叠 ${CF_MAX_HEIGHT} 层`;
  const total = heights.reduce((a, h) => a + h, 0);
  if (total > CF_BLOCKS) return `最多用 ${CF_BLOCKS} 块砖`;
  const soldiers = raw.soldiers.map(Number);
  if (soldiers.length !== CF_SOLDIERS) return `要安排 ${CF_SOLDIERS} 个士兵`;
  if (soldiers.some((s) => !Number.isInteger(s) || s < 0 || s >= CF_CELLS)) return "士兵位置不对";
  if (new Set(soldiers).size !== soldiers.length) return "一格只能站一个士兵";
  return { heights, soldiers };
}

/** 几个现成的城堡，懒得搭可以直接用 */
export const CF_PRESETS: { name: string; build: CfBuild }[] = [
  {
    name: "城墙",
    // 前排一道高墙，士兵躲在后面
    build: { heights: [3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], soldiers: [10, 12, 14] },
  },
  {
    name: "瞭望塔",
    build: { heights: [1, 1, 2, 1, 1, 0, 0, 4, 0, 0, 0, 0, 4, 0, 0], soldiers: [7, 5, 9] },
  },
  {
    name: "碉堡",
    build: { heights: [2, 2, 2, 2, 2, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0], soldiers: [6, 7, 8] },
  },
  {
    name: "迷魂阵",
    build: { heights: [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 1, 0, 1, 0, 1], soldiers: [1, 3, 12] },
  },
];

export function cfRandomBuild(): CfBuild {
  const heights = Array<number>(CF_CELLS).fill(0);
  let left = CF_BLOCKS;
  let guard = 0;
  while (left > 0 && guard++ < 200) {
    // 前两排更容易放砖，像城墙
    const row = Math.random() < 0.75 ? Math.floor(Math.random() * 2) : 2;
    const i = row * CF_COLS + Math.floor(Math.random() * CF_COLS);
    if (heights[i]! < CF_MAX_HEIGHT) {
      heights[i]!++;
      left--;
    }
  }
  const cells = [...Array(CF_CELLS).keys()].sort(() => Math.random() - 0.5);
  // 士兵尽量站在后排
  cells.sort((a, b) => Math.floor(b / CF_COLS) - Math.floor(a / CF_COLS));
  return { heights, soldiers: cells.slice(0, CF_SOLDIERS) };
}

export interface CfFrame {
  /** 城堡中心 */
  x: number;
  z: number;
  /** 朝向场地中央的单位向量 */
  fx: number;
  fz: number;
}

/** 第 seat 个人的地块位置。2 人面对面，3~4 人围成一圈 */
export function cfFrame(seat: number, n: number): CfFrame {
  const r = n <= 2 ? 11 : 12.5;
  const a = Math.PI / 2 + (seat / n) * Math.PI * 2;
  const x = Math.round(Math.cos(a) * r * 1e4) / 1e4;
  const z = Math.round(Math.sin(a) * r * 1e4) / 1e4;
  const len = Math.sqrt(x * x + z * z);
  return { x, z, fx: -x / len, fz: -z / len };
}

/** 地块上第 cell 格的世界坐标（格子中心，地面高度） */
export function cfCellPos(frame: CfFrame, cell: number): { x: number; z: number } {
  const col = cell % CF_COLS;
  const row = Math.floor(cell / CF_COLS);
  // 右手方向：前方顺时针转 90°
  const rx = -frame.fz;
  const rz = frame.fx;
  const lx = (col - (CF_COLS - 1) / 2) * CF_CELL;
  const lf = ((CF_ROWS - 1) / 2 - row) * CF_CELL;
  return { x: frame.x + rx * lx + frame.fx * lf, z: frame.z + rz * lx + frame.fz * lf };
}

/** 投石机的发射点：城堡正后方高处 */
export function cfLaunchPoint(frame: CfFrame): { x: number; y: number; z: number } {
  return { x: frame.x - frame.fx * 3.6, y: 5.4, z: frame.z - frame.fz * 3.6 };
}

export interface CfAim {
  /** 左右偏转，度，0 = 正对场地中央，正数往右 */
  yaw: number;
  /** 仰角，度 */
  pitch: number;
  /** 力度 0~1 */
  power: number;
}

export function cfClampAim(a: CfAim): CfAim | null {
  const yaw = Number(a?.yaw);
  const pitch = Number(a?.pitch);
  const power = Number(a?.power);
  if (![yaw, pitch, power].every(Number.isFinite)) return null;
  return {
    yaw: Math.max(-CF_YAW_RANGE, Math.min(CF_YAW_RANGE, yaw)),
    pitch: Math.max(CF_PITCH_MIN, Math.min(CF_PITCH_MAX, pitch)),
    power: Math.max(0, Math.min(1, power)),
  };
}

/** 瞄准参数 → 初速度。服务端算好后把速度原样发给前端，前端不用再算三角函数 */
export function cfLaunchVelocity(frame: CfFrame, aim: CfAim): [number, number, number] {
  const yaw = (aim.yaw * Math.PI) / 180;
  const pitch = (aim.pitch * Math.PI) / 180;
  const speed = CF_SPEED_MIN + (CF_SPEED_MAX - CF_SPEED_MIN) * aim.power;
  // 前方向量往右转 yaw
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = frame.fx * c - frame.fz * s;
  const dz = frame.fz * c + frame.fx * s;
  const h = Math.cos(pitch) * speed;
  return [dx * h, Math.sin(pitch) * speed, dz * h];
}

export type CfBodyKind = "block" | "soldier";

export interface CfBody {
  id: number;
  kind: CfBodyKind;
  owner: string;
  /** 位置 */
  p: [number, number, number];
  /** 四元数 x y z w */
  q: [number, number, number, number];
  /** 士兵刚站好时的高度，掉下去超过半格算阵亡 */
  baseY?: number;
}

export function cfBuildBodies(owner: string, frame: CfFrame, build: CfBuild, firstId: number): CfBody[] {
  const bodies: CfBody[] = [];
  let id = firstId;
  // 方块和地块方向对齐
  const yaw = Math.atan2(frame.fx, frame.fz);
  const q: [number, number, number, number] = [0, Math.round(Math.sin(yaw / 2) * 1e6) / 1e6, 0, Math.round(Math.cos(yaw / 2) * 1e6) / 1e6];
  build.heights.forEach((h, cell) => {
    const { x, z } = cfCellPos(frame, cell);
    for (let k = 0; k < h; k++) {
      bodies.push({ id: id++, kind: "block", owner, p: [x, k * CF_BLOCK + CF_BLOCK / 2, z], q: [...q] });
    }
  });
  for (const cell of build.soldiers) {
    const { x, z } = cfCellPos(frame, cell);
    const y = build.heights[cell]! * CF_BLOCK + CF_SOLDIER_HALF.y + 0.002;
    bodies.push({ id: id++, kind: "soldier", owner, p: [x, y, z], q: [...q], baseY: y });
  }
  return bodies;
}

export interface CfShot {
  seq: number;
  shooterId: string;
  aim: CfAim;
  /** 发射点和初速度 */
  from: [number, number, number];
  vel: [number, number, number];
  /** 发射前的所有物体，前端从这里开始重放物理 */
  before: CfBody[];
  /** 这一发砸倒的士兵：士兵 id → 主人 */
  killed: { id: number; owner: string }[];
}

export interface CfLogEntry {
  seq: number;
  playerId: string;
  text: string;
}

export interface CatapultView {
  gameId: "catapult";
  phase: "build" | "battle" | "ended";
  order: string[];
  /** 搭建阶段：谁已经搭好了 */
  ready: string[];
  /** 自己交上去的城堡（搭建阶段只能看到自己的） */
  myBuild: CfBuild | null;
  currentPlayerId: string;
  /** 场上所有方块和还活着的士兵 */
  bodies: CfBody[];
  /** 每人还剩几个士兵 */
  alive: Record<string, number>;
  /** 每人发射了几次 */
  shots: Record<string, number>;
  /** 每人砸倒了几个敌人 */
  kills: Record<string, number>;
  shot: CfShot | null;
  winnerIds: string[];
  log: CfLogEntry[];
}

export type CatapultAction =
  | { gameId: "catapult"; type: "build"; build: CfBuild }
  | { gameId: "catapult"; type: "unready" }
  | { gameId: "catapult"; type: "fire"; aim: CfAim };
