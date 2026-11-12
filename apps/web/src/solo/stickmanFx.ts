import * as THREE from "three";

/**
 * 火柴人刷图的特效：粒子、剑光 / 冲击波这类一次性网格特效、闪电、剑光拖尾、伤害数字。
 * 战斗中特效非常多，全部用对象池复用，不在战斗中频繁创建材质。
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

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private vel: Float32Array;
  private grav: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private next = 0;
  /** 画质低时少发一半 */
  density = 1;

  constructor(
    private n: number,
    size: number,
  ) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.grav = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.points.frustumCulled = false;
    this.clear();
  }

  emit(at: THREE.Vector3, count: number, color: THREE.Color | number, o: EmitOpts): void {
    const c = typeof color === "number" ? new THREE.Color(color) : color;
    const total = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < total; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const u = o.upward ? Math.random() : Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = o.speed * (0.25 + Math.random() * 0.75);
      const sp = o.spread ?? 0;
      this.pos.set([at.x + rand(-sp, sp), at.y + rand(-sp, sp) * 0.5, at.z + rand(-sp, sp) * 0.5], i * 3);
      this.vel.set([r * Math.cos(th) * s, u * s + (o.up ?? 0), r * Math.sin(th) * s], i * 3);
      const b = 0.6 + Math.random() * 0.8;
      this.base.set([c.r * b, c.g * b, c.b * b], i * 3);
      this.grav[i] = o.gravity ?? 0;
      this.maxLife[i] = this.life[i] = o.life * (0.5 + Math.random() * 0.5);
    }
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - 2 * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i]! <= 0) continue;
      const i3 = i * 3;
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) {
        this.col.fill(0, i3, i3 + 3);
        this.pos[i3 + 1] = -999;
        continue;
      }
      const k = this.life[i]! / this.maxLife[i]!;
      this.vel[i3 + 1] = this.vel[i3 + 1]! - this.grav[i]! * dt;
      for (let c = 0; c < 3; c++) {
        this.pos[i3 + c] = this.pos[i3 + c]! + this.vel[i3 + c]! * dt;
        this.vel[i3 + c] = this.vel[i3 + c]! * drag;
        this.col[i3 + c] = this.base[i3 + c]! * k;
      }
      if (this.pos[i3 + 1]! < 0.02) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] = Math.abs(this.vel[i3 + 1]!) * 0.3;
      }
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.col.fill(0);
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -999;
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ============ 网格特效 ============

/** 特效共用的几何体 */
export const FXGEO = {
  /** 半圆弧，凸向 +x，剑光用 */
  arc: new THREE.RingGeometry(0.78, 1, 28, 1, -Math.PI / 2, Math.PI),
  /** 月牙，凸向 +x，飞行剑气用 */
  crescent: new THREE.RingGeometry(0.62, 1, 28, 1, -1.25, 2.5),
  /** 地面冲击波圆环 */
  ring: new THREE.RingGeometry(0.88, 1, 48),
  disk: new THREE.CircleGeometry(1, 40),
  sphere: new THREE.SphereGeometry(1, 18, 12),
  cone: new THREE.ConeGeometry(0.22, 1, 6).translate(0, 0.5, 0),
  /** 高为 1、底部在原点的圆柱，闪电和光柱用 */
  beam: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0),
  plane: new THREE.PlaneGeometry(1, 1),
  /** 斩痕：细长的菱形 */
  slash: new THREE.PlaneGeometry(1, 0.08),
  sword: (() => {
    const blade = new THREE.ConeGeometry(0.07, 1.3, 4).rotateY(Math.PI / 4);
    blade.translate(0, 0.65, 0);
    return blade;
  })(),
};

type Vec3 = [number, number, number];

export interface FxOpts {
  geo: THREE.BufferGeometry;
  color: number;
  /** 亮度系数，大于 1 会被辉光放大 */
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
  /** 不被别的物体挡住（地面预警圈用） */
  onTop?: boolean;
  /** 延迟多少秒出现 */
  delay?: number;
  /** 缩放用 ease-out（冲击波）还是线性 */
  easeOut?: boolean;
}

interface FxItem {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  max: number;
  delay: number;
  s0: THREE.Vector3;
  s1: THREE.Vector3;
  o0: number;
  o1: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  easeOut: boolean;
}

const toV = (v: number | Vec3 | undefined, d: number, out: THREE.Vector3) =>
  v === undefined ? out.setScalar(d) : typeof v === "number" ? out.setScalar(v) : out.set(v[0], v[1], v[2]);

export class FxSystem {
  private live: FxItem[] = [];
  private free: FxItem[] = [];

  constructor(private scene: THREE.Scene) {}

  spawn(o: FxOpts): FxItem["mesh"] {
    const item =
      this.free.pop() ?? {
        mesh: new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(
          FXGEO.plane,
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
        ),
        life: 0,
        max: 0,
        delay: 0,
        s0: new THREE.Vector3(),
        s1: new THREE.Vector3(),
        o0: 1,
        o1: 0,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        easeOut: true,
      };
    const m = item.mesh;
    m.geometry = o.geo;
    m.material.color.set(o.color).multiplyScalar(o.k ?? 1);
    m.material.blending = o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    m.material.depthTest = !o.onTop;
    m.renderOrder = o.onTop ? 5 : 2;
    if (Array.isArray(o.pos)) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
    else m.position.copy(o.pos);
    m.rotation.set(o.rot?.[0] ?? 0, o.rot?.[1] ?? 0, o.rot?.[2] ?? 0);
    toV(o.scale, 1, item.s0);
    toV(o.scaleTo ?? o.scale, 1, item.s1);
    m.scale.copy(item.s0);
    item.o0 = o.opacity ?? 1;
    item.o1 = o.opacityTo ?? 0;
    m.material.opacity = item.o0;
    item.life = item.max = o.life;
    item.delay = o.delay ?? 0;
    m.visible = item.delay <= 0;
    item.vel.set(o.vel?.[0] ?? 0, o.vel?.[1] ?? 0, o.vel?.[2] ?? 0);
    item.spin.set(o.spin?.[0] ?? 0, o.spin?.[1] ?? 0, o.spin?.[2] ?? 0);
    item.easeOut = o.easeOut ?? true;
    this.scene.add(m);
    this.live.push(item);
    return m;
  }

  /** 一道折线闪电，由几段细圆柱组成 */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, life: number, jag = 0.5): void {
    const segs = Math.max(3, Math.round(from.distanceTo(to) / 0.8));
    let prev = from.clone();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const upAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 1; i <= segs; i++) {
      const p = from.clone().lerp(to, i / segs);
      if (i < segs) p.add(new THREE.Vector3(rand(-jag, jag), rand(-jag, jag) * 0.4, rand(-jag, jag) * 0.6));
      dir.subVectors(p, prev);
      const len = dir.length();
      q.setFromUnitVectors(upAxis, dir.normalize());
      const m = this.spawn({ geo: FXGEO.beam, color, k: 3, pos: prev, scale: [width, len, width], life, opacity: 1, opacityTo: 0 });
      m.quaternion.copy(q);
      // 外面再套一层更粗更暗的光晕
      const g = this.spawn({ geo: FXGEO.beam, color, k: 0.8, pos: prev, scale: [width * 3.5, len, width * 3.5], life: life * 1.2, opacity: 0.5 });
      g.quaternion.copy(q);
      prev = p;
    }
  }

  /** 提前结束某个特效（比如敌人出招被打断时收起预警圈） */
  kill(mesh: THREE.Object3D): void {
    const it = this.live.find((x) => x.mesh === mesh);
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
        it.mesh.visible = true;
      }
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.mesh);
        this.live.splice(i, 1);
        this.free.push(it);
        continue;
      }
      const p = 1 - it.life / it.max;
      const e = it.easeOut ? 1 - (1 - p) * (1 - p) : p;
      it.mesh.scale.lerpVectors(it.s0, it.s1, e);
      it.mesh.material.opacity = it.o0 + (it.o1 - it.o0) * p;
      it.mesh.position.addScaledVector(it.vel, dt);
      it.mesh.rotation.x += it.spin.x * dt;
      it.mesh.rotation.y += it.spin.y * dt;
      it.mesh.rotation.z += it.spin.z * dt;
    }
  }

  clear(): void {
    for (const it of this.live) this.scene.remove(it.mesh);
    this.free.push(...this.live);
    this.live = [];
  }

  dispose(): void {
    this.clear();
    for (const it of this.free) it.mesh.material.dispose();
    this.free = [];
  }
}

// ============ 剑光拖尾 ============

/** 记录最近几帧剑根和剑尖的位置，连成一条渐隐的光带 */
export class Trail {
  readonly mesh: THREE.Mesh;
  private samples: THREE.Vector3[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private color = new THREE.Color();
  private active = false;

  constructor(private n = 14) {
    for (let i = 0; i < n * 2; i++) this.samples.push(new THREE.Vector3());
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** 每帧调用：on=false 时光带迅速收拢消失 */
  push(base: THREE.Vector3, tip: THREE.Vector3, on: boolean, color: number, k = 2.2): void {
    if (on && !this.active) {
      for (let i = 0; i < this.n; i++) {
        this.samples[i * 2]!.copy(base);
        this.samples[i * 2 + 1]!.copy(tip);
      }
    }
    this.active = on;
    for (let i = this.n - 1; i > 0; i--) {
      this.samples[i * 2]!.copy(this.samples[(i - 1) * 2]!);
      this.samples[i * 2 + 1]!.copy(this.samples[(i - 1) * 2 + 1]!);
    }
    this.samples[0]!.copy(base);
    this.samples[1]!.copy(tip);
    this.color.set(color).multiplyScalar(k);
    for (let i = 0; i < this.n; i++) {
      const fade = on ? Math.pow(1 - i / (this.n - 1), 1.6) : 0;
      for (let s = 0; s < 2; s++) {
        const v = this.samples[i * 2 + s]!;
        const j = (i * 2 + s) * 3;
        this.pos[j] = v.x;
        this.pos[j + 1] = v.y;
        this.pos[j + 2] = v.z;
        const f = fade * (s === 1 ? 1 : 0.35);
        this.col[j] = this.color.r * f;
        this.col[j + 1] = this.color.g * f;
        this.col[j + 2] = this.color.b * f;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ============ 伤害数字 ============

export type NumberStyle = "normal" | "crit" | "hurt" | "dot" | "block" | "heal";
const STYLE_COLOR: Record<NumberStyle, [string, string]> = {
  normal: ["#ffffff", "#ff8a2a"],
  crit: ["#fff36a", "#ff3a1a"],
  hurt: ["#ff4a5a", "#3a0008"],
  dot: ["#ffb070", "#6a2000"],
  block: ["#9ad8ff", "#0a2a4a"],
  heal: ["#7aff9a", "#0a3a1a"],
};
const GLYPHS = "0123456789";
const CELL_W = 48;
const CELL_H = 64;

interface NumItem {
  group: THREE.Group;
  sprites: THREE.Sprite[];
  life: number;
  max: number;
  vel: THREE.Vector3;
  size: number;
}

/** 数字字模画在一张贴图上，每个数字用几个 Sprite 拼起来，Sprite 永远朝向镜头，运镜时也看得清 */
export class DamageNumbers {
  private mats = new Map<string, THREE.SpriteMaterial>();
  private textures: THREE.Texture[] = [];
  private live: NumItem[] = [];
  private free: NumItem[] = [];

  constructor(private scene: THREE.Scene) {
    for (const style of Object.keys(STYLE_COLOR) as NumberStyle[]) {
      const [fill, stroke] = STYLE_COLOR[style];
      const canvas = document.createElement("canvas");
      canvas.width = CELL_W * GLYPHS.length;
      canvas.height = CELL_H;
      const c = canvas.getContext("2d")!;
      c.font = `900 ${CELL_H * 0.86}px "Arial Black", Impact, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineJoin = "round";
      c.lineWidth = 9;
      c.strokeStyle = stroke;
      c.fillStyle = fill;
      for (let i = 0; i < GLYPHS.length; i++) {
        const x = i * CELL_W + CELL_W / 2;
        c.strokeText(GLYPHS[i]!, x, CELL_H / 2 + 2);
        c.fillText(GLYPHS[i]!, x, CELL_H / 2 + 2);
      }
      const base = new THREE.CanvasTexture(canvas);
      base.colorSpace = THREE.SRGBColorSpace;
      for (let i = 0; i < GLYPHS.length; i++) {
        const t = base.clone();
        t.repeat.set(1 / GLYPHS.length, 1);
        t.offset.set(i / GLYPHS.length, 0);
        t.needsUpdate = true;
        this.textures.push(t);
        this.mats.set(style + i, new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, transparent: true }));
      }
      this.textures.push(base);
    }
  }

  show(at: THREE.Vector3, value: number, style: NumberStyle): void {
    const text = String(Math.max(0, Math.round(value)));
    const item =
      this.free.pop() ?? ({ group: new THREE.Group(), sprites: [], vel: new THREE.Vector3(), life: 0, max: 0, size: 1 } as NumItem);
    const size = style === "crit" ? 0.62 : style === "dot" || style === "block" ? 0.34 : 0.45;
    while (item.sprites.length < text.length) {
      const s = new THREE.Sprite();
      s.renderOrder = 10;
      item.sprites.push(s);
    }
    item.group.clear();
    const w = size * (CELL_W / CELL_H) * 0.82;
    for (let i = 0; i < text.length; i++) {
      const s = item.sprites[i]!;
      s.material = this.mats.get(style + text[i])!;
      s.scale.set(w / 0.82, size, 1);
      s.position.set((i - (text.length - 1) / 2) * w, 0, 0);
      item.group.add(s);
    }
    item.group.position.set(at.x + rand(-0.3, 0.3), at.y + rand(0, 0.3), at.z + 0.3);
    item.vel.set(rand(-0.4, 0.4), style === "dot" ? 1 : 2.2, 0);
    item.life = item.max = style === "crit" ? 0.9 : 0.7;
    item.size = 1;
    this.scene.add(item.group);
    this.live.push(item);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const it = this.live[i]!;
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.group);
        this.live.splice(i, 1);
        this.free.push(it);
        continue;
      }
      const p = 1 - it.life / it.max;
      // 先弹大再回落，最后缩小消失
      const s = p < 0.12 ? 1.6 - p * 5 : p > 0.75 ? 1 - (p - 0.75) * 4 : 1;
      it.group.scale.setScalar(Math.max(0.01, s));
      it.group.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
    }
  }

  clear(): void {
    for (const it of this.live) this.scene.remove(it.group);
    this.free.push(...this.live);
    this.live = [];
  }

  dispose(): void {
    this.clear();
    this.mats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
