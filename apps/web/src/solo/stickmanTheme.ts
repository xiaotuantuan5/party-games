import { DEPTH, View, css, dryBrush, mixHex, paperGrain, rng, roughen } from "./ink2d";

/**
 * 2D 水墨场景：每个房间由几层剪影组成（远山、中景寺庙、近景屋檐、地面、前景），
 * 每层先画到一张离屏画布上，游戏中按视差平移、缩放后贴到屏幕上，所以细节再多也不影响帧率。
 * 花瓣和飘叶每帧单独画。
 */

// ================= 配色 =================

/** 一套场景的配色 */
export interface MapStyle {
  /** 宣纸 / 天色：顶、中、底 */
  sky: [string, string, string];
  /** 远、中、近三层剪影的颜色 */
  far: number;
  mid: number;
  near: number;
  /** 地面：靠远处、靠近处 */
  ground: [number, number];
  /** 雾的 rgb，格式 "r,g,b" */
  fog: string;
  /** 太阳或月亮，null 不画 */
  orb: { color: string; r: number } | null;
  /** 斜射的光束强度（0 不画） */
  rays: number;
  /** 飘落物的颜色 */
  leaf: number;
  /** 前景有没有红枫 */
  maple: boolean;
  /** 夜景：粒子和光晕用“滤色”叠加更亮 */
  night: boolean;
}

export type MapStyleId = "ink" | "maple" | "bloodmoon";

export const MAP_STYLES: Record<MapStyleId, MapStyle> = {
  ink: {
    sky: ["#bdb9b2", "#dedbd4", "#cfcbc3"],
    far: 0xaaa69f,
    mid: 0x77736c,
    near: 0x34312d,
    ground: [0xa29e96, 0x3c3935],
    fog: "238,235,228",
    orb: { color: "#f6f3ec", r: 1.2 },
    rays: 0.32,
    leaf: 0x2a2826,
    maple: false,
    night: false,
  },
  maple: {
    sky: ["#081a20", "#14404a", "#2a5e66"],
    far: 0x2c5e66,
    mid: 0x18404a,
    near: 0x0a1f24,
    ground: [0x2c5a60, 0x081417],
    fog: "140,196,200",
    orb: { color: "#f2e6cc", r: 0.9 },
    rays: 0.12,
    leaf: 0xb3262e,
    maple: true,
    night: true,
  },
  bloodmoon: {
    sky: ["#10050b", "#38111f", "#561c2a"],
    far: 0x4e2434,
    mid: 0x331624,
    near: 0x160910,
    ground: [0x4a2028, 0x0e0508],
    fog: "176,96,116",
    orb: { color: "#c4283a", r: 1.8 },
    rays: 0.08,
    leaf: 0xa3202a,
    maple: false,
    night: true,
  },
};

// ================= 花瓣 / 飘叶 =================

interface Petal {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  a: number;
  spin: number;
  flip: number;
  life: number;
  max: number;
  color: string;
  size: number;
  ambient: boolean;
}

/** 花瓣和墨点：ambient 的会一直飘，burst 的是技能炸出来的，会慢慢消失 */
export class Petals {
  private list: Petal[] = [];
  private box = { x0: 0, x1: 30, z0: -3, z1: 3, top: 7 };
  density = 1;

  seedAmbient(count: number, color: number, box: { x0: number; x1: number; z0: number; z1: number; top: number }): void {
    this.box = box;
    const c = css(color);
    for (let i = 0; i < count; i++) {
      this.list.push({
        x: box.x0 + Math.random() * (box.x1 - box.x0),
        y: Math.random() * box.top,
        z: box.z0 + Math.random() * (box.z1 - box.z0),
        vx: 0,
        vy: -(0.3 + Math.random() * 0.4),
        vz: 0,
        a: Math.random() * 6,
        spin: (Math.random() - 0.5) * 4,
        flip: Math.random() * 6,
        life: 1e9,
        max: 1e9,
        color: c,
        size: 0.06 + Math.random() * 0.05,
        ambient: true,
      });
    }
  }

  /** 技能炸出来的花瓣，向四周飞散后慢慢消失 */
  burst(at: { x: number; y: number; z: number }, count: number, color: number, speed: number, life: number): void {
    const total = Math.max(1, Math.round(count * this.density));
    const c = css(color);
    for (let k = 0; k < total; k++) {
      const s = speed * (0.4 + Math.random() * 0.6);
      const th = Math.random() * Math.PI * 2;
      const u = -0.6 + Math.random() * 1.4;
      this.list.push({
        x: at.x + (Math.random() - 0.5) * 0.4,
        y: at.y + (Math.random() - 0.5) * 0.4,
        z: at.z + (Math.random() - 0.5) * 0.4,
        vx: Math.cos(th) * s,
        vy: u * s + 1.5,
        vz: Math.sin(th) * s * 0.4,
        a: Math.random() * 6,
        spin: (Math.random() - 0.5) * 18,
        flip: Math.random() * 6,
        life: life * (0.6 + Math.random() * 0.4),
        max: life,
        color: c,
        size: 0.06 + Math.random() * 0.05,
        ambient: false,
      });
    }
    if (this.list.length > 520) this.list.splice(0, this.list.length - 520);
  }

  update(dt: number, t: number): void {
    const wind = Math.sin(t * 0.3) * 0.4 + 0.25;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.a += p.spin * dt;
      p.flip += dt * 3;
      if (p.ambient) {
        p.x += (wind + Math.sin(p.a) * 0.3) * dt;
        p.y += p.vy * dt;
        if (p.y < -0.05) {
          p.y = this.box.top * (0.6 + Math.random() * 0.4);
          p.x = this.box.x0 + Math.random() * (this.box.x1 - this.box.x0);
        }
        continue;
      }
      p.life -= dt;
      if (p.life <= 0 || p.y < -0.05) {
        this.list.splice(i, 1);
        continue;
      }
      const drag = Math.max(0, 1 - 1.6 * dt);
      p.vx *= drag;
      p.vy = p.vy * drag - 3 * dt;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
  }

  draw(g: CanvasRenderingContext2D, v: View): void {
    g.save();
    for (const p of this.list) {
      const x = v.px(p.x);
      const y = v.py(p.y, p.z);
      if (x < -20 || x > v.W + 20 || y < -20 || y > v.H + 20) continue;
      const fade = p.ambient ? 0.85 : Math.min(1, p.life / 0.3);
      const r = p.size * v.k;
      g.globalAlpha = fade;
      g.fillStyle = p.color;
      g.beginPath();
      g.ellipse(x, y, r, Math.max(0.6, r * 0.45 * Math.abs(Math.cos(p.flip))), p.a, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}

// ================= 剪影画法（单位：世界单位；y 向下为正，0 是这一层的地平线） =================

type G = CanvasRenderingContext2D;

/** 翘角的屋顶：cx 中心，y 屋檐底，hw 半宽，rh 屋顶高 */
function roof(g: G, cx: number, y: number, hw: number, rh: number): void {
  g.beginPath();
  g.moveTo(cx - hw * 1.3, y - rh * 0.55);
  g.quadraticCurveTo(cx - hw * 1.05, y + rh * 0.12, cx - hw * 0.72, y + rh * 0.1);
  g.lineTo(cx + hw * 0.72, y + rh * 0.1);
  g.quadraticCurveTo(cx + hw * 1.05, y + rh * 0.12, cx + hw * 1.3, y - rh * 0.55);
  g.quadraticCurveTo(cx + hw * 0.95, y - rh * 0.28, cx + hw * 0.6, y - rh);
  g.lineTo(cx - hw * 0.6, y - rh);
  g.quadraticCurveTo(cx - hw * 0.95, y - rh * 0.28, cx - hw * 1.3, y - rh * 0.55);
  g.closePath();
  g.fill();
  // 屋脊和两端的鸱吻
  g.fillRect(cx - hw * 0.64, y - rh - 0.08, hw * 1.28, 0.1);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * hw * 0.62, y - rh - 0.05);
    g.quadraticCurveTo(cx + s * hw * 0.7, y - rh - 0.35, cx + s * hw * 0.56, y - rh - 0.42);
    g.lineTo(cx + s * hw * 0.58, y - rh - 0.05);
    g.fill();
  }
}

/** 殿堂：几根柱子、栏杆、一层或两层屋顶 */
function hall(g: G, R: () => number, cx: number, s: number, tiers: number, detail: boolean): void {
  const hw = 2.2 * s;
  const bodyH = 2.3 * s;
  const top = -bodyH;
  // 台基
  g.fillRect(cx - hw * 1.05, -0.25 * s, hw * 2.1, 0.25 * s);
  // 柱子
  for (let i = -2; i <= 2; i++) g.fillRect(cx + i * hw * 0.42 - 0.09 * s, top, 0.18 * s, bodyH);
  // 墙体半透明
  g.save();
  g.globalAlpha *= 0.45;
  g.fillRect(cx - hw * 0.85, top, hw * 1.7, bodyH);
  g.restore();
  // 栏杆
  g.fillRect(cx - hw * 0.98, top + bodyH * 0.55, hw * 1.96, 0.07 * s);
  if (detail) {
    for (let x = cx - hw * 0.98; x < cx + hw * 0.98; x += 0.24 * s) g.fillRect(x, top + bodyH * 0.55, 0.05 * s, bodyH * 0.2);
    g.fillRect(cx - hw * 0.98, top + bodyH * 0.75, hw * 1.96, 0.06 * s);
    // 斗拱
    for (let x = cx - hw * 0.85; x < cx + hw * 0.85; x += 0.3 * s) g.fillRect(x, top - 0.16 * s, 0.18 * s, 0.16 * s);
  }
  roof(g, cx, top - 0.16 * s, hw, 1.1 * s);
  let y = top - 1.26 * s;
  let w = hw;
  for (let t = 1; t < tiers; t++) {
    w *= 0.72;
    const h = 1.1 * s;
    g.fillRect(cx - w * 0.75, y - h, w * 1.5, h);
    if (detail) for (let x = cx - w * 0.7; x < cx + w * 0.7; x += 0.28 * s) g.fillRect(x, y - h - 0.12 * s, 0.16 * s, 0.12 * s);
    roof(g, cx, y - h - 0.12 * s, w, 0.85 * s);
    y -= h + 0.97 * s;
  }
  // 屋檐下挂的灯笼
  if (detail && R() < 0.7) {
    for (const s2 of [-1, 1]) {
      const lx = cx + s2 * hw * 0.8;
      g.fillRect(lx - 0.01 * s, top - 0.1 * s, 0.02 * s, 0.4 * s);
      g.beginPath();
      g.ellipse(lx, top + 0.45 * s, 0.13 * s, 0.18 * s, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** 塔：一层层收窄的塔身和屋檐 */
function pagoda(g: G, cx: number, s: number, tiers: number): void {
  let y = 0;
  let w = 1.1 * s;
  g.fillRect(cx - w, -0.2 * s, w * 2, 0.2 * s);
  for (let i = 0; i < tiers; i++) {
    const h = (i === 0 ? 1.2 : 0.75) * s;
    g.fillRect(cx - w * 0.6, y - h, w * 1.2, h);
    roof(g, cx, y - h, w, 0.55 * s);
    y -= h + 0.45 * s;
    w *= 0.82;
  }
  g.fillRect(cx - 0.04 * s, y - 0.9 * s, 0.08 * s, 0.9 * s);
}

/** 连绵的远山，用整数倍频率的正弦叠起来 */
function ridge(g: G, R: () => number, x0: number, x1: number, base: number, amp: number): void {
  const ph = R() * 10;
  g.beginPath();
  g.moveTo(x0, 1);
  for (let x = x0; x <= x1; x += 0.25) {
    const y = base - amp * (0.55 + 0.45 * Math.sin(x * 0.21 + ph)) - amp * 0.35 * Math.sin(x * 0.67 + ph * 2) - amp * 0.12 * Math.sin(x * 1.9 + ph);
    g.lineTo(x, y);
  }
  g.lineTo(x1, 1);
  g.closePath();
  g.fill();
}

/** 竹子：一节一节的竿，加几簇竹叶 */
function bamboo(g: G, R: () => number, x: number, h: number, w: number): void {
  const lean = (R() - 0.5) * 0.08;
  for (let y = 0; y > -h; y -= 0.9) {
    const top = Math.max(-h, y - 0.85);
    g.beginPath();
    g.moveTo(x + y * lean - w / 2, y);
    g.lineTo(x + top * lean - w / 2, top);
    g.lineTo(x + top * lean + w / 2, top);
    g.lineTo(x + y * lean + w / 2, y);
    g.fill();
  }
  for (let i = 0; i < 4; i++) {
    const ly = -h * (0.45 + R() * 0.5);
    const lx = x + ly * lean;
    for (let j = 0; j < 4; j++) {
      const a = (R() - 0.5) * 1.6 + (R() < 0.5 ? 0 : Math.PI);
      const L = 0.5 + R() * 0.5;
      g.beginPath();
      g.moveTo(lx, ly);
      g.quadraticCurveTo(lx + Math.cos(a) * L * 0.5, ly + Math.sin(a) * L * 0.3 - 0.05, lx + Math.cos(a) * L, ly + Math.sin(a) * L * 0.5 + 0.15);
      g.quadraticCurveTo(lx + Math.cos(a) * L * 0.5, ly + Math.sin(a) * L * 0.3 + 0.07, lx, ly);
      g.fill();
    }
  }
}

/** 一簇枫叶：很多小星形的叶子叠成一团 */
function mapleCluster(g: G, R: () => number, cx: number, cy: number, r: number, color: string, dark: string): void {
  for (let i = 0; i < 60; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * r;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.6;
    const s = 0.12 + R() * 0.14;
    g.fillStyle = R() < 0.3 ? dark : color;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const aa = (k / 10) * Math.PI * 2 + a;
      const rr = k % 2 ? s * 0.45 : s;
      g.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
    }
    g.closePath();
    g.fill();
  }
}

function stoneLantern(g: G, x: number, s: number): void {
  g.fillRect(x - 0.22 * s, -0.12 * s, 0.44 * s, 0.12 * s);
  g.fillRect(x - 0.08 * s, -1.0 * s, 0.16 * s, 0.9 * s);
  g.fillRect(x - 0.25 * s, -1.4 * s, 0.5 * s, 0.4 * s);
  g.beginPath();
  g.moveTo(x - 0.45 * s, -1.4 * s);
  g.lineTo(x + 0.45 * s, -1.4 * s);
  g.lineTo(x, -1.85 * s);
  g.fill();
}

/** 山门牌坊：两根大柱、两道横梁、一层屋顶 */
function gate(g: G, cx: number, s: number): void {
  const hw = 2.4 * s;
  for (const sx of [-1, 1]) g.fillRect(cx + sx * hw - 0.2 * s, -4.2 * s, 0.4 * s, 4.2 * s);
  g.fillRect(cx - hw * 1.12, -3.5 * s, hw * 2.24, 0.25 * s);
  g.fillRect(cx - hw * 1.05, -4.25 * s, hw * 2.1, 0.32 * s);
  roof(g, cx, -4.35 * s, hw * 0.95, 0.9 * s);
  g.fillRect(cx - 0.45 * s, -3.25 * s, 0.9 * s, 0.6 * s);
}

/** 近景：从画面上方压下来的大屋檐一角 */
function eaveCorner(g: G, x: number, dir: number, s: number): void {
  const top = -9.5 * s;
  g.beginPath();
  g.moveTo(x - dir * 0.5, top);
  g.lineTo(x + dir * 4.2 * s, top);
  g.quadraticCurveTo(x + dir * 5.2 * s, -6.5 * s, x + dir * 6.4 * s, -6.3 * s);
  g.quadraticCurveTo(x + dir * 5.0 * s, -6.0 * s, x + dir * 3.0 * s, -6.2 * s);
  g.lineTo(x - dir * 0.5, -6.2 * s);
  g.closePath();
  g.fill();
  // 椽子
  g.save();
  g.globalAlpha *= 0.7;
  for (let i = 0; i < 9; i++) g.fillRect(x + dir * (0.2 + i * 0.36) * s - 0.06 * s, -6.2 * s, 0.12 * s, 0.32 * s);
  g.restore();
  // 柱子和栏杆
  g.fillRect(x + dir * 1.2 * s - 0.25 * s, -6.2 * s, 0.5 * s, 6.2 * s);
  g.fillRect(x + dir * 3.2 * s - 0.2 * s, -6.2 * s, 0.4 * s, 6.2 * s);
  g.fillRect(x - dir * 0.5, -2.1 * s, dir * 4.4 * s + dir * 0.5, 0.12 * s);
  for (let i = 0; i < 9; i++) g.fillRect(x + dir * (0.1 + i * 0.45) * s - 0.04 * s, -2.1 * s, 0.08 * s, 1.2 * s);
  g.fillRect(x - dir * 0.5, -1.0 * s, dir * 4.4 * s + dir * 0.5, 0.1 * s);
}

function buddha(g: G, cx: number, s: number): void {
  g.beginPath();
  g.ellipse(cx, -1.2 * s, 2.6 * s, 1.4 * s, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillRect(cx - 1.4 * s, -4.2 * s, 2.8 * s, 3.1 * s);
  g.beginPath();
  g.arc(cx, -4.9 * s, 0.85 * s, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx, -5.7 * s, 0.35 * s, 0, Math.PI * 2);
  g.fill();
  // 背光
  g.save();
  g.globalAlpha *= 0.35;
  g.beginPath();
  g.arc(cx, -4.6 * s, 2.3 * s, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** 大殿的帷幔：从梁上垂下来，每一幅往两边收拢，中间留出空档能看到殿里 */
function curtains(g: G, x0: number, x1: number, h: number): void {
  const bay = 9;
  for (let x = x0; x < x1; x += bay) {
    // 顶上一条波浪形的横幔
    g.beginPath();
    g.moveTo(x, -h);
    for (let i = 0; i < 4; i++) g.quadraticCurveTo(x + (i + 0.5) * (bay / 4), -h + 1.1, x + (i + 1) * (bay / 4), -h);
    g.closePath();
    g.fill();
    // 左右两幅收到柱边，用细绳束住，下摆散开
    for (const side of [0, 1]) {
      const edge = side === 0 ? x : x + bay;
      const d = side === 0 ? 1 : -1;
      const tie = -h * 0.42;
      g.beginPath();
      g.moveTo(edge, -h);
      g.lineTo(edge + d * 1.9, -h);
      g.quadraticCurveTo(edge + d * 1.2, -h * 0.62, edge + d * 0.45, tie);
      g.quadraticCurveTo(edge + d * 0.7, tie * 0.5, edge + d * 0.95, -0.2);
      g.lineTo(edge, -0.2);
      g.closePath();
      g.fill();
      // 褶子：几条略深的竖纹
      g.save();
      g.globalAlpha *= 0.35;
      g.fillStyle = "#000";
      for (let k = 1; k < 4; k++) {
        const fx = edge + d * 0.55 * k;
        g.fillRect(Math.min(fx, fx + d * 0.08), -h, 0.08, h * 0.5);
      }
      g.restore();
    }
  }
}

// ================= 一层离屏画布 =================

/** 每个世界单位画多少像素 */
const RES = 40;

interface Layer {
  canvas: HTMLCanvasElement;
  /** 视差：1 表示和地面一起动，越小越远 */
  p: number;
  /** 画布左边对应的层坐标 */
  x0: number;
  /** 画布里地平线所在的像素行 */
  baseRow: number;
  /** 这层的地平线对应的有效高度 */
  base: number;
}

function makeLayer(p: number, x0: number, x1: number, up: number, down: number, base: number, paint: (g: G, R: () => number) => void, seed: number): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(4096, Math.ceil((x1 - x0) * RES));
  canvas.height = Math.ceil((up + down) * RES);
  const g = canvas.getContext("2d")!;
  const R = rng(seed);
  g.setTransform(RES, 0, 0, RES, -x0 * RES, up * RES);
  paint(g, R);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, p, x0, baseRow: up * RES, base };
}

// ================= 场景 =================

export interface Theme {
  petals: Petals;
  /** 每帧调用，让花瓣落下、灯笼晃动 */
  update(dt: number, t: number): void;
  /** 画背景（天、远山、寺庙、地面、出口），dim 是大招时压暗的程度 0~1 */
  drawBack(g: CanvasRenderingContext2D, v: View, dim: number): void;
  /** 画前景（压在角色上面的剪影、花瓣、纸纹、暗角） */
  drawFront(g: CanvasRenderingContext2D, v: View): void;
  setDoorOpen(open: boolean): void;
  dispose(): void;
}

/** 远处的地平线：纵深 -3.6 处（比走位范围再远一点） */
const HORIZON = 3.6 * DEPTH;

/** 搭好当前房间的场景 */
export function buildTheme(room: number, width: number, style: MapStyle): Theme {
  const X0 = -16;
  const farCol = css(style.far);
  const midCol = css(style.mid);
  const nearCol = css(style.near);
  const boss = room === 4;
  const span = (p: number) => width * p + 32;

  // ---- 远景：山和塔，雾里很淡 ----
  const far = makeLayer(
    0.18,
    X0,
    X0 + span(0.18),
    9,
    1,
    HORIZON,
    (g, R) => {
      g.fillStyle = css(mixHex(style.far, 0xffffff, style.night ? 0 : 0.25));
      ridge(g, R, X0, X0 + span(0.18), -0.6, 2.4);
      g.fillStyle = farCol;
      ridge(g, R, X0, X0 + span(0.18), 0, 1.4);
      if (room === 1) {
        for (let x = X0; x < X0 + span(0.18); x += 0.5 + R() * 0.5) bamboo(g, R, x, 4 + R() * 3, 0.08);
      } else if (!boss) {
        for (let x = X0 + 3; x < X0 + span(0.18); x += 7 + R() * 6) pagoda(g, x, 0.55 + R() * 0.25, 4 + Math.floor(R() * 3));
      }
    },
    room * 13 + 1,
  );

  // ---- 中景：殿堂、牌坊、竹林、佛像 ----
  const mid = makeLayer(
    0.45,
    X0,
    X0 + span(0.45),
    9,
    1,
    HORIZON,
    (g, R) => {
      g.fillStyle = midCol;
      const x1 = X0 + span(0.45);
      if (room === 0) {
        for (let x = X0 + 2; x < x1; x += 9 + R() * 4) hall(g, R, x, 0.9 + R() * 0.2, 1 + Math.floor(R() * 2), true);
        gate(g, (width * 0.45) / 2 + 3, 1.05);
      } else if (room === 1) {
        for (let x = X0; x < x1; x += 0.6 + R() * 0.9) bamboo(g, R, x, 6 + R() * 3, 0.12 + R() * 0.06);
      } else if (room === 2) {
        for (let x = X0 + 3; x < x1; x += 8 + R() * 5) hall(g, R, x, 1 + R() * 0.25, 2, true);
      } else if (room === 3) {
        // 藏经楼里面：一整面书架墙和格子窗
        g.fillRect(X0, -5.8, x1 - X0, 0.35);
        for (let x = X0; x < x1; x += 3.2) {
          g.save();
          g.globalAlpha *= 0.55;
          g.fillRect(x + 0.3, -5.2, 2.6, 5.2);
          g.restore();
          for (let r = 0; r < 5; r++) g.fillRect(x + 0.3, -5.2 + r * 1.05, 2.6, 0.08);
          for (let c = 0; c < 9; c++) g.fillRect(x + 0.42 + c * 0.28, -5.0 + (c % 3) * 1.05, 0.12, 0.8);
          g.fillRect(x, -5.8, 0.3, 5.8);
        }
      } else {
        buddha(g, (width * 0.45) / 2 + 4, 1.4);
        for (let x = X0; x < x1; x += 4.5) g.fillRect(x, -7, 0.45, 7);
      }
    },
    room * 13 + 2,
  );

  // ---- 近景：画面上方压下来的屋檐、柱子、帷幔 ----
  const near = makeLayer(
    0.78,
    X0,
    X0 + span(0.78),
    10.5,
    1,
    HORIZON,
    (g, R) => {
      g.fillStyle = nearCol;
      const x1 = X0 + span(0.78);
      if (room === 1) {
        for (let x = X0; x < x1; x += 2.2 + R() * 3) bamboo(g, R, x, 10, 0.22 + R() * 0.1);
      } else if (room === 3) {
        g.fillRect(X0, -9.6, x1 - X0, 1.0);
        for (let x = X0; x < x1; x += 6 + R() * 2) {
          g.fillRect(x, -9.6, 0.55, 9.6);
          // 挂着的灯笼
          g.fillRect(x + 2.8, -8.6, 0.03, 1.4);
          g.beginPath();
          g.ellipse(x + 2.8, -6.9, 0.32, 0.42, 0, 0, Math.PI * 2);
          g.fill();
        }
      } else if (boss) {
        g.save();
        g.globalAlpha = 0.7;
        g.fillStyle = css(mixHex(style.near, 0x6a0c14, 0.45));
        curtains(g, X0, x1, 9.5);
        g.restore();
        g.fillStyle = nearCol;
        g.fillRect(X0, -10.5, x1 - X0, 1.2);
        // 帷幔之间的大柱子
        for (let x = X0; x < x1; x += 9) g.fillRect(x - 0.35, -10.5, 0.7, 10.5);
      } else {
        for (let x = X0 + 2; x < x1; x += 13 + R() * 6) {
          const dir = R() < 0.5 ? 1 : -1;
          eaveCorner(g, x, dir, 1);
        }
        for (let x = X0 + 6; x < x1; x += 9 + R() * 5) stoneLantern(g, x, 0.9);
      }
    },
    room * 13 + 3,
  );

  // ---- 地面：远处浅、近处深，横着扫几笔墨 ----
  const GROUND_TOP = HORIZON;
  const GROUND_BOT = -4.6;
  const groundCanvas = (() => {
    const x0 = X0;
    const x1 = width + 16;
    const c = document.createElement("canvas");
    c.width = Math.min(4096, Math.ceil((x1 - x0) * RES));
    c.height = Math.ceil((GROUND_TOP - GROUND_BOT) * RES);
    const g = c.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, css(style.ground[0]));
    grd.addColorStop(0.35, css(mixHex(style.ground[0], style.ground[1], 0.45)));
    grd.addColorStop(1, css(style.ground[1]));
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    const R = rng(room * 17 + 5);
    // 横向的墨痕和高光
    for (let i = 0; i < 26; i++) {
      const y = R() * c.height;
      const x = R() * c.width;
      const L = 200 + R() * 700;
      const dark = R() < 0.6;
      dryBrush(g, R, [x, y, x + L * 0.3, y - 6 + R() * 12, x + L * 0.7, y - 6 + R() * 12, x + L, y + (R() - 0.5) * 10], 6 + R() * 18, dark ? "#141210" : "#ffffff", dark ? 0.22 : 0.12, 18);
    }
    if (room === 0) {
      // 山门前的石阶，在远处
      g.fillStyle = "rgba(0,0,0,0.18)";
      for (let i = 0; i < 4; i++) g.fillRect(0, (0.05 + i * 0.12) * RES, c.width, 2);
    } else if (room === 3) {
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = 1.5;
      for (let y = 6; y < c.height; y += 14 + y * 0.12) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(c.width, y);
        g.stroke();
      }
    } else if (boss) {
      // 大殿中央的血池
      const cx = (width / 2 - x0) * RES;
      const cy = (GROUND_TOP - 0.1) * RES + 40;
      const pool = g.createRadialGradient(cx, cy, 10, cx, cy, 160);
      pool.addColorStop(0, "rgba(150,14,24,0.85)");
      pool.addColorStop(1, "rgba(120,10,20,0)");
      g.fillStyle = pool;
      g.beginPath();
      g.ellipse(cx, cy, 170, 48, 0, 0, Math.PI * 2);
      g.fill();
    }
    roughen(g, R, c.width, c.height, 0.6);
    return { canvas: c, x0 };
  })();

  // ---- 前景：最前面的草和碎石，比地面动得快 ----
  const front = makeLayer(
    1.28,
    X0,
    X0 + width * 1.28 + 32,
    3.5,
    1.5,
    -2.4,
    (g, R) => {
      const x1 = X0 + width * 1.28 + 32;
      g.fillStyle = css(mixHex(style.near, 0x000000, 0.35));
      for (let x = X0; x < x1; x += 3 + R() * 7) {
        // 一丛草
        for (let k = 0; k < 7; k++) {
          const bx = x + (R() - 0.5) * 0.8;
          const h = 0.5 + R() * 1.1;
          const lean = (R() - 0.5) * 0.7;
          g.beginPath();
          g.moveTo(bx - 0.05, 0.6);
          g.quadraticCurveTo(bx + lean * 0.5, -h * 0.5, bx + lean, -h);
          g.quadraticCurveTo(bx + lean * 0.4, -h * 0.4, bx + 0.06, 0.6);
          g.fill();
        }
      }
      if (style.maple && room !== 3) {
        for (let x = X0 + 4; x < x1; x += 14 + R() * 10) mapleCluster(g, R, x, -0.6, 1.6, css(style.leaf), css(mixHex(style.leaf, 0x000000, 0.45)));
      }
    },
    room * 13 + 4,
  );

  // 红枫的树冠挂在近景上方（只有红枫配色）
  const canopy = style.maple && room !== 3 && !boss
    ? makeLayer(
        0.85,
        X0,
        X0 + span(0.85),
        10.5,
        0.5,
        HORIZON,
        (g, R) => {
          const x1 = X0 + span(0.85);
          for (let x = X0; x < x1; x += 6 + R() * 7) {
            g.fillStyle = css(mixHex(style.near, 0x000000, 0.2));
            g.beginPath();
            g.moveTo(x - 0.15, 0.5);
            g.quadraticCurveTo(x + 0.4, -4, x - 0.2, -8.8);
            g.lineTo(x + 0.25, -8.8);
            g.quadraticCurveTo(x + 0.9, -4, x + 0.3, 0.5);
            g.fill();
            mapleCluster(g, R, x + 0.3, -9.2, 3.2, css(style.leaf), css(mixHex(style.leaf, 0x000000, 0.4)));
          }
        },
        room * 13 + 6,
      )
    : null;

  // 墨色擦边，让剪影边缘像毛笔画的
  for (const l of [far, mid, near]) roughen(l.canvas.getContext("2d")!, rng(l.canvas.width), l.canvas.width, l.canvas.height, 1.2);

  // ---- 光束：一张小图拉伸到全屏 ----
  const rays = (() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const g = c.getContext("2d")!;
    const R = rng(room + 99);
    for (let i = 0; i < 8; i++) {
      const x = -100 + R() * 520;
      const w = 20 + R() * 70;
      const grd = g.createLinearGradient(x, 0, x + 200, 256);
      grd.addColorStop(0, "rgba(255,255,250,0.55)");
      grd.addColorStop(1, "rgba(255,255,250,0)");
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x, -5);
      g.lineTo(x + w, -5);
      g.lineTo(x + w + 260, 256);
      g.lineTo(x + 210, 256);
      g.closePath();
      g.fill();
    }
    return c;
  })();

  // ---- 天上的几道干笔 ----
  const skyBrush = (() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 300;
    const g = c.getContext("2d")!;
    const R = rng(room + 51);
    const col = style.night ? "#000000" : "#6c6863";
    for (let i = 0; i < 4; i++) {
      const y = 30 + R() * 200;
      dryBrush(g, R, [-60, y, 300, y - 40 + R() * 80, 700, y - 40 + R() * 80, 1100, y + (R() - 0.5) * 60], 30 + R() * 50, col, 0.22, 40);
    }
    return c;
  })();

  const grain = paperGrain();
  let grainPattern: CanvasPattern | null = null;
  let doorOpen = false;

  const petals = new Petals();
  petals.seedAmbient(room === 3 ? 30 : 70, style.leaf, { x0: -2, x1: width + 2, z0: -3, z1: 3, top: 7 });

  /** 按视差把一层贴到屏幕上 */
  const drawLayer = (g: CanvasRenderingContext2D, v: View, l: Layer) => {
    const kl = v.S * (1 + (v.zoom - 1) * l.p);
    const camY0 = 0.28 * (v.H / v.S);
    const camYp = camY0 + (v.camY - camY0) * l.p;
    const scale = kl / RES;
    const dx = v.W / 2 + v.offX * l.p + (l.x0 - v.camX * l.p) * kl;
    const baseY = v.H / 2 + v.offY * l.p - (l.base - camYp) * kl;
    const dy = baseY - l.baseRow * scale;
    // 只取屏幕上看得见的那一段
    const sx0 = Math.max(0, Math.floor(-dx / scale));
    const sx1 = Math.min(l.canvas.width, Math.ceil((v.W - dx) / scale));
    if (sx1 <= sx0) return;
    g.drawImage(l.canvas, sx0, 0, sx1 - sx0, l.canvas.height, dx + sx0 * scale, dy, (sx1 - sx0) * scale, l.canvas.height * scale);
  };

  const fogBand = (g: CanvasRenderingContext2D, y: number, h: number, a: number, W: number) => {
    const grd = g.createLinearGradient(0, y - h, 0, y + h);
    grd.addColorStop(0, `rgba(${style.fog},0)`);
    grd.addColorStop(0.5, `rgba(${style.fog},${a})`);
    grd.addColorStop(1, `rgba(${style.fog},0)`);
    g.fillStyle = grd;
    g.fillRect(0, y - h, W, h * 2);
  };

  return {
    petals,
    update(dt, t) {
      petals.update(dt, t);
    },
    setDoorOpen(open) {
      doorOpen = open;
    },
    drawBack(g, v, dim) {
      const W = v.W;
      const H = v.H;
      // 天色
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, style.sky[0]);
      sky.addColorStop(0.55, style.sky[1]);
      sky.addColorStop(1, style.sky[2]);
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      // 太阳或月亮，几乎不随镜头移动
      if (style.orb) {
        const ox = W * 0.72 - v.camX * v.S * 0.03;
        const oy = H * 0.2;
        const r = style.orb.r * v.S;
        const halo = g.createRadialGradient(ox, oy, r * 0.5, ox, oy, r * 3.2);
        halo.addColorStop(0, style.orb.color + "88");
        halo.addColorStop(1, style.orb.color + "00");
        g.fillStyle = halo;
        g.fillRect(ox - r * 3.2, oy - r * 3.2, r * 6.4, r * 6.4);
        g.fillStyle = style.orb.color;
        g.beginPath();
        g.arc(ox, oy, r, 0, Math.PI * 2);
        g.fill();
      }
      g.drawImage(skyBrush, -((v.camX * v.S * 0.06) % 200) - 200, 0, W + 400, H * 0.45);
      drawLayer(g, v, far);
      fogBand(g, v.pyEff(HORIZON) - 0.6 * v.S, 1.6 * v.S, 0.7, W);
      drawLayer(g, v, mid);
      fogBand(g, v.pyEff(HORIZON) - 0.2 * v.S, 1.1 * v.S, 0.6, W);
      // 光束
      if (style.rays > 0 && v.quality >= 1) {
        g.save();
        g.globalCompositeOperation = "screen";
        g.globalAlpha = style.rays;
        g.drawImage(rays, -((v.camX * v.S * 0.2) % (W * 0.5)), 0, W * 1.6, H);
        g.restore();
      }
      drawLayer(g, v, near);
      if (canopy) drawLayer(g, v, canopy);
      // 地面
      const gy = v.pyEff(GROUND_TOP);
      const scale = v.k / RES;
      g.fillStyle = css(style.ground[1]);
      g.fillRect(0, gy, W, H - gy);
      const dx = v.px(groundCanvas.x0);
      const sx0 = Math.max(0, Math.floor(-dx / scale));
      const sx1 = Math.min(groundCanvas.canvas.width, Math.ceil((W - dx) / scale));
      if (sx1 > sx0) g.drawImage(groundCanvas.canvas, sx0, 0, sx1 - sx0, groundCanvas.canvas.height, dx + sx0 * scale, gy, (sx1 - sx0) * scale, groundCanvas.canvas.height * scale);
      fogBand(g, gy, 0.5 * v.k, 0.55, W);

      // 出口：房间右端的一道门，开了以后透出白光
      if (!boss) {
        const x = v.px(width + 0.6);
        const top = v.py(4.4, 0);
        const bot = v.py(0, 0);
        const w = 1.4 * v.k;
        g.save();
        if (doorOpen) {
          const glow = g.createLinearGradient(x - w, 0, x + w, 0);
          glow.addColorStop(0, "rgba(255,255,250,0)");
          glow.addColorStop(0.5, `rgba(255,255,250,${0.75 + 0.15 * Math.sin(v.time * 4)})`);
          glow.addColorStop(1, "rgba(255,255,250,0)");
          g.fillStyle = glow;
          g.fillRect(x - w, top, w * 2, bot - top + 0.6 * v.k);
        } else {
          g.fillStyle = "rgba(150,16,26,0.55)";
          g.fillRect(x - w * 0.45, top, w * 0.9, bot - top);
        }
        g.fillStyle = nearCol;
        g.fillRect(x - w * 0.62, top, w * 0.18, bot - top);
        g.fillRect(x + w * 0.44, top, w * 0.18, bot - top);
        g.fillRect(x - w * 0.85, top - 0.2 * v.k, w * 1.7, 0.25 * v.k);
        g.restore();
      }

      // 大招时把背景压暗，角色和特效更显眼
      if (dim > 0.01) {
        g.fillStyle = `rgba(6,6,8,${Math.min(0.75, dim * 0.7)})`;
        g.fillRect(0, 0, W, H);
      }
    },
    drawFront(g, v) {
      petals.draw(g, v);
      drawLayer(g, v, front);
      if (v.quality >= 1) {
        if (!grainPattern) grainPattern = g.createPattern(grain, "repeat");
        if (grainPattern) {
          g.save();
          g.globalAlpha = style.night ? 0.35 : 0.6;
          g.fillStyle = grainPattern;
          g.fillRect(0, 0, v.W, v.H);
          g.restore();
        }
      }
      // 暗角
      const vg = g.createRadialGradient(v.W / 2, v.H / 2, Math.min(v.W, v.H) * 0.35, v.W / 2, v.H / 2, Math.max(v.W, v.H) * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, style.night ? "rgba(0,0,0,0.5)" : "rgba(30,28,24,0.32)");
      g.fillStyle = vg;
      g.fillRect(0, 0, v.W, v.H);
    },
    dispose() {
      for (const l of [far, mid, near, front, canopy]) if (l) l.canvas.width = l.canvas.height = 0;
      groundCanvas.canvas.width = groundCanvas.canvas.height = 0;
    },
  };
}

