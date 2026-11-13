import * as THREE from "three";
import { LAYER, Node2D, disc, seg, type View } from "./ink2d";

/**
 * 场景里的小物件（2D 水墨画法）：影子、木箱、火药桶、掉落物、箭、觉醒时的飞剑。
 * 都是 Node2D：位置和以前一样用 position 设置，放进场景后每帧自动画。
 */

/** 地上的一团淡墨影子 */
export class ShadowNode extends Node2D {
  constructor() {
    super();
    this.layer = LAYER.GROUND;
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    if (!this.visible) return;
    const x = v.px(this.position.x);
    const y = v.py(0, this.position.z);
    const r = 0.5 * this.scale.x * v.k;
    g.save();
    g.globalAlpha = 0.32;
    g.fillStyle = "#0c0b0a";
    g.beginPath();
    g.ellipse(x, y, r * 1.15, r * 0.32, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** 木箱和火药桶 */
export class PropNode extends Node2D {
  constructor(readonly kind: "crate" | "barrel") {
    super();
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    const x = v.px(this.position.x);
    const y = v.py(0, this.position.z);
    const k = v.k;
    g.save();
    g.fillStyle = "rgba(10,10,10,0.3)";
    g.beginPath();
    g.ellipse(x, y, 0.55 * k, 0.14 * k, 0, 0, Math.PI * 2);
    g.fill();
    if (this.kind === "crate") {
      const w = 0.86 * k;
      const h = 0.82 * k;
      g.fillStyle = "#f2efe8";
      g.globalAlpha = 0.5;
      g.fillRect(x - w / 2 - 1.5, y - h - 1.5, w + 1, h + 1);
      g.globalAlpha = 1;
      g.fillStyle = "#3e3328";
      g.fillRect(x - w / 2, y - h, w, h);
      g.strokeStyle = "#1c1712";
      g.lineWidth = Math.max(1.5, 0.05 * k);
      g.strokeRect(x - w / 2, y - h, w, h);
      g.beginPath();
      g.moveTo(x - w / 2, y - h);
      g.lineTo(x + w / 2, y);
      g.moveTo(x + w / 2, y - h);
      g.lineTo(x - w / 2, y);
      g.stroke();
    } else {
      // 火药桶：深色木桶，中间一张红纸，纸上画一簇火苗
      const w = 0.78 * k;
      const h = 0.92 * k;
      g.fillStyle = "#2a1f1a";
      g.beginPath();
      g.ellipse(x, y - h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#0e0b09";
      g.lineWidth = Math.max(1.5, 0.05 * k);
      for (const t of [0.22, 0.78]) {
        g.beginPath();
        g.moveTo(x - w * 0.47, y - h * t);
        g.lineTo(x + w * 0.47, y - h * t);
        g.stroke();
      }
      g.fillStyle = "#b51c22";
      g.fillRect(x - w * 0.22, y - h * 0.68, w * 0.44, h * 0.36);
      g.fillStyle = "#f2e6c8";
      const fx = x;
      const fy = y - h * 0.38;
      const fh = h * 0.26;
      g.beginPath();
      g.moveTo(fx, fy - fh);
      g.quadraticCurveTo(fx + fh * 0.55, fy - fh * 0.3, fx + fh * 0.3, fy);
      g.lineTo(fx - fh * 0.3, fy);
      g.quadraticCurveTo(fx - fh * 0.55, fy - fh * 0.3, fx, fy - fh);
      g.fill();
    }
    g.restore();
  }
}

/** 掉落物：铜钱、红药葫芦、蓝药葫芦 */
export class DropNode extends Node2D {
  constructor(readonly kind: "coin" | "hp" | "mp") {
    super();
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    const x = v.px(this.position.x);
    const y = v.py(this.position.y, this.position.z);
    const k = v.k;
    g.save();
    if (this.kind === "coin") {
      const r = 0.15 * k;
      const w = Math.max(1, Math.abs(Math.cos(this.rotation.y)) * r);
      g.fillStyle = "#c9a23a";
      g.beginPath();
      g.ellipse(x, y, w, r, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#6a4f12";
      g.fillRect(x - w * 0.35, y - r * 0.35, w * 0.7, r * 0.7);
    } else {
      const c = this.kind === "hp" ? "#c21d24" : "#2f5fa8";
      g.fillStyle = "rgba(255,255,255,0.6)";
      disc(g, x - 1, y - 1, 0.17 * k + 1.5);
      g.fillStyle = c;
      disc(g, x, y + 0.04 * k, 0.15 * k);
      disc(g, x, y - 0.14 * k, 0.09 * k);
      g.fillStyle = "#3a2a1a";
      g.fillRect(x - 0.03 * k, y - 0.28 * k, 0.06 * k, 0.07 * k);
    }
    g.restore();
  }
}

/** 弓手射出的箭 */
export class ArrowNode extends Node2D {
  dir = 1;
  draw(g: CanvasRenderingContext2D, v: View): void {
    const x = v.px(this.position.x);
    const y = v.py(this.position.y, this.position.z);
    const L = 0.9 * v.k;
    const d = this.dir;
    g.save();
    g.strokeStyle = "#1a1714";
    g.lineWidth = Math.max(1.5, 0.035 * v.k);
    g.beginPath();
    g.moveTo(x - (d * L) / 2, y);
    g.lineTo(x + (d * L) / 2, y);
    g.stroke();
    g.fillStyle = "#e8e4da";
    g.beginPath();
    g.moveTo(x + (d * L) / 2 + d * 0.12 * v.k, y);
    g.lineTo(x + (d * L) / 2, y - 0.05 * v.k);
    g.lineTo(x + (d * L) / 2, y + 0.05 * v.k);
    g.fill();
    g.fillStyle = "#b51c22";
    g.fillRect(x - (d * L) / 2 - (d < 0 ? 0 : 0.12 * v.k), y - 0.05 * v.k, 0.12 * v.k, 0.1 * v.k);
    g.restore();
  }
}

/**
 * 万剑归宗的 100 把光剑。用法和以前的 InstancedMesh 一样：每帧 setMatrixAt 写入每把剑的变换，
 * 剑沿局部 +y 方向，长 1.3。
 */
export class SwordSwarm extends Node2D {
  private mats: THREE.Matrix4[];
  readonly instanceMatrix = { needsUpdate: false };
  constructor(n: number) {
    super();
    this.layer = LAYER.FX;
    this.mats = Array.from({ length: n }, () => new THREE.Matrix4().makeScale(0, 0, 0));
    this.visible = false;
  }
  setMatrixAt(i: number, m: THREE.Matrix4): void {
    this.mats[i]?.copy(m);
  }
  override depth(): number {
    return 10;
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    if (!this.visible) return;
    g.save();
    g.lineCap = "round";
    for (const m of this.mats) {
      const e = m.elements;
      const s = Math.hypot(e[4]!, e[5]!, e[6]!);
      if (s < 0.01) continue;
      const ax = v.px(e[12]!);
      const ay = v.py(e[13]!, e[14]!);
      const bx = v.px(e[12]! + e[4]! * 1.3);
      const by = v.py(e[13]! + e[5]! * 1.3, e[14]! + e[6]! * 1.3);
      g.fillStyle = "rgba(22,22,26,0.35)";
      seg(g, ax, ay + 0.05 * v.k, bx, by + 0.05 * v.k, 0.09 * v.k * s, 0.5);
      g.fillStyle = "#f6f6f0";
      seg(g, ax, ay, bx, by, 0.08 * v.k * s, 0.5);
    }
    g.restore();
  }
}

/** 从天而降的巨剑 */
export class BigSword extends Node2D {
  readonly material = { opacity: 1 };
  constructor() {
    super();
    this.layer = LAYER.FX;
    this.visible = false;
  }
  override depth(): number {
    return 11;
  }
  draw(g: CanvasRenderingContext2D, v: View): void {
    if (!this.visible || this.material.opacity <= 0.01) return;
    this.updateMatrix();
    const e = this.matrix.elements;
    // 剑柄在原点，剑身沿局部 +y 伸出 1.3。插进地里以后剑柄停在地面上方，地下的部分不画
    let ay0 = e[13]!;
    let by0 = e[13]! + e[5]! * 1.3;
    const lift = Math.max(0, 1.4 - ay0);
    ay0 += lift;
    by0 += lift;
    const len = ay0 - by0;
    const cut = by0 < 0 && len > 0 ? Math.min(1, ay0 / len) : 1;
    const z = e[14]!;
    const ax = v.px(e[12]!);
    const ay = v.py(ay0, z);
    const bx = v.px(e[12]! + e[4]! * 1.3 * cut);
    const by = v.py(ay0 + (by0 - ay0) * cut, z);
    const w = Math.hypot(e[0]!, e[1]!, e[2]!) * 0.14 * v.k;
    g.save();
    g.globalAlpha = this.material.opacity;
    g.fillStyle = "rgba(20,20,24,0.4)";
    seg(g, ax + 6, ay + 6, bx + 6, by + 6, w, 2);
    if (v.quality >= 2) {
      g.shadowColor = "rgba(255,240,200,1)";
      g.shadowBlur = 24;
    }
    g.fillStyle = "#fff6dc";
    seg(g, ax, ay, bx, by, w, 2);
    g.fillStyle = "#b51c22";
    seg(g, ax - w * 1.2, ay, ax + w * 1.2, ay, w * 0.35, w * 0.35);
    g.restore();
  }
}
