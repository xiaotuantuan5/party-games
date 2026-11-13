import * as THREE from "three";

/**
 * 2D 水墨画面的基础：投影、可绘制节点、颜色和笔触工具。
 *
 * 游戏逻辑仍然用三维坐标：x 横向、y 高度、z 纵深（负值离镜头远）。
 * 画到屏幕上时用斜投影：z 越小（越远）画得越靠上，像 DNF 那样的横版走位。
 * three.js 在这里只当数学库用（向量、矩阵、骨骼层级），不负责渲染。
 */

/** 纵深每 1 个单位在屏幕上抬高多少（世界单位） */
export const DEPTH = 0.32;

/** 绘制层级：数字越大画得越靠后（越在上面） */
export const LAYER = {
  /** 地面上的东西：影子、预警圈、地面墨迹 */
  GROUND: 0,
  /** 角色、道具、掉落物，按纵深排序 */
  ENTITY: 1,
  /** 技能特效 */
  FX: 2,
  /** 粒子、刀光拖尾 */
  TOP: 3,
  /** 伤害数字 */
  UI: 4,
} as const;

/** 当前帧的镜头和画布信息 */
export class View {
  /** 画布的 CSS 像素尺寸 */
  W = 1;
  H = 1;
  /** 设备像素比（画布实际分辨率 / CSS 像素） */
  dpr = 1;
  /** 1 个世界单位等于多少 CSS 像素（未缩放时） */
  S = 60;
  zoom = 1;
  /** 屏幕中心对应的世界坐标（camY 是“有效高度”，已经算上了纵深的抬高） */
  camX = 0;
  camY = 0;
  /** 震屏偏移（CSS 像素） */
  offX = 0;
  offY = 0;
  /** 画质：0 低、1 中、2 高。低画质关掉辉光和纸纹 */
  quality = 2;
  /** 当前时间（秒），给需要自己动的东西用 */
  time = 0;
  /** 这一帧还能画几个带光晕的特效（光晕很费，一帧最多画这么多） */
  glowBudget = 0;

  get k(): number {
    return this.S * this.zoom;
  }

  /** 屏幕上半宽对应多少世界单位 */
  get halfWorldW(): number {
    return this.W / 2 / this.k;
  }

  px(x: number): number {
    return this.W / 2 + this.offX + (x - this.camX) * this.k;
  }

  /** 有效高度 h（= y - z * DEPTH）对应的屏幕 y */
  pyEff(h: number): number {
    return this.H / 2 + this.offY - (h - this.camY) * this.k;
  }

  py(y: number, z: number): number {
    return this.pyEff(y - z * DEPTH);
  }

  /** 把世界坐标投影到屏幕，结果写进 out[0]、out[1] */
  project(x: number, y: number, z: number, out: number[]): number[] {
    out[0] = this.px(x);
    out[1] = this.py(y, z);
    return out;
  }
}

/**
 * 可以画到屏幕上的场景节点。继承 Object3D，所以位置、旋转、缩放、父子关系都和以前一样用，
 * 只是不再交给 WebGL 渲染，而是每帧调用 draw 画到 Canvas 上。
 */
export abstract class Node2D extends THREE.Object3D {
  layer: number = LAYER.ENTITY;
  abstract draw(g: CanvasRenderingContext2D, v: View): void;
  /** 同一层里按这个值从小到大画（默认是纵深 z，越远越先画） */
  depth(): number {
    return this.position.z;
  }
}

// ================= 颜色 =================

const cssCache = new Map<number, string>();

/** 0xRRGGBB → "#rrggbb"（带缓存，避免每帧拼字符串） */
export function css(hex: number): string {
  let s = cssCache.get(hex);
  if (!s) {
    s = "#" + (hex & 0xffffff).toString(16).padStart(6, "0");
    cssCache.set(hex, s);
  }
  return s;
}

export function mixHex(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k);
  const gg = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k);
  const bb = (a & 255) + (((b & 255) - (a & 255)) * k);
  return (Math.round(r) << 16) | (Math.round(gg) << 8) | Math.round(bb);
}

/** 颜色的亮度（0~1），用来判断要不要给浅色特效垫一层墨色 */
export function luma(hex: number): number {
  return (0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255;
}

// ================= 形状 =================

/** 两头粗细不同的一段肢体：四边形加两端的圆 */
export function seg(g: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, w0: number, w1: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / L;
  const ny = dx / L;
  g.beginPath();
  g.moveTo(ax + (nx * w0) / 2, ay + (ny * w0) / 2);
  g.lineTo(bx + (nx * w1) / 2, by + (ny * w1) / 2);
  g.arc(bx, by, w1 / 2, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true);
  g.lineTo(ax - (nx * w0) / 2, ay - (ny * w0) / 2);
  g.arc(ax, ay, w0 / 2, Math.atan2(-ny, -nx), Math.atan2(-ny, -nx) + Math.PI, true);
  g.closePath();
  g.fill();
}

export function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  g.fill();
}

// ================= 随机 =================

/** 可复现的随机数，背景每次进同一个房间画出来都一样 */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ================= 笔触 =================

/**
 * 干笔：沿一条贝塞尔曲线画很多条细丝，每条有断续，模拟毛笔的飞白。
 * 只在搭背景时用（比较费），不要每帧调用。
 */
export function dryBrush(
  g: CanvasRenderingContext2D,
  R: () => number,
  p: [number, number, number, number, number, number, number, number],
  width: number,
  color: string,
  alpha: number,
  bristles = 36,
): void {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const dx = x3 - x0;
  const dy = y3 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  g.save();
  g.strokeStyle = color;
  g.lineCap = "round";
  for (let i = 0; i < bristles; i++) {
    const o = (i / Math.max(1, bristles - 1) - 0.5) * width;
    g.globalAlpha = alpha * (0.25 + R() * 0.75);
    g.lineWidth = (0.6 + R() * 1.6) * (width / bristles) * 1.8;
    g.setLineDash([60 + R() * 340, 2 + R() * 28, 30 + R() * 170, 2 + R() * 22]);
    g.lineDashOffset = R() * 300;
    g.beginPath();
    g.moveTo(x0 + nx * o * 0.3, y0 + ny * o * 0.3);
    g.bezierCurveTo(x1 + nx * o, y1 + ny * o, x2 + nx * o, y2 + ny * o, x3 + nx * o * 0.25, y3 + ny * o * 0.25);
    g.stroke();
  }
  g.restore();
}

/**
 * 把一层剪影的边缘“擦毛”：用透明笔触在边上刮几下，让轮廓像毛笔画的，不像矢量图。
 * 只在搭背景时用。
 */
export function roughen(g: CanvasRenderingContext2D, R: () => number, w: number, h: number, strength = 1): void {
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.lineCap = "round";
  const n = Math.round((w * h) / 9000 * strength);
  for (let i = 0; i < n; i++) {
    const x = R() * w;
    const y = R() * h;
    const len = 20 + R() * 120;
    g.globalAlpha = 0.04 + R() * 0.12;
    g.lineWidth = 0.6 + R() * 2.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (R() - 0.5) * 6);
    g.stroke();
  }
  g.restore();
}

/** 一张小的纸纹贴图，每帧盖在画面上，增加宣纸的颗粒感 */
export function paperGrain(size = 192): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  const R = rng(97);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = R();
    const v = n < 0.5 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.round(Math.abs(n - 0.5) * 2 * 30);
  }
  g.putImageData(img, 0, 0);
  return c;
}
