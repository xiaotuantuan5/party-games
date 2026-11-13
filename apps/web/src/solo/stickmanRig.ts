import * as THREE from "three";
import { DEPTH, LAYER, Node2D, css, disc, mixHex, seg, type View } from "./ink2d";
import type { Gear } from "./stickmanData";

/**
 * 2D 水墨火柴人。
 *
 * 骨骼还是一组关节层级（three.js 的 Group，只做数学，不渲染）：局部坐标里面朝 +x、头朝 +y。
 * 所有关节只绕 z 轴转：正角度表示往前（+x）摆，所以姿势只写一组角度。
 * 画的时候把关节位置算出来，按朝向左右镜像，投影到屏幕上，再按“剪影”的样子画：
 * 有体积的黑色身体、大圆头、一圈白色轮廓光，主角脖子上一条会飘的红围巾。
 */

export interface Pose {
  /** 髋部上下偏移（蹲下为负） */
  rootY: number;
  /** 上身前倾 */
  lean: number;
  neck: number;
  shL: number;
  elL: number;
  shR: number;
  elR: number;
  hipL: number;
  knL: number;
  hipR: number;
  knR: number;
  /** 武器相对前臂的角度，0 表示顺着前臂方向 */
  wpn: number;
  /** 整个身体绕竖直轴额外转多少（旋风斩用） */
  spinY: number;
  /** 上身相对髋部扭转多少（2D 里只影响前后遮挡） */
  twist: number;
  /** 整个身体绕髋部前后翻（倒地、空翻用），正值是往后仰 */
  roll: number;
}

export type PartialPose = Partial<Pose>;

const UPPER_ARM = 0.42;
const FOREARM = 0.4;
const THIGH = 0.5;
const SHIN = 0.5;
const TORSO = 0.62;
export const HIP_HEIGHT = THIGH + SHIN;

/** 战斗基准姿势：重心压低、两脚前后分开，持刀的手放在身前。技能的关键帧都在这个基础上改 */
export const STANCE: Pose = {
  rootY: -0.14,
  lean: 0.22,
  neck: -0.14,
  shL: 0.85,
  elL: 1.35,
  shR: 0.55,
  elR: 0.55,
  hipL: -0.45,
  knL: -0.28,
  hipR: 0.5,
  knR: -1.05,
  wpn: 0.3,
  spinY: 0,
  twist: 0,
  roll: 0,
};

const KEYS = Object.keys(STANCE) as (keyof Pose)[];

export function pose(over: PartialPose, base: Pose = STANCE): Pose {
  return { ...base, ...over };
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const TAU = Math.PI * 2;

/** 按关键帧插值：keys 是 [时间 0~1, 姿势] 的列表，时间递增 */
export function keyed(p: number, keys: [number, Pose][]): Pose {
  if (p <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, b] = keys[i]!;
    if (p <= t1) {
      const [t0, a] = keys[i - 1]!;
      return mixPose(a, b, smooth((p - t0) / Math.max(1e-6, t1 - t0)));
    }
  }
  return keys[keys.length - 1]![1];
}

/**
 * 两段式腿部 IK：给定脚相对髋关节的位置（x 向前，y 向上为正，脚在髋下方时 y 为负），
 * 算出髋和膝的旋转角。膝朝前弯，和人腿一致。
 */
export function legIK(fx: number, fy: number): { hip: number; knee: number } {
  const L1 = THIGH;
  const L2 = SHIN;
  const d = clamp(Math.hypot(fx, fy), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  const alpha = Math.atan2(fx, -fy);
  const beta = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const gamma = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  return { hip: alpha + beta, knee: gamma - Math.PI };
}

/** 一条腿在跑步周期里的脚位置。duty 是着地时间占比，着地时脚贴地往后滑，摆动时抬起往前 */
function runFoot(u: number, duty: number, stride: number, lift: number, hipH: number): { fx: number; fy: number } {
  const w = ((u % 1) + 1) % 1;
  if (w < duty) {
    const t = w / duty;
    return { fx: stride * (1 - 2 * t), fy: -hipH };
  }
  const t = (w - duty) / (1 - duty);
  const arc = Math.sin(Math.PI * t);
  // 摆动前半段脚跟往后上方踢，后半段向前伸
  return { fx: stride * (-1 + 2 * smooth(t)), fy: -hipH + lift * arc + lift * 0.9 * arc * (1 - t) };
}

/** 敌人用的跑步：步幅小、身体直一点 */
export function runPose(phase: number, base: Pose = STANCE): Pose {
  const u = phase / TAU;
  const c = Math.cos(phase);
  const rootY = -0.1 + 0.03 * Math.cos(2 * phase);
  const hipH = HIP_HEIGHT + rootY;
  const L = (() => {
    const f = runFoot(u, 0.5, 0.34, 0.12, hipH);
    return legIK(f.fx, f.fy);
  })();
  const R = (() => {
    const f = runFoot(u + 0.5, 0.5, 0.34, 0.12, hipH);
    return legIK(f.fx, f.fy);
  })();
  return pose(
    { rootY, lean: 0.25, neck: -0.18, hipL: L.hip, knL: L.knee, hipR: R.hip, knR: R.knee, shL: 0.5 - 0.5 * c, elL: 1.1, shR: 0.4 + 0.45 * c, elR: 0.8, wpn: 0.5, twist: 0.2 * c },
    base,
  );
}

/** 主角跑步时一只脚着地的时间比例，小于 0.5，所以两步之间有一段腾空 */
const HERO_DUTY = 0.36;
const HERO_STRIDE = 0.46;

/**
 * 主角跑步的相位速度（弧度/秒）。按实际速度算，着地的脚相对地面不动、不打滑。
 * speed 是世界坐标里的水平速度，scale 是火柴人的缩放。
 */
export function runRate(speed: number, scale: number): number {
  return Math.max(6, (Math.PI * HERO_DUTY * speed) / (HERO_STRIDE * scale));
}

/**
 * 主角跑步：身体压得很低、很前倾，头抬起看前方；持刀的手拖在身后，刀身朝后放平；
 * 另一只手握拳在身前摆。两腿错开半个周期，中间有腾空，身体着地时下沉。
 */
export function heroRunPose(phase: number): Pose {
  const u = phase / TAU;
  const c = Math.cos(phase);
  const rootY = -0.2 - 0.04 * Math.cos(2 * TAU * (u - HERO_DUTY / 2));
  const hipH = HIP_HEIGHT + rootY;
  const fl = runFoot(u, HERO_DUTY, HERO_STRIDE, 0.16, hipH);
  const fr = runFoot(u + 0.5, HERO_DUTY, HERO_STRIDE, 0.16, hipH);
  const L = legIK(fl.fx, fl.fy);
  const R = legIK(fr.fx, fr.fy);
  return {
    rootY,
    lean: 0.92,
    neck: -0.62,
    hipL: L.hip,
    knL: L.knee,
    hipR: R.hip,
    knR: R.knee,
    // 手臂挂在前倾的上身上，看起来的角度要再减去 lean
    // 握拳的手跟着对侧的腿摆
    shL: 1.25 - 0.7 * c,
    elL: 1.2 + 0.25 * c,
    // 持刀的手往后拖，刀身朝后放平（手臂加刀的总角度减去 lean 约等于 -π/2）
    shR: -0.32 + 0.06 * c,
    elR: -0.18,
    wpn: -0.15 - 0.06 * c,
    spinY: 0,
    twist: 0,
    roll: 0,
  };
}

/**
 * 待机：重心压低，前腿弓、后腿蹬，两只脚踩住地面（用 IK 算腿）。
 * 持刀的手放在身前，刀尖朝前下方；另一只手握拳护在胸前。身体随呼吸起伏，刀尖跟着轻轻晃。
 */
export function idlePose(t: number): Pose {
  const breath = Math.sin(t * 1.9);
  const sway = Math.sin(t * 0.5);
  const rootY = -0.24 + 0.018 * breath + 0.012 * sway;
  const hipH = HIP_HEIGHT + rootY;
  const L = legIK(-0.42, -hipH);
  const R = legIK(0.34, -hipH);
  return {
    rootY,
    lean: 0.28 + 0.02 * Math.sin(t * 1.9 + 0.6),
    neck: -0.22 - 0.02 * breath,
    shL: 0.95 + 0.03 * breath,
    elL: 1.45,
    shR: 0.5 - 0.02 * breath,
    elR: 0.45,
    wpn: 0.22 + 0.05 * Math.sin(t * 1.2),
    hipL: L.hip,
    knL: L.knee,
    hipR: R.hip,
    knR: R.knee,
    spinY: 0,
    twist: 0,
    roll: 0,
  };
}

/** 常用姿势 */
export const P = {
  /** 起跳上升：缩腿，刀往后拖 */
  jumpUp: pose({ rootY: 0, lean: 0.3, neck: -0.3, hipL: 1.35, knL: -2.15, hipR: 0.75, knR: -1.6, shL: 1.3, elL: 1.2, shR: -0.7, elR: -0.3, wpn: -0.3 }),
  /** 下落：腿伸开准备落地，手臂张开保持平衡 */
  fall: pose({ rootY: 0, lean: 0.18, neck: -0.2, hipL: 0.65, knL: -1.0, hipR: -0.15, knR: -0.55, shL: 1.7, elL: 0.6, shR: -0.25, elR: 0.5, wpn: 0.3 }),
  hurt: pose({ lean: -0.45, neck: 0.1, shL: -0.6, elL: 0.3, shR: -0.4, elR: 0.5, hipL: 0.25, knL: -0.2, hipR: -0.25, knR: -0.3, wpn: 1.2 }),
  down: pose({ rootY: -0.86, roll: Math.PI / 2, lean: 0, neck: 0, shL: 2.6, elL: 0.2, shR: 2.9, elR: 0.3, hipL: 0.1, knL: -0.1, hipR: -0.1, knR: -0.2, wpn: 0.3 }),
  crouch: pose({ rootY: -0.42, lean: 0.45, hipL: -0.1, knL: -1.4, hipR: 1.1, knR: -1.3, shL: 0.6, elL: 0.6, shR: 0.5, elR: 0.8 }),
  overhead: pose({ rootY: -0.02, lean: -0.15, neck: -0.2, shR: 3.1, elR: 0.05, wpn: 0, shL: 0.4, elL: 0.3, hipL: -0.3, knL: -0.2, hipR: 0.35, knR: -0.25 }),
};

export type Weapon = "sword" | "club" | "bow" | "hammer" | "spear" | "dagger" | "fist" | "fan" | "none";

/** 主角的缩放 */
export const FIGURE_SCALE = 0.82;
/** 主角是纯墨黑 */
export const FIGURE_COLOR = 0x0b0b0d;

/** 画法：主角是纯黑剪影加轮廓光；敌人是灰色武士；Boss 更大、穿暗红袍 */
export type FigureStyle = "hero" | "samurai" | "boss";

export interface RigOptions {
  color: number;
  /** 以前给自发光用，2D 里不再使用 */
  glow?: number;
  scale?: number;
  /** 缩放身体时保持武器原来的大小 */
  keepWeapon?: boolean;
  /** 头饰，区分角色外形 */
  gear?: Gear;
  weapon: Weapon;
  /** 主角：纯黑剪影、白色轮廓光、红围巾 */
  outline?: boolean;
  style?: FigureStyle;
  hat?: boolean;
  shield?: boolean;
  quiver?: boolean;
  crown?: boolean;
  cape?: boolean;
  /** 主角腰后挂刀鞘 */
  sheath?: boolean;
}

/** 碎裂后飞散的肢体 */
export interface Debris {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

export interface Model {
  readonly group: Node2D;
  /** 0~1，受击闪白 */
  flash(k: number): void;
  /** 元素染色，null 恢复原色 */
  tint(color: number | null, k?: number): void;
  setOpacity(o: number): void;
  shatter(scene: THREE.Object3D, push: THREE.Vector3): Debris[];
  dispose(): void;
}

// ================= 各种画法的尺寸（世界单位，缩放前） =================

interface Build {
  head: number;
  torso: [number, number];
  thigh: [number, number];
  shin: [number, number];
  upper: [number, number];
  fore: [number, number];
  fist: number;
  foot: [number, number, number];
}

const BUILD: Record<FigureStyle, Build> = {
  hero: { head: 0.28, torso: [0.27, 0.36], thigh: [0.24, 0.16], shin: [0.16, 0.09], upper: [0.15, 0.11], fore: [0.115, 0.085], fist: 0.085, foot: [0.1, 0.07, 0.22] },
  samurai: { head: 0.17, torso: [0.32, 0.4], thigh: [0.31, 0.2], shin: [0.17, 0.09], upper: [0.17, 0.13], fore: [0.13, 0.1], fist: 0.085, foot: [0.1, 0.07, 0.22] },
  boss: { head: 0.2, torso: [0.36, 0.46], thigh: [0.32, 0.22], shin: [0.2, 0.11], upper: [0.2, 0.16], fore: [0.16, 0.12], fist: 0.1, foot: [0.12, 0.08, 0.24] },
};

// 关节点在数组里的位置（每个点占 2 个数：世界 x 和有效高度 h）
const J = {
  hip: 0,
  chest: 1,
  neck: 2,
  head: 3,
  shL: 4,
  elL: 5,
  wrL: 6,
  shR: 7,
  elR: 8,
  wrR: 9,
  knL: 10,
  anL: 11,
  toeL: 12,
  knR: 13,
  anR: 14,
  toeR: 15,
  hipL: 16,
  hipR: 17,
} as const;
const NJ = 18;

/** 一条飘带（围巾、披风）：一串点，用 Verlet 积分模拟，跟着锚点甩 */
class Ribbon {
  readonly x: Float32Array;
  readonly y: Float32Array;
  private px: Float32Array;
  private py: Float32Array;
  private ready = false;

  constructor(
    readonly n: number,
    readonly segLen: number,
    private gravity: number,
    private wind: number,
  ) {
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
  }

  reset(ax: number, ay: number, dir: number): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.px[i] = ax - dir * i * this.segLen;
      this.y[i] = this.py[i] = ay - i * this.segLen * 0.15;
    }
    this.ready = true;
  }

  step(dt: number, ax: number, ay: number, facing: number, t: number): void {
    if (!this.ready) this.reset(ax, ay, facing);
    const h = Math.min(1 / 30, Math.max(1 / 240, dt));
    this.x[0] = ax;
    this.y[0] = ay;
    this.px[0] = ax;
    this.py[0] = ay;
    for (let i = 1; i < this.n; i++) {
      const vx = (this.x[i]! - this.px[i]!) * 0.94;
      const vy = (this.y[i]! - this.py[i]!) * 0.94;
      this.px[i] = this.x[i]!;
      this.py[i] = this.y[i]!;
      const k = i / this.n;
      // 风往身后吹，再加一点上下抖动，飘带不会死板地垂着
      const flutter = Math.sin(t * 9 - i * 0.55) * 1.6 + Math.sin(t * 5.3 - i * 0.9) * 0.9;
      this.x[i] = this.x[i]! + vx - facing * this.wind * h * h * (0.6 + k);
      this.y[i] = this.y[i]! + vy - this.gravity * h * h + flutter * h * h * (0.3 + k);
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < this.n; i++) {
        const dx = this.x[i]! - this.x[i - 1]!;
        const dy = this.y[i]! - this.y[i - 1]!;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - this.segLen) / d;
        if (i === 1) {
          this.x[i] = this.x[i]! - dx * diff;
          this.y[i] = this.y[i]! - dy * diff;
        } else {
          this.x[i] = this.x[i]! - dx * diff * 0.5;
          this.y[i] = this.y[i]! - dy * diff * 0.5;
          this.x[i - 1] = this.x[i - 1]! + dx * diff * 0.5;
          this.y[i - 1] = this.y[i - 1]! + dy * diff * 0.5;
        }
      }
    }
  }

  /** 画成一条渐细的带子，wHead 是根部宽度（像素） */
  draw(g: CanvasRenderingContext2D, v: View, wHead: number, wTail: number, fill: string, dark: string): void {
    const n = this.n;
    const sx = new Array<number>(n);
    const sy = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      sx[i] = v.px(this.x[i]!);
      sy[i] = v.pyEff(this.y[i]!);
    }
    const lx: number[] = [];
    const ly: number[] = [];
    const rx: number[] = [];
    const ry: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = sx[b]! - sx[a]!;
      const dy = sy[b]! - sy[a]!;
      const L = Math.hypot(dx, dy) || 1;
      const k = i / (n - 1);
      const w = (wHead + (wTail - wHead) * k) * (0.85 + 0.15 * Math.sin(i * 1.3));
      lx.push(sx[i]! - (dy / L) * w * 0.5);
      ly.push(sy[i]! + (dx / L) * w * 0.5);
      rx.push(sx[i]! + (dy / L) * w * 0.5);
      ry.push(sy[i]! - (dx / L) * w * 0.5);
    }
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(lx[0]!, ly[0]!);
    for (let i = 1; i < n; i++) g.lineTo(lx[i]!, ly[i]!);
    for (let i = n - 1; i >= 0; i--) g.lineTo(rx[i]!, ry[i]!);
    g.closePath();
    g.fill();
    // 一条暗色的折痕，看起来像布料
    g.strokeStyle = dark;
    g.lineWidth = Math.max(1, wHead * 0.12);
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (lx[i]! * 0.65 + rx[i]! * 0.35);
      const y = (ly[i]! * 0.65 + ry[i]! * 0.35);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

const RED = "#c21d24";
const RED_DARK = "#7a0c12";
const BLADE = "#f4f4ef";
const RIM = "#f6f4ee";

class RigNode extends Node2D {
  constructor(private owner: { draw(g: CanvasRenderingContext2D, v: View): void }) {
    super();
    this.layer = LAYER.ENTITY;
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    if (this.visible) this.owner.draw(g, v);
  }
}

/** 碎片：一段肢体或一个圆，跟着自己的位置和旋转画 */
class PieceNode extends Node2D {
  constructor(
    private owner: { opacity: number; fillCss(): string },
    private dx: number,
    private dy: number,
    private w0: number,
    private w1: number,
    private round: boolean,
  ) {
    super();
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    if (this.owner.opacity <= 0.01) return;
    this.updateMatrix();
    const e = this.matrix.elements;
    const ax = v.px(e[12]!);
    const ay = v.py(e[13]!, e[14]!);
    g.save();
    g.globalAlpha = this.owner.opacity;
    g.fillStyle = this.owner.fillCss();
    if (this.round) disc(g, ax, ay, this.w0 * v.k * Math.hypot(e[0]!, e[1]!));
    else {
      const bx = v.px(e[0]! * this.dx + e[4]! * this.dy + e[12]!);
      const by = v.py(e[1]! * this.dx + e[5]! * this.dy + e[13]!, e[14]!);
      seg(g, ax, ay, bx, by, this.w0 * v.k, this.w1 * v.k);
    }
    g.restore();
  }
}

/** 残影：记下当时所有关节的位置，之后照着画一个半透明的剪影 */
export class GhostNode extends Node2D {
  opacity = 0.5;
  constructor(
    private pts: Float32Array,
    private b: Build,
    private s: number,
    private color: string,
    z: number,
  ) {
    super();
    this.layer = LAYER.ENTITY;
    this.position.z = z - 0.01;
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    if (this.opacity <= 0.01) return;
    g.save();
    g.globalAlpha = this.opacity;
    drawBody(g, v, this.pts, this.b, this.s, this.color, [0, 0, 0, 0], 0);
    g.restore();
  }
}

/** 把关节点数组按剪影画出来。order 是四条肢体的前后顺序（0 左臂 1 右臂 2 左腿 3 右腿，负数表示画在身体前面） */
function drawBody(g: CanvasRenderingContext2D, v: View, P: Float32Array, b: Build, s: number, fill: string, zs: number[], grow: number): void {
  const k = v.k * s;
  const X = (i: number) => v.px(P[i * 2]!);
  const Y = (i: number) => v.pyEff(P[i * 2 + 1]!);
  const S = (a: number, c: number, w: [number, number]) => seg(g, X(a), Y(a), X(c), Y(c), w[0] * k + grow, w[1] * k + grow);
  g.fillStyle = fill;
  const arm = (side: 0 | 1) => {
    const [sh, el, wr] = side === 0 ? [J.shL, J.elL, J.wrL] : [J.shR, J.elR, J.wrR];
    S(sh, el, b.upper);
    S(el, wr, b.fore);
    disc(g, X(wr), Y(wr), b.fist * k + grow / 2);
  };
  const leg = (side: 0 | 1) => {
    const [hp, kn, an, toe] = side === 0 ? [J.hipL, J.knL, J.anL, J.toeL] : [J.hipR, J.knR, J.anR, J.toeR];
    S(hp, kn, b.thigh);
    S(kn, an, b.shin);
    S(an, toe, [b.foot[0], b.foot[1]]);
  };
  const order = [0, 1, 2, 3].sort((a, c) => (zs[a] ?? 0) - (zs[c] ?? 0));
  const back = order.filter((i) => (zs[i] ?? 0) < 0);
  const front = order.filter((i) => (zs[i] ?? 0) >= 0);
  for (const i of back) i < 2 ? arm(i as 0 | 1) : leg((i - 2) as 0 | 1);
  S(J.hip, J.chest, b.torso);
  S(J.chest, J.head, [b.torso[1] * 0.42, b.torso[1] * 0.3]);
  disc(g, X(J.head), Y(J.head), b.head * k + grow / 2);
  for (const i of front) i < 2 ? arm(i as 0 | 1) : leg((i - 2) as 0 | 1);
}

const tmpV = new THREE.Vector3();

export class StickRig implements Model {
  readonly group: Node2D;
  /** 骨骼根节点：不放进场景，只用来算关节位置 */
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private shL = new THREE.Group();
  private elL = new THREE.Group();
  private shR = new THREE.Group();
  private elR = new THREE.Group();
  private hipL = new THREE.Group();
  private knL = new THREE.Group();
  private hipR = new THREE.Group();
  private knR = new THREE.Group();
  private weapon = new THREE.Group();
  readonly scale: number;
  private style: FigureStyle;
  private b: Build;
  private opts: RigOptions;
  private baseColor: number;
  private curColor: number;
  private flashK = 0;
  private tintColor: number | null = null;
  private tintK = 0;
  opacity = 1;
  /** 武器尖端和根部（武器局部坐标），用来画刀光拖尾 */
  private tipLocal = new THREE.Vector3(0, -1.3, 0);
  private baseLocal = new THREE.Vector3(0, -0.2, 0);
  private pts = new Float32Array(NJ * 2);
  private zs = [0, 0, 0, 0];
  private facing = 1;
  private scarf: Ribbon | null = null;
  private cape: Ribbon | null = null;
  private lastT = -1;
  private wpnAngle = 0;

  constructor(opts: RigOptions) {
    this.opts = opts;
    this.scale = opts.scale ?? 1;
    this.style = opts.style ?? (opts.outline ? "hero" : opts.crown ? "boss" : "samurai");
    this.b = BUILD[this.style];
    this.baseColor = this.curColor = opts.color;
    this.group = new RigNode(this);

    this.body.add(this.hips);
    this.hips.position.y = HIP_HEIGHT;
    this.hips.add(this.spine);
    this.chest.position.y = TORSO;
    this.spine.add(this.chest);
    this.chest.add(this.neck);
    this.neck.position.y = 0.05;
    for (const [sh, el, z] of [
      [this.shL, this.elL, -0.16],
      [this.shR, this.elR, 0.16],
    ] as const) {
      sh.position.set(0, -0.04, z);
      this.chest.add(sh);
      el.position.y = -UPPER_ARM;
      sh.add(el);
    }
    for (const [hip, kn, z] of [
      [this.hipL, this.knL, -0.1],
      [this.hipR, this.knR, 0.1],
    ] as const) {
      hip.position.z = z;
      this.hips.add(hip);
      kn.position.y = -THIGH;
      hip.add(kn);
    }
    this.weapon.position.y = -FOREARM;
    this.elR.add(this.weapon);
    switch (opts.weapon) {
      case "spear":
        this.tipLocal.set(0, -2.2, 0);
        this.baseLocal.set(0, -0.3, 0);
        break;
      case "dagger":
        this.tipLocal.set(0, -0.55, 0);
        break;
      case "fist":
        this.tipLocal.set(0, -0.1, 0);
        this.baseLocal.set(0, 0, 0);
        break;
      case "fan":
        this.tipLocal.set(0, -0.42, 0);
        this.baseLocal.set(0, -0.05, 0);
        break;
      case "club":
        this.tipLocal.set(0, -0.8, 0);
        break;
      case "hammer":
        this.tipLocal.set(0, -1.1, 0);
        break;
      default:
        break;
    }
    if (this.style === "hero") this.scarf = new Ribbon(13, 0.13 * this.scale, 1.2, 9);
    if (opts.cape) this.cape = new Ribbon(9, (this.style === "boss" ? 0.16 : 0.12) * this.scale, 5, 3);
    this.group.scale.setScalar(this.scale);
    this.apply(STANCE);
  }

  apply(p: Pose): void {
    this.body.rotation.y = p.spinY;
    this.hips.position.y = HIP_HEIGHT + p.rootY;
    this.hips.rotation.z = p.roll;
    this.spine.rotation.z = -p.lean;
    this.spine.rotation.y = p.twist;
    this.neck.rotation.z = -p.neck;
    this.shL.rotation.z = p.shL;
    this.elL.rotation.z = p.elL;
    this.shR.rotation.z = p.shR;
    this.elR.rotation.z = p.elR;
    this.hipL.rotation.z = p.hipL;
    this.knL.rotation.z = p.knL;
    this.hipR.rotation.z = p.hipR;
    this.knR.rotation.z = p.knR;
    this.weapon.rotation.z = p.wpn;
    this.wpnAngle = p.shR + p.elR + p.wpn;
  }

  /** 骨骼局部坐标里的一点 → 世界坐标（按朝向镜像、按缩放放大） */
  private toWorld(obj: THREE.Object3D, x: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(x, y, 0).applyMatrix4(obj.matrixWorld);
    const g = this.group;
    const sx = g.scale.x;
    const sy = g.scale.y;
    return out.set(g.position.x + this.facing * out.x * sx, g.position.y + out.y * sy, g.position.z + out.z * 0.02);
  }

  /** 算出所有关节的世界位置（x 和有效高度），存进 pts */
  private compute(): void {
    const g = this.group;
    this.facing = Math.cos(g.rotation.y) >= 0 ? 1 : -1;
    this.body.updateMatrixWorld(true);
    const P = this.pts;
    const put = (i: number, obj: THREE.Object3D, x: number, y: number) => {
      this.toWorld(obj, x, y, tmpV);
      P[i * 2] = tmpV.x;
      P[i * 2 + 1] = tmpV.y - g.position.z * DEPTH;
    };
    const head = this.b.head;
    put(J.hip, this.hips, 0, 0);
    put(J.chest, this.chest, 0, 0);
    put(J.neck, this.neck, 0, 0);
    put(J.head, this.neck, 0.02, head * 0.85);
    put(J.shL, this.shL, 0, 0);
    put(J.elL, this.elL, 0, 0);
    put(J.wrL, this.elL, 0, -FOREARM);
    put(J.shR, this.shR, 0, 0);
    put(J.elR, this.elR, 0, 0);
    put(J.wrR, this.elR, 0, -FOREARM);
    put(J.hipL, this.hipL, 0, 0);
    put(J.knL, this.knL, 0, 0);
    put(J.anL, this.knL, 0, -SHIN);
    put(J.hipR, this.hipR, 0, 0);
    put(J.knR, this.knR, 0, 0);
    put(J.anR, this.knR, 0, -SHIN);
    // 脚：沿小腿方向转 90 度朝前
    for (const [kn, an, toe] of [
      [J.knL, J.anL, J.toeL],
      [J.knR, J.anR, J.toeR],
    ] as const) {
      const dx = P[an * 2]! - P[kn * 2]!;
      const dy = P[an * 2 + 1]! - P[kn * 2 + 1]!;
      const L = Math.hypot(dx, dy) || 1;
      const f = this.b.foot[2] * g.scale.x;
      // 在屏幕上“朝前”是 facing 方向：把小腿方向旋转 90 度，转向取决于朝向
      P[toe * 2] = P[an * 2]! + (-dy / L) * f * this.facing;
      P[toe * 2 + 1] = P[an * 2 + 1]! + (dx / L) * f * this.facing;
    }
    // 四条肢体的前后：用关节在骨骼里的 z（旋风斩转身时会换过来）
    const zOf = (obj: THREE.Object3D) => tmpV.setFromMatrixPosition(obj.matrixWorld).z;
    this.zs[0] = zOf(this.shL);
    this.zs[1] = zOf(this.shR);
    this.zs[2] = zOf(this.hipL);
    this.zs[3] = zOf(this.hipR);
  }

  /** 刀尖和刀根的世界坐标 */
  weaponEnds(tip: THREE.Vector3, base: THREE.Vector3): void {
    this.facing = Math.cos(this.group.rotation.y) >= 0 ? 1 : -1;
    this.body.updateMatrixWorld(true);
    const ws = this.opts.keepWeapon ? 1 / this.group.scale.x : 1;
    this.toWorld(this.weapon, this.tipLocal.x * ws, this.tipLocal.y * ws, tip);
    this.toWorld(this.weapon, this.baseLocal.x * ws, this.baseLocal.y * ws, base);
    tip.z = base.z = this.group.position.z;
  }

  flash(k: number): void {
    this.flashK = Math.min(1, Math.max(0, k));
  }

  tint(color: number | null, k = 0.8): void {
    this.tintColor = color;
    this.tintK = k;
  }

  setOpacity(o: number): void {
    this.opacity = o;
  }

  /** 碎片用本色（不带受击时的闪白） */
  fillCss(): string {
    return css(this.baseColor);
  }

  /** 轮廓光的颜色：主角的元素染色只染在轮廓光上，身体保持纯黑 */
  private rimCss = RIM;

  private updateColor(): void {
    let c = this.baseColor;
    const hero = this.style === "hero";
    if (this.tintColor !== null && !hero) c = mixHex(c, this.tintColor, this.tintK * 0.6);
    if (this.flashK > 0) c = mixHex(c, 0xffffff, this.flashK * (hero ? 0.35 : 0.85));
    this.curColor = c;
    this.rimCss = this.tintColor !== null && hero ? css(mixHex(0xf6f4ee, this.tintColor, Math.min(1, this.tintK * 1.2))) : RIM;
  }

  draw(g: CanvasRenderingContext2D, v: View): void {
    if (this.opacity <= 0.01) return;
    this.compute();
    this.updateColor();
    const dt = this.lastT < 0 ? 1 / 60 : v.time - this.lastT;
    this.lastT = v.time;
    const P = this.pts;
    const s = this.group.scale.x;
    const k = v.k * s;
    const fill = css(this.curColor);
    const hero = this.style === "hero";
    g.save();
    g.globalAlpha = this.opacity;

    // 影子之外最先画的：身后的东西（披风、刀鞘、箭袋）
    if (this.cape) {
      this.cape.step(dt, P[J.chest * 2]! - this.facing * 0.08 * s, P[J.chest * 2 + 1]! + 0.02 * s, this.facing, v.time);
      this.cape.draw(g, v, 0.42 * k, 0.6 * k, this.style === "boss" ? "#4a0e12" : "#5a1418", "#2a0608");
    }
    if (this.scarf) {
      // 围巾的根在脖子后面
      this.scarf.step(dt, P[J.neck * 2]! - this.facing * 0.06 * s, P[J.neck * 2 + 1]! + 0.03 * s, this.facing, v.time);
    }
    if (this.opts.quiver) this.drawQuiver(g, v, k);
    if (this.opts.sheath) this.drawSheath(g, v, k);

    // 轮廓光：先画一份放大的浅色剪影，偏向光源（左上），再画本体
    const rimGrow = hero ? 3.2 : 2;
    g.save();
    g.globalAlpha = this.opacity * (hero ? 0.95 : 0.55);
    g.translate(-1.2, -1.4);
    drawBody(g, v, P, this.b, s, this.rimCss, this.zs, rimGrow);
    g.restore();
    if (this.scarf) this.scarf.draw(g, v, 0.13 * k, 0.035 * k, RED, RED_DARK);
    // 持刀的手转到身后时（旋风斩转身），刀画在身体后面
    const weaponBehind = this.zs[1]! < -0.05;
    if (weaponBehind) this.drawWeapon(g, v);
    drawBody(g, v, P, this.b, s, fill, this.zs, 0);

    if (this.style !== "hero") this.drawCloth(g, v, k);
    this.drawHead(g, v, k);
    if (!weaponBehind) this.drawWeapon(g, v);
    if (this.opts.shield) this.drawShield(g, v, k);
    if (this.opts.weapon === "bow") this.drawBow(g, v, k);
    g.restore();
  }

  private X(i: number, v: View): number {
    return v.px(this.pts[i * 2]!);
  }
  private Y(i: number, v: View): number {
    return v.pyEff(this.pts[i * 2 + 1]!);
  }

  /** 头：主角是一个大墨点加白边和红围巾；敌人有头巾、斗笠或头盔 */
  private drawHead(g: CanvasRenderingContext2D, v: View, k: number): void {
    const hx = this.X(J.head, v);
    const hy = this.Y(J.head, v);
    const r = this.b.head * k;
    const f = this.facing;
    if (this.style === "hero") {
      g.strokeStyle = this.rimCss;
      g.lineWidth = Math.max(1.5, r * 0.12);
      g.beginPath();
      g.arc(hx - 0.6, hy - 0.6, r + g.lineWidth * 0.4, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = css(this.curColor);
      disc(g, hx, hy, r);
      // 围巾绕在脖子上，盖住下巴
      const nx = this.X(J.neck, v);
      const ny = this.Y(J.neck, v);
      // 围巾的结系在脖子上，压在头下沿
      g.fillStyle = RED;
      g.beginPath();
      g.ellipse(nx * 0.75 + hx * 0.25, ny * 0.7 + (hy + r) * 0.3, r * 0.58, r * 0.24, f * 0.15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = RED_DARK;
      g.beginPath();
      g.ellipse(nx * 0.75 + hx * 0.25 - f * r * 0.2, ny * 0.7 + (hy + r) * 0.3 + r * 0.06, r * 0.3, r * 0.1, 0, 0, Math.PI);
      g.fill();
    }
    const gear = this.opts.gear;
    if (gear === "band") {
      // 红头巾（主角）或黑头巾（敌人），脑后两条短带
      g.strokeStyle = this.style === "hero" ? RED : "#1a1918";
      g.lineWidth = Math.max(2, r * 0.26);
      g.lineCap = "round";
      g.beginPath();
      g.arc(hx, hy, r * 0.92, Math.PI + 0.35, Math.PI * 2 - 0.35);
      g.stroke();
      const bx = hx - f * r * 0.9;
      const by = hy - r * 0.35;
      const sway = Math.sin(v.time * 8 + hx * 0.01) * r * 0.25;
      g.lineWidth = Math.max(1.5, r * 0.16);
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - f * r * 0.8, by - r * 0.5 + sway, bx - f * r * 1.6, by - r * 0.1 + sway);
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - f * r * 0.9, by + r * 0.2 - sway, bx - f * r * 1.4, by + r * 0.7 - sway);
      g.stroke();
    } else if (gear === "mask") {
      // 面罩只露出一道发光的眼缝
      g.fillStyle = "#e8f6ff";
      g.beginPath();
      g.ellipse(hx + f * r * 0.42, hy - r * 0.12, r * 0.34, r * 0.08, 0, 0, Math.PI * 2);
      g.fill();
    } else if (gear === "bun") {
      g.fillStyle = css(this.curColor);
      disc(g, hx - f * r * 0.55, hy - r * 0.85, r * 0.42);
      g.strokeStyle = RED;
      g.lineWidth = Math.max(1.5, r * 0.12);
      g.beginPath();
      g.moveTo(hx - f * r * 1.1, hy - r * 1.05);
      g.lineTo(hx - f * r * 0.05, hy - r * 0.7);
      g.stroke();
    } else if (gear === "helmet") {
      // 铁盔：圆顶加一圈帽檐和护颊
      g.fillStyle = "#24221f";
      g.beginPath();
      g.arc(hx, hy - r * 0.1, r * 1.12, Math.PI, Math.PI * 2);
      g.fill();
      g.fillRect(hx - r * 1.35, hy - r * 0.2, r * 2.7, r * 0.22);
      g.fillRect(hx - f * r * 0.9 - r * 0.25, hy - r * 0.1, r * 0.5, r * 0.9);
    }
    if (this.opts.hat) {
      // 斗笠：一顶宽大的锥形竹帽，压得很低
      g.fillStyle = "#4a4237";
      g.beginPath();
      g.moveTo(hx - r * 2.1, hy - r * 0.15);
      g.quadraticCurveTo(hx, hy - r * 1.6, hx + r * 2.1, hy - r * 0.15);
      g.quadraticCurveTo(hx, hy - r * 0.35, hx - r * 2.1, hy - r * 0.15);
      g.fill();
      g.strokeStyle = "#2c2721";
      g.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(hx, hy - r * 1.05);
        g.lineTo(hx + i * r * 0.85, hy - r * 0.3);
        g.stroke();
      }
    }
    if (this.opts.crown) {
      // Boss：光头，头顶一个金色发冠，下巴一圈络腮胡
      g.fillStyle = "#c9a23a";
      g.fillRect(hx - r * 0.35, hy - r * 1.25, r * 0.7, r * 0.35);
      disc(g, hx, hy - r * 1.3, r * 0.22);
      g.fillStyle = "#141210";
      g.beginPath();
      g.ellipse(hx + f * r * 0.35, hy + r * 0.45, r * 0.6, r * 0.5, 0, 0, Math.PI);
      g.fill();
    }
  }

  /** 敌人的衣服：胸口一块亮一点的布、腰带，Boss 再加一条暗红长袍下摆 */
  private drawCloth(g: CanvasRenderingContext2D, v: View, k: number): void {
    const hx = this.X(J.hip, v);
    const hy = this.Y(J.hip, v);
    const cx = this.X(J.chest, v);
    const cy = this.Y(J.chest, v);
    const f = this.facing;
    const tw = this.b.torso;
    if (this.style === "boss") {
      // 长袍下摆：从腰盖到膝盖
      const kx = (this.X(J.knL, v) + this.X(J.knR, v)) / 2;
      const ky = Math.max(this.Y(J.knL, v), this.Y(J.knR, v));
      g.fillStyle = css(mixHex(0x5a1414, this.curColor, 0.25));
      g.beginPath();
      g.moveTo(hx - tw[0] * k * 0.7, hy);
      g.lineTo(hx + tw[0] * k * 0.7, hy);
      g.lineTo(kx + tw[0] * k * 1.1, ky + 0.05 * k);
      g.lineTo(kx - tw[0] * k * 1.1, ky + 0.05 * k);
      g.closePath();
      g.fill();
      g.fillStyle = css(mixHex(0x6a1a1a, this.curColor, 0.2));
      seg(g, hx, hy, cx, cy, tw[0] * k * 0.95, tw[1] * k * 0.95);
    } else {
      // 胸口的亮面，偏向后背（光从身后打过来）
      g.save();
      g.globalAlpha *= 0.55;
      g.fillStyle = css(mixHex(this.curColor, 0xb8b3aa, 0.45));
      seg(g, hx - f * tw[0] * k * 0.12, hy - 0.08 * k, cx - f * tw[1] * k * 0.15, cy + 0.05 * k, tw[0] * k * 0.45, tw[1] * k * 0.55);
      g.restore();
    }
    // 腰带
    g.strokeStyle = this.style === "boss" ? "#151312" : css(mixHex(this.curColor, 0xd8d2c6, 0.55));
    g.lineWidth = Math.max(2, 0.06 * k);
    g.beginPath();
    g.moveTo(hx - tw[0] * k * 0.55, hy - 0.05 * k);
    g.lineTo(hx + tw[0] * k * 0.55, hy - 0.08 * k);
    g.stroke();
  }

  /** 武器局部坐标里一点 → 屏幕坐标 */
  private wp(x: number, y: number, v: View, out: number[]): number[] {
    const ws = this.opts.keepWeapon ? 1 / this.group.scale.x : 1;
    this.toWorld(this.weapon, x * ws, y * ws, tmpV);
    out[0] = v.px(tmpV.x);
    out[1] = v.pyEff(tmpV.y - this.group.position.z * DEPTH);
    return out;
  }

  private drawWeapon(g: CanvasRenderingContext2D, v: View): void {
    const w = this.opts.weapon;
    if (w === "none" || w === "bow") return;
    const a = [0, 0];
    const b = [0, 0];
    const kk = v.k * (this.opts.keepWeapon ? 1 : this.group.scale.x);
    const hero = this.style === "hero";
    g.save();
    g.lineCap = "round";
    if (w === "sword") {
      // 刀柄（缠红绳）、圆形护手、微弯的白色刀身
      this.wp(0, 0.13, v, a);
      this.wp(0, -0.1, v, b);
      g.fillStyle = "#111";
      seg(g, a[0]!, a[1]!, b[0]!, b[1]!, 0.05 * kk, 0.05 * kk);
      if (hero) {
        g.fillStyle = RED;
        for (const t of [0.08, 0.0, -0.06]) {
          this.wp(0, t, v, a);
          disc(g, a[0]!, a[1]!, 0.018 * kk);
        }
      }
      this.wp(0, -0.11, v, a);
      g.fillStyle = "#1b1b1b";
      disc(g, a[0]!, a[1]!, 0.05 * kk);
      const N = 12;
      const top: number[][] = [];
      const bot: number[][] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const y = -0.13 - 1.12 * t;
        const bend = -0.07 * t * t;
        const half = (0.026 * (1 - t) + 0.006) * 1;
        top.push([...this.wp(bend + half, y, v, [0, 0])]);
        bot.push([...this.wp(bend - half, y, v, [0, 0])]);
      }
      if (hero && v.quality >= 2) {
        g.shadowColor = "rgba(255,255,255,0.95)";
        g.shadowBlur = 12;
      }
      g.fillStyle = hero ? BLADE : "#d9d6cf";
      g.beginPath();
      g.moveTo(top[0]![0]!, top[0]![1]!);
      for (const q of top) g.lineTo(q[0]!, q[1]!);
      for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i]![0]!, bot[i]![1]!);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(60,60,60,0.7)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bot[0]![0]!, bot[0]![1]!);
      for (const q of bot) g.lineTo(q[0]!, q[1]!);
      g.stroke();
    } else if (w === "spear") {
      this.wp(0, 0.5, v, a);
      this.wp(0, -1.9, v, b);
      g.fillStyle = "#151515";
      seg(g, a[0]!, a[1]!, b[0]!, b[1]!, 0.04 * kk, 0.04 * kk);
      this.wp(0, -2.22, v, a);
      if (hero && v.quality >= 2) {
        g.shadowColor = "rgba(255,255,255,0.9)";
        g.shadowBlur = 10;
      }
      g.fillStyle = BLADE;
      seg(g, b[0]!, b[1]!, a[0]!, a[1]!, 0.09 * kk, 0.5);
      g.shadowBlur = 0;
      // 红缨
      this.wp(0, -1.86, v, a);
      g.strokeStyle = RED;
      g.lineWidth = Math.max(1.5, 0.03 * kk);
      const f = this.facing;
      for (let i = 0; i < 4; i++) {
        const sw = Math.sin(v.time * 10 + i) * 0.04 * kk;
        g.beginPath();
        g.moveTo(a[0]!, a[1]!);
        g.quadraticCurveTo(a[0]! - f * 0.1 * kk, a[1]! + 0.08 * kk + sw, a[0]! - f * (0.18 + i * 0.03) * kk, a[1]! + (0.14 + i * 0.03) * kk + sw);
        g.stroke();
      }
    } else if (w === "dagger") {
      this.wp(0, 0.08, v, a);
      this.wp(0, -0.06, v, b);
      g.fillStyle = "#111";
      seg(g, a[0]!, a[1]!, b[0]!, b[1]!, 0.04 * kk, 0.04 * kk);
      this.wp(0, -0.52, v, a);
      g.fillStyle = BLADE;
      if (hero && v.quality >= 2) {
        g.shadowColor = "rgba(255,255,255,0.9)";
        g.shadowBlur = 8;
      }
      seg(g, b[0]!, b[1]!, a[0]!, a[1]!, 0.045 * kk, 0.5);
    } else if (w === "fist") {
      this.wp(0, -0.04, v, a);
      g.fillStyle = "#0d0d0d";
      disc(g, a[0]!, a[1]!, 0.1 * kk);
      this.wp(0, 0.06, v, b);
      g.strokeStyle = RED;
      g.lineWidth = Math.max(2, 0.06 * kk);
      g.beginPath();
      g.moveTo(b[0]! - 0.07 * kk, b[1]!);
      g.lineTo(b[0]! + 0.07 * kk, b[1]!);
      g.stroke();
    } else if (w === "fan") {
      // 展开的折扇：黑色扇面，上面一道红墨，扇骨是细线
      this.wp(0, 0, v, a);
      const N = 9;
      const rim: number[][] = [];
      for (let i = 0; i <= N; i++) {
        const t = -0.65 + (1.3 * i) / N;
        rim.push([...this.wp(Math.sin(t) * 0.44, -Math.cos(t) * 0.44, v, [0, 0])]);
      }
      g.fillStyle = "#121212";
      g.beginPath();
      g.moveTo(a[0]!, a[1]!);
      for (const q of rim) g.lineTo(q[0]!, q[1]!);
      g.closePath();
      g.fill();
      g.strokeStyle = RED;
      g.lineWidth = Math.max(2, 0.06 * kk);
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = -0.55 + (1.1 * i) / N;
        const q = this.wp(Math.sin(t) * 0.33, -Math.cos(t) * 0.33, v, [0, 0]);
        if (i === 0) g.moveTo(q[0]!, q[1]!);
        else g.lineTo(q[0]!, q[1]!);
      }
      g.stroke();
      g.strokeStyle = "rgba(240,240,235,0.55)";
      g.lineWidth = 1;
      for (let i = 0; i <= N; i += 3) {
        g.beginPath();
        g.moveTo(a[0]!, a[1]!);
        g.lineTo(rim[i]![0]!, rim[i]![1]!);
        g.stroke();
      }
    } else if (w === "club") {
      this.wp(0, 0, v, a);
      this.wp(0, -0.8, v, b);
      g.fillStyle = "#3a2c20";
      seg(g, a[0]!, a[1]!, b[0]!, b[1]!, 0.07 * kk, 0.16 * kk);
    } else if (w === "hammer") {
      this.wp(0, 0.1, v, a);
      this.wp(0, -1.0, v, b);
      g.fillStyle = "#2a2622";
      seg(g, a[0]!, a[1]!, b[0]!, b[1]!, 0.07 * kk, 0.07 * kk);
      // 方形锤头，垂直于锤柄
      const c1 = this.wp(-0.26, -1.05, v, [0, 0]);
      const c2 = this.wp(0.26, -1.05, v, [0, 0]);
      g.fillStyle = "#1c1a18";
      seg(g, c1[0]!, c1[1]!, c2[0]!, c2[1]!, 0.36 * kk, 0.36 * kk);
      g.fillStyle = "#5a5650";
      seg(g, c1[0]!, c1[1]!, c2[0]!, c2[1]!, 0.1 * kk, 0.1 * kk);
    }
    g.restore();
  }

  /** 腰后横挂的黑色刀鞘，带一截红绳 */
  private drawSheath(g: CanvasRenderingContext2D, v: View, k: number): void {
    this.body.updateMatrixWorld(true);
    const a = this.toWorld(this.hips, -0.06, 0.06, new THREE.Vector3());
    const b = this.toWorld(this.hips, -0.95, -0.12, new THREE.Vector3());
    const dz = this.group.position.z * DEPTH;
    const ax = v.px(a.x);
    const ay = v.pyEff(a.y - dz);
    const bx = v.px(b.x);
    const by = v.pyEff(b.y - dz);
    g.save();
    g.fillStyle = "#0e0e10";
    seg(g, ax, ay, bx, by, 0.065 * k, 0.05 * k);
    g.fillStyle = RED;
    seg(g, ax + (bx - ax) * 0.06, ay + (by - ay) * 0.06, ax + (bx - ax) * 0.16, ay + (by - ay) * 0.16, 0.07 * k, 0.07 * k);
    seg(g, ax + (bx - ax) * 0.9, ay + (by - ay) * 0.9, bx, by, 0.055 * k, 0.05 * k);
    g.restore();
  }

  private drawQuiver(g: CanvasRenderingContext2D, v: View, k: number): void {
    this.body.updateMatrixWorld(true);
    const a = this.toWorld(this.spine, -0.18, 0.62, new THREE.Vector3());
    const b = this.toWorld(this.spine, -0.12, 0.05, new THREE.Vector3());
    const dz = this.group.position.z * DEPTH;
    const ax = v.px(a.x);
    const ay = v.pyEff(a.y - dz);
    const bx = v.px(b.x);
    const by = v.pyEff(b.y - dz);
    g.save();
    g.fillStyle = "#3a2e22";
    seg(g, ax, ay, bx, by, 0.15 * k, 0.12 * k);
    g.strokeStyle = "#d8d2c6";
    g.lineWidth = Math.max(1, 0.02 * k);
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(ax + (i - 1) * 0.04 * k, ay);
      g.lineTo(ax + (i - 1) * 0.06 * k - this.facing * 0.04 * k, ay - 0.16 * k);
      g.stroke();
    }
    g.restore();
  }

  /** 藤牌：拿在左手，挡在身前 */
  private drawShield(g: CanvasRenderingContext2D, v: View, k: number): void {
    const x = this.X(J.wrL, v) + this.facing * 0.06 * k;
    const y = this.Y(J.wrL, v);
    g.save();
    g.fillStyle = "#4e4434";
    g.beginPath();
    g.ellipse(x, y, 0.16 * k, 0.38 * k, this.facing * 0.08, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#2e281f";
    g.lineWidth = Math.max(1, 0.025 * k);
    for (const r of [0.28, 0.18, 0.08]) {
      g.beginPath();
      g.ellipse(x, y, (0.16 * r) / 0.38 * k + 0.02 * k, r * k, this.facing * 0.08, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#1c1915";
    disc(g, x, y, 0.05 * k);
    g.restore();
  }

  /** 弓：拿在左手，弓背朝前 */
  private drawBow(g: CanvasRenderingContext2D, v: View, k: number): void {
    const wx = this.X(J.wrL, v);
    const wy = this.Y(J.wrL, v);
    const ex = this.X(J.elL, v);
    const ey = this.Y(J.elL, v);
    const dx = wx - ex;
    const dy = wy - ey;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;
    const ny = dx / L;
    const r = 0.45 * k;
    g.save();
    g.strokeStyle = "#2a1f16";
    g.lineWidth = Math.max(2, 0.05 * k);
    g.beginPath();
    g.moveTo(wx + nx * r, wy + ny * r);
    g.quadraticCurveTo(wx + (dx / L) * r * 0.9, wy + (dy / L) * r * 0.9, wx - nx * r, wy - ny * r);
    g.stroke();
    g.strokeStyle = "rgba(230,226,216,0.8)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(wx + nx * r, wy + ny * r);
    g.lineTo(wx - nx * r, wy - ny * r);
    g.stroke();
    g.restore();
  }

  shatter(scene: THREE.Object3D, push: THREE.Vector3): Debris[] {
    this.compute();
    const P = this.pts;
    const s = this.group.scale.x;
    const z = this.group.position.z;
    const out: Debris[] = [];
    const b = this.b;
    const piece = (i: number, j: number, w: [number, number] | null, r = 0) => {
      const ax = P[i * 2]!;
      const ay = P[i * 2 + 1]! + z * DEPTH;
      const node = w
        ? new PieceNode(this, P[j * 2]! - ax, P[j * 2 + 1]! + z * DEPTH - ay, w[0] * s, w[1] * s, false)
        : new PieceNode(this, 0, 0, r * s, r * s, true);
      node.position.set(ax, ay, z);
      scene.add(node);
      out.push({
        mesh: node,
        vel: new THREE.Vector3(push.x * (0.5 + Math.random()) + (Math.random() - 0.5) * 3, 3 + Math.random() * 5 + push.y, (Math.random() - 0.5) * 2),
        // 2D 里只绕 z 轴翻滚，另外两个轴转一点点，看起来像在翻
        spin: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 16),
        life: 1.6,
      });
    };
    piece(J.hip, J.chest, b.torso);
    piece(J.head, J.head, null, b.head);
    piece(J.shL, J.elL, b.upper);
    piece(J.elL, J.wrL, b.fore);
    piece(J.shR, J.elR, b.upper);
    piece(J.elR, J.wrR, b.fore);
    piece(J.hipL, J.knL, b.thigh);
    piece(J.knL, J.anL, b.shin);
    piece(J.hipR, J.knR, b.thigh);
    piece(J.knR, J.anR, b.shin);
    this.group.removeFromParent();
    return out;
  }

  /** 复制一个半透明的残影（放在当前位置，不再跟着动） */
  ghost(color: number, opacity: number): GhostNode {
    this.compute();
    const node = new GhostNode(Float32Array.from(this.pts), this.b, this.group.scale.x, css(color), this.group.position.z);
    node.opacity = opacity;
    return node;
  }

  /** 主角的刀尖指向（弧度，从正下方量起，正值朝前），给特效对齐用 */
  get weaponAngle(): number {
    return this.wpnAngle;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/** 火药傀儡：木头小人，胸口绑着火药罐，引线冒着火星 */
export class BugModel implements Model {
  readonly group: Node2D;
  private base: number;
  private cur: number;
  private flashK = 0;
  private tintColor: number | null = null;
  private tintK = 0;
  opacity = 1;
  private legPhase = 0;
  private bob = 0;
  private swell = 1;
  private fuse = 0;
  private t = 0;

  constructor(color: number, private s = 1) {
    this.base = this.cur = color;
    this.group = new RigNode(this);
    this.group.scale.setScalar(s);
  }

  animate(t: number, moving: boolean, fuse: number): void {
    this.t = t;
    this.legPhase = moving ? t * 22 : 0;
    this.bob = moving ? Math.abs(Math.sin(t * 22)) * 0.06 : 0;
    this.swell = fuse > 0 ? 1 + fuse * 0.35 : 1;
    this.fuse = fuse;
  }

  fillCss(): string {
    return css(this.cur);
  }

  draw(g: CanvasRenderingContext2D, v: View): void {
    if (this.opacity <= 0.01) return;
    let c = this.base;
    if (this.tintColor !== null) c = mixHex(c, this.tintColor, this.tintK * 0.6);
    if (this.flashK > 0) c = mixHex(c, 0xffffff, this.flashK * 0.85);
    if (this.fuse > 0 && Math.sin(this.t * (10 + this.fuse * 30)) > 0) c = mixHex(c, 0xe83a1a, 0.7);
    this.cur = c;
    const gp = this.group.position;
    const f = Math.cos(this.group.rotation.y) >= 0 ? 1 : -1;
    const k = v.k * this.s;
    const x = v.px(gp.x);
    const ground = v.py(gp.y, gp.z);
    const y = ground - (0.6 + this.bob) * k;
    const sw = this.swell;
    g.save();
    g.globalAlpha = this.opacity;
    g.lineCap = "round";
    // 两条木腿
    g.strokeStyle = css(mixHex(c, 0x000000, 0.25));
    g.lineWidth = 0.09 * k;
    for (const side of [-1, 1]) {
      const a = Math.sin(this.legPhase + (side > 0 ? 0 : Math.PI)) * 0.45;
      g.beginPath();
      g.moveTo(x + side * 0.12 * k, y + 0.2 * k);
      g.lineTo(x + side * 0.12 * k + Math.sin(a) * 0.4 * k * f, ground);
      g.stroke();
    }
    // 轮廓光
    g.fillStyle = RIM;
    g.globalAlpha = this.opacity * 0.5;
    disc(g, x - 1.2, y - 1.2, 0.36 * k * sw + 1.5);
    g.globalAlpha = this.opacity;
    // 身子和头
    g.fillStyle = css(c);
    g.beginPath();
    g.ellipse(x, y, 0.32 * k * sw, 0.36 * k * sw, 0, 0, Math.PI * 2);
    g.fill();
    disc(g, x + f * 0.05 * k, y - 0.5 * k * sw, 0.17 * k);
    // 火药罐
    g.fillStyle = "#2a2522";
    g.beginPath();
    g.ellipse(x + f * 0.16 * k * sw, y + 0.04 * k, 0.17 * k * sw, 0.2 * k * sw, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = RED;
    g.fillRect(x + f * 0.16 * k * sw - 0.09 * k, y - 0.02 * k, 0.18 * k, 0.08 * k);
    // 引线和火星
    const fx = x + f * 0.2 * k;
    const fy = y - 0.18 * k * sw;
    g.strokeStyle = "#1a1714";
    g.lineWidth = Math.max(1, 0.025 * k);
    g.beginPath();
    g.moveTo(fx, fy);
    g.quadraticCurveTo(fx + f * 0.1 * k, fy - 0.12 * k, fx + f * 0.06 * k, fy - 0.22 * k);
    g.stroke();
    g.fillStyle = Math.sin(this.t * 30) > 0 ? "#ffcf5a" : "#ff6a2a";
    disc(g, fx + f * 0.06 * k, fy - 0.24 * k, (0.04 + (this.fuse > 0 ? 0.04 : 0)) * k);
    g.restore();
  }

  flash(k: number): void {
    this.flashK = Math.min(1, Math.max(0, k));
  }

  tint(color: number | null, k = 0.8): void {
    this.tintColor = color;
    this.tintK = k;
  }

  setOpacity(o: number): void {
    this.opacity = o;
  }

  shatter(scene: THREE.Object3D, push: THREE.Vector3): Debris[] {
    const gp = this.group.position;
    const out: Debris[] = [];
    const add = (dx: number, dy: number, r: number, len = 0) => {
      const node = len > 0 ? new PieceNode(this, 0, -len, r, r * 0.8, false) : new PieceNode(this, 0, 0, r, r, true);
      node.position.set(gp.x + dx * this.s, gp.y + dy * this.s, gp.z);
      scene.add(node);
      out.push({
        mesh: node,
        vel: new THREE.Vector3(push.x + (Math.random() - 0.5) * 5, 4 + Math.random() * 4, (Math.random() - 0.5) * 2),
        spin: new THREE.Vector3(Math.random() * 2, Math.random() * 2, (Math.random() - 0.5) * 14),
        life: 1.2,
      });
    };
    add(0, 0.6, 0.32 * this.s);
    add(0.05, 1.1, 0.17 * this.s);
    add(-0.12, 0.4, 0.09 * this.s, 0.4 * this.s);
    add(0.12, 0.4, 0.09 * this.s, 0.4 * this.s);
    this.group.removeFromParent();
    return out;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
