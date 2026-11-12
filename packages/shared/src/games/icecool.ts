/**
 * ICECOOL 冰企鹅：俯视看是一块 30 × 20 的冰面，被墙隔成 2 × 3 个房间，墙上开门。
 * 企鹅是圆盘，弹出去之后在冰面上滑、撞墙反弹、互相碰撞。
 *
 * 物理只用加减乘除和开平方（IEEE 754 保证各平台结果完全一致），
 * 所以服务端算出结果后，前端用同样的输入重新模拟一遍做动画，最后停下的位置和服务端一模一样。
 */

export const IC_W = 30;
export const IC_D = 20;
export const IC_PENGUIN_R = 0.9;
/** 墙厚 */
export const IC_WALL_T = 0.5;
/** 墙高（只用于画面） */
export const IC_WALL_H = 1.4;
/** 门宽（两根门柱中心的距离） */
export const IC_DOOR_W = 3.6;
/** 弹出去的最大速度（单位 / 秒） */
export const IC_MAX_SPEED = 26;
/** 每个学生每轮要抓的鱼 */
export const IC_FISH_PER_RUNNER = 3;
/** 每轮最多弹多少次（按人数乘），防止一轮停不下来 */
export const IC_TURNS_PER_PLAYER = 6;

const STEP = 1 / 120;
const FRICTION = 7.5;
const DRAG = 0.3;
const WALL_BOUNCE = 0.55;
const PENGUIN_BOUNCE = 0.85;
const CURVE = 0.85;
const SPIN_DECAY = 0.5;
const STOP_SPEED = 0.05;
const MAX_TIME = 12;

export interface IcSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface IcDoor extends IcSeg {
  id: number;
  /** 门中心 */
  x: number;
  z: number;
  /** 门所在的墙是竖的（沿 z 方向）还是横的 */
  vertical: boolean;
}

export interface IcRoom {
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const IC_ROOMS: IcRoom[] = [
  { name: "厨房", x0: 0, z0: 0, x1: 10, z1: 10 },
  { name: "教室", x0: 10, z0: 0, x1: 20, z1: 10 },
  { name: "图书馆", x0: 20, z0: 0, x1: 30, z1: 10 },
  { name: "音乐室", x0: 0, z0: 10, x1: 10, z1: 20 },
  { name: "操场", x0: 10, z0: 10, x1: 20, z1: 20 },
  { name: "食堂", x0: 20, z0: 10, x1: 30, z1: 20 },
];

/** 学生从厨房出发，老师从操场出发 */
export const IC_RUNNER_START = { x: 5, z: 5 };
export const IC_CATCHER_START = { x: 15, z: 15 };

/** [墙所在的坐标, 起点, 终点, 门中心...] */
const VERTICAL_WALLS: [number, number, number, number[]][] = [
  [10, 0, 10, [4]],
  [10, 10, 20, [15.5]],
  [20, 0, 10, [6]],
  [20, 10, 20, [16]],
];
const HORIZONTAL_WALLS: [number, number, number, number[]][] = [
  [10, 0, 10, [4.5]],
  [10, 10, 20, [15]],
  [10, 20, 30, [25.5]],
];

function buildLayout(): { walls: IcSeg[]; doors: IcDoor[] } {
  const walls: IcSeg[] = [
    { ax: 0, az: 0, bx: IC_W, bz: 0 },
    { ax: IC_W, az: 0, bx: IC_W, bz: IC_D },
    { ax: IC_W, az: IC_D, bx: 0, bz: IC_D },
    { ax: 0, az: IC_D, bx: 0, bz: 0 },
  ];
  const doors: IcDoor[] = [];
  const half = IC_DOOR_W / 2;
  for (const [x, z0, z1, gaps] of VERTICAL_WALLS) {
    let start = z0;
    for (const g of gaps) {
      walls.push({ ax: x, az: start, bx: x, bz: g - half });
      doors.push({ id: doors.length, ax: x, az: g - half, bx: x, bz: g + half, x, z: g, vertical: true });
      start = g + half;
    }
    walls.push({ ax: x, az: start, bx: x, bz: z1 });
  }
  for (const [z, x0, x1, gaps] of HORIZONTAL_WALLS) {
    let start = x0;
    for (const g of gaps) {
      walls.push({ ax: start, az: z, bx: g - half, bz: z });
      doors.push({ id: doors.length, ax: g - half, az: z, bx: g + half, bz: z, x: g, z, vertical: false });
      start = g + half;
    }
    walls.push({ ax: start, az: z, bx: x1, bz: z });
  }
  return { walls, doors };
}

const LAYOUT = buildLayout();
export const IC_WALLS: IcSeg[] = LAYOUT.walls;
export const IC_DOORS: IcDoor[] = LAYOUT.doors;

export function icRoomAt(x: number, z: number): number {
  return IC_ROOMS.findIndex((r) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1);
}

/** 开局摆放：学生在厨房围成一圈，老师在操场中间 */
export function icStartPieces(runners: string[], catcherId: string): IcPiece[] {
  const offsets = [
    [-1.6, -1.6],
    [1.6, -1.6],
    [-1.6, 1.6],
    [1.6, 1.6],
    [0, 0],
    [0, -2.6],
    [-2.6, 0],
  ];
  const pieces: IcPiece[] = runners.map((id, i) => {
    const [dx, dz] = offsets[i % offsets.length]!;
    return { id, x: IC_RUNNER_START.x + dx!, z: IC_RUNNER_START.z + dz! };
  });
  pieces.push({ id: catcherId, x: IC_CATCHER_START.x, z: IC_CATCHER_START.z });
  return pieces;
}

export interface IcPiece {
  id: string;
  x: number;
  z: number;
}

/** spin：-1 向左拐，0 直线，1 向右拐（从企鹅自己的视角看） */
export interface IcFlick {
  vx: number;
  vz: number;
  spin: number;
}

export type IcSimEvent =
  | { kind: "door"; pieceId: string; door: number }
  | { kind: "bump"; a: string; b: string; speed: number }
  | { kind: "wall"; pieceId: string; speed: number };

interface Body {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  spin: number;
}

/** 两条线段是否相交（含端点）。只用乘法和比较，结果和平台无关 */
function crosses(px: number, pz: number, qx: number, qz: number, d: IcSeg): boolean {
  const o = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = o(d.ax, d.az, d.bx, d.bz, px, pz);
  const d2 = o(d.ax, d.az, d.bx, d.bz, qx, qz);
  const d3 = o(px, pz, qx, qz, d.ax, d.az);
  const d4 = o(px, pz, qx, qz, d.bx, d.bz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 固定步长的模拟器。服务端一口气跑完，前端每帧跑几步做动画 */
export class IcecoolSim {
  readonly bodies: Body[];
  time = 0;
  done = false;

  constructor(pieces: IcPiece[], shooterId: string, flick: IcFlick) {
    this.bodies = pieces.map((p) => ({ id: p.id, x: p.x, z: p.z, vx: 0, vz: 0, spin: 0 }));
    const b = this.bodies.find((p) => p.id === shooterId);
    if (b) {
      b.vx = flick.vx;
      b.vz = flick.vz;
      b.spin = flick.spin;
    }
  }

  pieces(): IcPiece[] {
    return this.bodies.map((b) => ({ id: b.id, x: b.x, z: b.z }));
  }

  step(): IcSimEvent[] {
    if (this.done) return [];
    const events: IcSimEvent[] = [];
    const dt = STEP;

    for (const b of this.bodies) {
      const s = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      if (s === 0) continue;
      const dec = (FRICTION + DRAG * s) * dt;
      if (dec >= s) {
        b.vx = 0;
        b.vz = 0;
        b.spin = 0;
        continue;
      }
      let k = (s - dec) / s;
      if (b.spin !== 0 && s > 1) {
        // 拐弯：速度方向转一个小角度，再把大小拉回来
        const a = b.spin * CURVE * dt;
        const nx = b.vx - b.vz * a;
        const nz = b.vz + b.vx * a;
        const ns = Math.sqrt(nx * nx + nz * nz);
        b.vx = nx;
        b.vz = nz;
        k = (s - dec) / ns;
        b.spin -= b.spin * SPIN_DECAY * dt;
      }
      b.vx *= k;
      b.vz *= k;
    }

    for (const b of this.bodies) {
      if (b.vx === 0 && b.vz === 0) continue;
      const ox = b.x;
      const oz = b.z;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      for (const d of IC_DOORS) if (crosses(ox, oz, b.x, b.z, d)) events.push({ kind: "door", pieceId: b.id, door: d.id });
    }

    // 企鹅之间：等质量弹性碰撞
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.bodies[i]!;
        const c = this.bodies[j]!;
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        const d2 = dx * dx + dz * dz;
        const min = IC_PENGUIN_R * 2;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-9 ? dx / d : 1;
        const nz = d > 1e-9 ? dz / d : 0;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        c.x += nx * push;
        c.z += nz * push;
        const rel = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
        if (rel < 0) {
          const j2 = (-(1 + PENGUIN_BOUNCE) * rel) / 2;
          a.vx -= j2 * nx;
          a.vz -= j2 * nz;
          c.vx += j2 * nx;
          c.vz += j2 * nz;
          a.spin *= 0.3;
          c.spin *= 0.3;
          events.push({ kind: "bump", a: a.id, b: c.id, speed: -rel });
        }
      }
    }

    // 墙：把企鹅推出来，法向速度反弹
    const reach = IC_PENGUIN_R + IC_WALL_T / 2;
    for (const b of this.bodies) {
      for (const w of IC_WALLS) {
        const ex = w.bx - w.ax;
        const ez = w.bz - w.az;
        const len2 = ex * ex + ez * ez;
        let t = ((b.x - w.ax) * ex + (b.z - w.az) * ez) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = w.ax + ex * t;
        const cz = w.az + ez * t;
        const dx = b.x - cx;
        const dz = b.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        // 正好压在墙线上时，按墙的法线方向推出去
        let nx: number;
        let nz: number;
        if (d > 1e-9) {
          nx = dx / d;
          nz = dz / d;
        } else {
          const el = Math.sqrt(len2);
          nx = -ez / el;
          nz = ex / el;
        }
        b.x = cx + nx * reach;
        b.z = cz + nz * reach;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= (1 + WALL_BOUNCE) * vn * nx;
          b.vz -= (1 + WALL_BOUNCE) * vn * nz;
          b.spin *= 0.5;
          if (-vn > 2) events.push({ kind: "wall", pieceId: b.id, speed: -vn });
        }
      }
    }

    this.time += dt;
    const moving = this.bodies.some((b) => b.vx * b.vx + b.vz * b.vz > STOP_SPEED * STOP_SPEED);
    if (!moving || this.time >= MAX_TIME) {
      for (const b of this.bodies) {
        b.vx = 0;
        b.vz = 0;
        b.spin = 0;
      }
      this.done = true;
    }
    return events;
  }

  run(): IcSimEvent[] {
    const all: IcSimEvent[] = [];
    while (!this.done) all.push(...this.step());
    return all;
  }
}

/** 把弹射速度限制在合法范围内 */
export function icClampFlick(f: IcFlick): IcFlick | null {
  const vx = Number(f?.vx);
  const vz = Number(f?.vz);
  const spin = Number(f?.spin);
  if (![vx, vz, spin].every(Number.isFinite)) return null;
  const s = Math.sqrt(vx * vx + vz * vz);
  if (s < 0.5) return null;
  const k = s > IC_MAX_SPEED ? IC_MAX_SPEED / s : 1;
  return { vx: vx * k, vz: vz * k, spin: Math.max(-1, Math.min(1, spin)) };
}

export interface IcScore {
  fish: number;
  catches: number;
}

export interface IcShot {
  seq: number;
  shooterId: string;
  flick: IcFlick;
  /** 弹之前所有企鹅的位置，前端从这里开始重放 */
  before: IcPiece[];
  /** 这一下抓到的鱼 */
  fish: { playerId: string; door: number }[];
  /** 这一下被老师抓到的学生 */
  caught: string[];
}

export interface IcLogEntry {
  seq: number;
  playerId: string;
  text: string;
}

export interface IcRoundResult {
  round: number;
  catcherId: string;
  reason: string;
  /** reason 说的是谁（比如谁抓齐了鱼） */
  playerId?: string;
  /** 本轮每人得分 */
  gained: Record<string, number>;
}

export interface IcecoolView {
  gameId: "icecool";
  /** roundOver：一轮结束，看完结算后点“下一轮” */
  phase: "playing" | "roundOver" | "ended";
  order: string[];
  /** 从 0 开始 */
  round: number;
  totalRounds: number;
  catcherId: string;
  /** 下一轮谁当老师，最后一轮是 null */
  nextCatcherId: string | null;
  currentPlayerId: string;
  /** 本轮已经弹了几次 / 最多几次 */
  turn: number;
  maxTurns: number;
  pieces: IcPiece[];
  /** 每个学生本轮要抓的鱼在哪几扇门 */
  targets: Record<string, number[]>;
  /** 已经抓到的 */
  collected: Record<string, number[]>;
  /** 本轮被老师抓到过的学生 */
  caught: string[];
  scores: Record<string, IcScore>;
  shot: IcShot | null;
  lastRound: IcRoundResult | null;
  winnerIds: string[];
  log: IcLogEntry[];
}

export type IcecoolAction = { gameId: "icecool"; type: "flick"; flick: IcFlick } | { gameId: "icecool"; type: "nextRound" };
