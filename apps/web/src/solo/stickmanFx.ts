import * as THREE from "three";
import { LAYER, Node2D, css, luma, seg, type View } from "./ink2d";

/**
 * 火柴人刷图的特效（2D 水墨版）：粒子、刀光 / 冲击波这类一次性特效、闪电、刀光拖尾、伤害数字。
 * 特效仍然按三维位置和旋转摆放（和以前的调用方式一样），画的时候投影到屏幕上：
 * 竖着的刀光照原样画，平放在地上的圆环会压扁成椭圆。
 */

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ============ 粒子 ============

export interface EmitOpts {
  speed: number;
  life: number;
  /** 重力（向下为正） */
  gravity?: number;
  /** 额外向上的初速度 */
  up?: number;
  /** 发射范围半径 */
  spread?: number;
  /** 只往上半球发射 */
  upward?: boolean;
}

const puffCache = new Map<string, HTMLCanvasElement>();

/** 柔边的一团墨烟（中间浓、边缘化开），每种颜色只画一次 */
function puffSprite(color: string): HTMLCanvasElement {
  let c = puffCache.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  // 几个错开的柔边圆叠在一起，边缘不是正圆
  for (const [dx, dy, r, a] of [
    [0, 0, 30, 0.55],
    [-7, 4, 20, 0.5],
    [8, -3, 18, 0.5],
    [2, 8, 14, 0.4],
  ] as const) {
    const grd = g.createRadialGradient(32 + dx, 32 + dy, 0, 32 + dx, 32 + dy, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, color + "00");
    g.globalAlpha = a;
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  puffCache.set(color, c);
  return c;
}

/** 一组粒子。size 小于 0.3 的画成细小的墨点和火星，大的画成一团团墨烟 */
export class Particles {
  readonly points: Node2D;
  private pos: Float32Array;
  private vel: Float32Array;
  private grav: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private color: string[];
  private dark: Uint8Array;
  private next = 0;
  private alive = 0;
  /** 画质低时少发一半 */
  density = 1;

  constructor(
    private n: number,
    private size: number,
  ) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.grav = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.color = new Array<string>(n).fill("#000");
    this.dark = new Uint8Array(n);
    const self = this;
    class PointsNode extends Node2D {
      override layer = LAYER.TOP;
      draw(g: CanvasRenderingContext2D, v: View): void {
        self.draw(g, v);
      }
    }
    this.points = new PointsNode();
  }

  emit(at: THREE.Vector3, count: number, color: THREE.Color | number, o: EmitOpts): void {
    const hex = typeof color === "number" ? color : color.getHex();
    const c = css(hex);
    const dark = luma(hex) < 0.35 ? 1 : 0;
    const total = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < total; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const u = o.upward ? Math.random() : Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = o.speed * (0.25 + Math.random() * 0.75);
      const sp = o.spread ?? 0;
      const i3 = i * 3;
      this.pos[i3] = at.x + rand(-sp, sp);
      this.pos[i3 + 1] = at.y + rand(-sp, sp) * 0.5;
      this.pos[i3 + 2] = at.z + rand(-sp, sp) * 0.5;
      this.vel[i3] = r * Math.cos(th) * s;
      this.vel[i3 + 1] = u * s + (o.up ?? 0);
      this.vel[i3 + 2] = r * Math.sin(th) * s;
      this.color[i] = c;
      this.dark[i] = dark;
      this.grav[i] = o.gravity ?? 0;
      this.maxLife[i] = this.life[i] = o.life * (0.5 + Math.random() * 0.5);
    }
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - 2 * dt);
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) continue;
      alive++;
      const i3 = i * 3;
      this.vel[i3 + 1] = this.vel[i3 + 1]! - this.grav[i]! * dt;
      for (let c = 0; c < 3; c++) {
        this.pos[i3 + c] = this.pos[i3 + c]! + this.vel[i3 + c]! * dt;
        this.vel[i3 + c] = this.vel[i3 + c]! * drag;
      }
      if (this.pos[i3 + 1]! < 0.02) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] = Math.abs(this.vel[i3 + 1]!) * 0.3;
      }
    }
    this.alive = alive;
  }

  private draw(g: CanvasRenderingContext2D, v: View): void {
    if (!this.alive) return;
    const k = v.k;
    const puff = this.size >= 0.3;
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      const t = life / this.maxLife[i]!;
      const i3 = i * 3;
      const x = v.px(this.pos[i3]!);
      const y = v.py(this.pos[i3 + 1]!, this.pos[i3 + 2]!);
      if (x < -60 || x > v.W + 60 || y < -60 || y > v.H + 60) continue;
      if (puff) {
        // 墨烟：越到后面越大越淡，用预先画好的柔边墨团
        const r = this.size * k * (1.5 - 0.6 * t);
        g.globalAlpha = 0.4 * t;
        g.drawImage(puffSprite(this.color[i]!), x - r, y - r, r * 2, r * 2);
      } else {
        // 火星和墨点：沿速度方向拉出一小道
        const vx = this.vel[i3]!;
        const vy = this.vel[i3 + 1]! - this.vel[i3 + 2]! * 0.32;
        const sp = Math.hypot(vx, vy);
        const len = Math.min(0.3, sp * 0.02) * k;
        const w = Math.max(1, this.size * k * 0.3 * (0.4 + 0.6 * t));
        g.globalAlpha = Math.min(1, 0.25 + t);
        g.strokeStyle = this.color[i]!;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, y);
        if (sp > 0.01) g.lineTo(x - (vx / sp) * len, y + (vy / sp) * len);
        else g.lineTo(x + 0.01, y);
        g.stroke();
      }
    }
    g.restore();
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
  }

  dispose(): void {
    this.clear();
    this.points.removeFromParent();
  }
}

// ============ 一次性特效 ============

/** 特效形状。平面形状画在局部 xy 平面上（和以前 three.js 的几何体朝向一致） */
export type FxShape =
  | { kind: "poly"; outline: Float32Array; hole?: Float32Array; ink?: boolean }
  | { kind: "sphere" }
  | { kind: "axis"; len: number; radius: number; taper: "none" | "tip" | "blade" };

/** 一圈点：从 a0 到 a1 的弧，外半径 r1，内半径按 thick(t) 收窄 */
function tapered(a0: number, a1: number, n: number, thick: (t: number) => number): Float32Array {
  const out = new Float32Array((n + 1) * 4);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + (a1 - a0) * t;
    out[i * 2] = Math.cos(a);
    out[i * 2 + 1] = Math.sin(a);
    const r = 1 - thick(t);
    const j = (2 * n + 1 - i) * 2;
    out[j] = Math.cos(a) * r;
    out[j + 1] = Math.sin(a) * r;
  }
  return out;
}

function circle(r: number, n: number, reverse = false): Float32Array {
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = ((reverse ? -i : i) / n) * Math.PI * 2;
    out[i * 2] = Math.cos(a) * r;
    out[i * 2 + 1] = Math.sin(a) * r;
  }
  return out;
}

/** 特效共用的形状 */
export const FXGEO = {
  /** 半圆刀光，凸向 +x，中间粗两头尖 */
  arc: { kind: "poly", ink: true, outline: tapered(-Math.PI / 2, Math.PI / 2, 30, (t) => 0.26 * Math.pow(Math.sin(Math.PI * t), 0.7)) } as FxShape,
  /** 月牙，凸向 +x，飞行剑气用 */
  crescent: { kind: "poly", ink: true, outline: tapered(-1.25, 1.25, 28, (t) => 0.4 * Math.pow(Math.sin(Math.PI * t), 0.8)) } as FxShape,
  /** 地面冲击波圆环 */
  ring: { kind: "poly", outline: circle(1, 44), hole: circle(0.86, 44, true) } as FxShape,
  disk: { kind: "poly", outline: circle(1, 36) } as FxShape,
  sphere: { kind: "sphere" } as FxShape,
  cone: { kind: "axis", len: 1, radius: 0.22, taper: "tip" } as FxShape,
  /** 高为 1、底部在原点的柱子，闪电和光柱用 */
  beam: { kind: "axis", len: 1, radius: 1, taper: "none" } as FxShape,
  plane: { kind: "poly", outline: new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]) } as FxShape,
  /** 斩痕：细长的菱形 */
  slash: { kind: "poly", ink: true, outline: new Float32Array([-0.5, 0, 0, -0.05, 0.5, 0, 0, 0.05]) } as FxShape,
  sword: { kind: "axis", len: 1.3, radius: 0.07, taper: "blade" } as FxShape,
};

type Vec3 = [number, number, number];

export interface FxOpts {
  geo: FxShape;
  color: number;
  /** 亮度系数（以前给辉光用，现在大于 1.5 时加一圈光晕） */
  k?: number;
  pos: THREE.Vector3 | Vec3;
  rot?: Vec3;
  scale?: number | Vec3;
  scaleTo?: number | Vec3;
  life: number;
  opacity?: number;
  opacityTo?: number;
  vel?: Vec3;
  spin?: Vec3;
  additive?: boolean;
  /** 画在最上面（以前用于地面预警圈，现在预警圈本来就画在地面层） */
  onTop?: boolean;
  /** 延迟多少秒出现 */
  delay?: number;
  /** 缩放用 ease-out（冲击波）还是线性 */
  easeOut?: boolean;
}

const pt = [0, 0];

export class FxNode extends Node2D {
  shape: FxShape = FXGEO.plane;
  color = 0xffffff;
  css = "#fff";
  opacity = 1;
  glow = false;
  life = 0;
  max = 0;
  delay = 0;
  s0 = new THREE.Vector3();
  s1 = new THREE.Vector3();
  o0 = 1;
  o1 = 0;
  vel = new THREE.Vector3();
  spin = new THREE.Vector3();
  easeOut = true;

  override depth(): number {
    return this.position.z;
  }

  draw(g: CanvasRenderingContext2D, v: View): void {
    if (this.delay > 0 || this.opacity <= 0.005) return;
    this.updateMatrix();
    const e = this.matrix.elements;
    const sh = this.shape;
    g.save();
    g.globalAlpha = Math.min(1, this.opacity);
    g.fillStyle = this.css;
    const light = luma(this.color) > 0.55;
    if (sh.kind === "poly") {
      const path = (pts: Float32Array, dy: number) => {
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i]!;
          const y = pts[i + 1]!;
          v.project(e[0]! * x + e[4]! * y + e[12]!, e[1]! * x + e[5]! * y + e[13]!, e[2]! * x + e[6]! * y + e[14]!, pt);
          if (i === 0) g.moveTo(pt[0]!, pt[1]! + dy);
          else g.lineTo(pt[0]!, pt[1]! + dy);
        }
        g.closePath();
      };
      // 浅色刀光在宣纸上不显眼，先垫一层淡淡的墨影
      if (sh.ink && light && this.layer !== LAYER.GROUND) {
        g.save();
        g.globalAlpha = Math.min(1, this.opacity) * 0.32;
        g.fillStyle = "#16161a";
        g.beginPath();
        path(sh.outline, 0.06 * v.k);
        g.fill();
        g.restore();
      }
      // 光晕只给尺寸不太大的特效加，地面上的大圆环、冲击波不加
      if (this.glow && v.quality >= 2 && v.glowBudget > 0 && Math.hypot(e[0]!, e[1]!) * v.k < 260) {
        v.glowBudget--;
        g.shadowColor = this.css;
        g.shadowBlur = 14;
      }
      g.beginPath();
      path(sh.outline, 0);
      if (sh.hole) path(sh.hole, 0);
      g.fill("nonzero");
    } else if (sh.kind === "sphere") {
      v.project(e[12]!, e[13]!, e[14]!, pt);
      const r = Math.hypot(e[0]!, e[1]!, e[2]!) * v.k;
      if (r > 0.3) {
        const grd = g.createRadialGradient(pt[0]!, pt[1]!, r * 0.1, pt[0]!, pt[1]!, r);
        grd.addColorStop(0, light ? "#ffffff" : this.css);
        grd.addColorStop(0.55, this.css);
        grd.addColorStop(1, this.css + "00");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(pt[0]!, pt[1]!, r, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      v.project(e[12]!, e[13]!, e[14]!, pt);
      const ax = pt[0]!;
      const ay = pt[1]!;
      const L = sh.len;
      v.project(e[4]! * L + e[12]!, e[5]! * L + e[13]!, e[6]! * L + e[14]!, pt);
      const bx = pt[0]!;
      const by = pt[1]!;
      const w = Math.max(1, Math.hypot(e[0]!, e[1]!, e[2]!) * sh.radius * 2 * v.k);
      if (this.glow && v.quality >= 2 && v.glowBudget > 0 && w < 60) {
        v.glowBudget--;
        g.shadowColor = this.css;
        g.shadowBlur = 10;
      }
      if (sh.taper === "none") seg(g, ax, ay, bx, by, w, w);
      else if (sh.taper === "tip") seg(g, ax, ay, bx, by, w, 0.5);
      else {
        seg(g, ax, ay, bx, by, w, 0.8);
        g.fillStyle = "#ffffff";
        seg(g, ax, ay, bx, by, w * 0.35, 0.4);
      }
    }
    g.restore();
  }
}

const toV = (v: number | Vec3 | undefined, d: number, out: THREE.Vector3) =>
  v === undefined ? out.setScalar(d) : typeof v === "number" ? out.setScalar(v) : out.set(v[0], v[1], v[2]);

export class FxSystem {
  private live: FxNode[] = [];
  private free: FxNode[] = [];

  constructor(private scene: THREE.Object3D) {}

  spawn(o: FxOpts): FxNode {
    const m = this.free.pop() ?? new FxNode();
    m.shape = o.geo;
    m.color = o.color;
    m.css = css(o.color);
    m.glow = o.additive !== false && (o.k ?? 1) >= 1.5;
    if (Array.isArray(o.pos)) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
    else m.position.copy(o.pos);
    m.rotation.set(o.rot?.[0] ?? 0, o.rot?.[1] ?? 0, o.rot?.[2] ?? 0);
    toV(o.scale, 1, m.s0);
    toV(o.scaleTo ?? o.scale, 1, m.s1);
    m.scale.copy(m.s0);
    m.o0 = o.opacity ?? 1;
    m.o1 = o.opacityTo ?? 0;
    m.opacity = m.o0;
    m.life = m.max = o.life;
    m.delay = o.delay ?? 0;
    m.vel.set(o.vel?.[0] ?? 0, o.vel?.[1] ?? 0, o.vel?.[2] ?? 0);
    m.spin.set(o.spin?.[0] ?? 0, o.spin?.[1] ?? 0, o.spin?.[2] ?? 0);
    m.easeOut = o.easeOut ?? true;
    // 平放在地上的形状（法线朝上）画在地面层，压在角色下面
    m.updateMatrix();
    const el = m.matrix.elements;
    const n = Math.hypot(el[8]!, el[9]!, el[10]!) || 1;
    m.layer = o.geo.kind === "poly" && Math.abs(el[9]! / n) > 0.75 && m.position.y < 0.6 ? LAYER.GROUND : LAYER.FX;
    this.scene.add(m);
    this.live.push(m);
    return m;
  }

  /** 一道折线闪电，由几段细柱组成 */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, life: number, jag = 0.5): void {
    const segs = Math.max(3, Math.round(from.distanceTo(to) / 0.8));
    const prev = from.clone();
    const p = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 1; i <= segs; i++) {
      p.copy(from).lerp(to, i / segs);
      if (i < segs) p.add(dir.set(rand(-jag, jag), rand(-jag, jag) * 0.4, rand(-jag, jag) * 0.6));
      dir.subVectors(p, prev);
      const len = dir.length();
      const m = this.spawn({ geo: FXGEO.beam, color, k: 3, pos: prev.clone(), scale: [width, len, width], life, opacity: 1, opacityTo: 0 });
      m.quaternion.setFromUnitVectors(upAxis, dir.normalize());
      const halo = this.spawn({ geo: FXGEO.beam, color, k: 0.8, pos: prev.clone(), scale: [width * 3.5, len, width * 3.5], life: life * 1.2, opacity: 0.35 });
      halo.quaternion.copy(m.quaternion);
      prev.copy(p);
    }
  }

  /** 提前结束某个特效（比如敌人出招被打断时收起预警圈） */
  kill(node: THREE.Object3D): void {
    const it = this.live.find((x) => x === node);
    if (it) {
      it.delay = 0;
      it.life = 1e-4;
    }
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const it = this.live[i]!;
      if (it.delay > 0) {
        it.delay -= dt;
        if (it.delay > 0) continue;
      }
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it);
        this.live.splice(i, 1);
        this.free.push(it);
        continue;
      }
      const p = 1 - it.life / it.max;
      const e = it.easeOut ? 1 - (1 - p) * (1 - p) : p;
      it.scale.lerpVectors(it.s0, it.s1, e);
      it.opacity = it.o0 + (it.o1 - it.o0) * p;
      it.position.addScaledVector(it.vel, dt);
      it.rotation.x += it.spin.x * dt;
      it.rotation.y += it.spin.y * dt;
      it.rotation.z += it.spin.z * dt;
    }
  }

  clear(): void {
    for (const it of this.live) this.scene.remove(it);
    this.free.push(...this.live);
    this.live = [];
  }

  dispose(): void {
    this.clear();
    this.free = [];
  }
}

// ============ 刀光拖尾 ============

/** 记录最近几帧刀根和刀尖的位置，连成一条渐隐的光带 */
export class Trail {
  readonly mesh: Node2D;
  private samples: THREE.Vector3[] = [];
  private active = false;
  private colorCss = "#fff";
  private light = true;
  private fade = 0;
  /** 拖尾从刀身的哪里开始（0 是刀根，1 是刀尖） */
  inner = 0.5;

  constructor(private n = 14) {
    for (let i = 0; i < n * 2; i++) this.samples.push(new THREE.Vector3());
    const self = this;
    class TrailNode extends Node2D {
      override layer = LAYER.TOP;
      draw(g: CanvasRenderingContext2D, v: View): void {
        self.draw(g, v);
      }
    }
    this.mesh = new TrailNode();
  }

  /** 每帧调用：on=false 时光带迅速收拢消失 */
  push(base: THREE.Vector3, tip: THREE.Vector3, on: boolean, color: number, _k = 2.2): void {
    if (on && !this.active) {
      for (let i = 0; i < this.n; i++) {
        this.samples[i * 2]!.copy(base);
        this.samples[i * 2 + 1]!.copy(tip);
      }
    }
    this.active = on;
    this.fade = on ? 1 : Math.max(0, this.fade - 0.25);
    for (let i = this.n - 1; i > 0; i--) {
      this.samples[i * 2]!.copy(this.samples[(i - 1) * 2]!);
      this.samples[i * 2 + 1]!.copy(this.samples[(i - 1) * 2 + 1]!);
    }
    this.samples[0]!.copy(base);
    this.samples[1]!.copy(tip);
    this.colorCss = css(color);
    this.light = luma(color) > 0.55;
  }

  private draw(g: CanvasRenderingContext2D, v: View): void {
    if (this.fade <= 0) return;
    const p: number[][] = [];
    for (let i = 0; i < this.n * 2; i++) {
      const s = this.samples[i]!;
      p.push([v.px(s.x), v.py(s.y, s.z)]);
    }
    // 刀尖运动方向突然折回（换招、姿势跳变）时，后面的旧样本不再画，避免折成一个大直角
    let end = this.n - 1;
    for (let i = 1; i < this.n - 1; i++) {
      const t0 = p[i * 2 - 1]!;
      const t1 = p[i * 2 + 1]!;
      const t2 = p[i * 2 + 3]!;
      const ax = t1[0]! - t0[0]!;
      const ay = t1[1]! - t0[1]!;
      const bx = t2[0]! - t1[0]!;
      const by = t2[1]! - t1[1]!;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la > 2 && lb > 2 && (ax * bx + ay * by) / (la * lb) < -0.2) {
        end = i;
        break;
      }
    }
    const inner = this.inner;
    g.save();
    const quad = (i: number, dy: number) => {
      const a = p[i * 2]!;
      const b = p[i * 2 + 1]!;
      const c = p[i * 2 + 3]!;
      const d = p[i * 2 + 2]!;
      g.beginPath();
      // 刀根那一侧收窄，拖尾更像一道弧
      g.moveTo(a[0]! + (b[0]! - a[0]!) * inner, a[1]! + (b[1]! - a[1]!) * inner + dy);
      g.lineTo(b[0]!, b[1]! + dy);
      g.lineTo(c[0]!, c[1]! + dy);
      g.lineTo(d[0]! + (c[0]! - d[0]!) * inner, d[1]! + (c[1]! - d[1]!) * inner + dy);
      g.closePath();
      g.fill();
    };
    for (let i = 0; i < end; i++) {
      const f = Math.pow(1 - i / (this.n - 1), 1.5) * this.fade;
      if (this.light) {
        g.globalAlpha = f * 0.28;
        g.fillStyle = "#16161a";
        quad(i, 0.05 * v.k);
      }
      g.globalAlpha = f * 0.78;
      g.fillStyle = this.colorCss;
      quad(i, 0);
    }
    g.restore();
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}

// ============ 伤害数字 ============

export type NumberStyle = "normal" | "crit" | "hurt" | "dot" | "block" | "heal";
const STYLE_COLOR: Record<NumberStyle, [string, string]> = {
  normal: ["#ffffff", "#141414"],
  crit: ["#ffe36a", "#7a0c10"],
  hurt: ["#e8313c", "#1a0004"],
  dot: ["#ffb070", "#3a1000"],
  block: ["#bfe6ff", "#0a2a4a"],
  heal: ["#7aff9a", "#0a3a1a"],
};

interface NumItem {
  text: string;
  style: NumberStyle;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

export class DamageNumbers {
  private live: NumItem[] = [];
  private node: Node2D;

  constructor(private scene: THREE.Object3D) {
    const self = this;
    class NumbersNode extends Node2D {
      override layer = LAYER.UI;
      draw(g: CanvasRenderingContext2D, v: View): void {
        self.draw(g, v);
      }
    }
    this.node = new NumbersNode();
    scene.add(this.node);
  }

  show(at: THREE.Vector3, value: number, style: NumberStyle): void {
    const size = style === "crit" ? 0.62 : style === "dot" || style === "block" ? 0.34 : 0.45;
    this.live.push({
      text: String(Math.max(0, Math.round(value))),
      style,
      pos: new THREE.Vector3(at.x + rand(-0.3, 0.3), at.y + rand(0, 0.3), at.z),
      vel: new THREE.Vector3(rand(-0.4, 0.4), style === "dot" ? 1 : 2.2, 0),
      life: style === "crit" ? 0.9 : 0.7,
      max: style === "crit" ? 0.9 : 0.7,
      size,
    });
    if (this.live.length > 80) this.live.shift();
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const it = this.live[i]!;
      it.life -= dt;
      if (it.life <= 0) {
        this.live.splice(i, 1);
        continue;
      }
      it.pos.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
    }
  }

  private draw(g: CanvasRenderingContext2D, v: View): void {
    if (!this.live.length) return;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const it of this.live) {
      const p = 1 - it.life / it.max;
      // 先弹大再回落，最后缩小消失
      const s = p < 0.12 ? 1.6 - p * 5 : p > 0.75 ? 1 - (p - 0.75) * 4 : 1;
      const px = Math.max(8, it.size * v.S * Math.max(0.01, s) * Math.min(1.4, v.zoom));
      const [fill, stroke] = STYLE_COLOR[it.style];
      g.font = `900 ${px}px "Arial Black", Impact, sans-serif`;
      g.lineWidth = Math.max(2, px * 0.16);
      g.strokeStyle = stroke;
      g.fillStyle = fill;
      const x = v.px(it.pos.x);
      const y = v.py(it.pos.y, it.pos.z);
      g.strokeText(it.text, x, y);
      g.fillText(it.text, x, y);
    }
    g.restore();
  }

  clear(): void {
    this.live = [];
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.node);
  }
}
