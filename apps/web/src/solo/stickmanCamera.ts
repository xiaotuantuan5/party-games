import * as THREE from "three";
import { DEPTH, type View } from "./ink2d";

/**
 * 2D 镜头：平时横向跟着主角走，跳高时往上抬一点。
 * 放大招时按一组「镜头」运镜：每个镜头写的是 3D 机位（pos）和看向的点（look），
 * 2D 里换算成画面中心（看向的点）和缩放（机位越近、视角越窄，放得越大）。
 */

type Vec3 = [number, number, number];

export interface Shot {
  dur: number;
  /** 相对锚点的位置，x 会乘上朝向（正值在角色前方） */
  pos: Vec3;
  look: Vec3;
  /** 镜头结束时移动到的位置，不写就是固定机位 */
  toPos?: Vec3;
  toLook?: Vec3;
  fov?: number;
}

/** 平时镜头：主角前方留一点空，地面放在画面从上往下约 78% 的高度 */
const LEAD = 1.4;
const GROUND_AT = 0.78;
/** 运镜时机位到看向点的“标准距离”，等于这个距离、视角 40 度时不缩放 */
const REF_DIST = 8;
const REF_FOV = 40;
const MIN_ZOOM = 0.62;
const MAX_ZOOM = 1.6;
const BLEND_BACK = 0.3;

const smooth = (t: number) => t * t * (3 - 2 * t);

interface Frame {
  x: number;
  y: number;
  zoom: number;
}

export class CameraDirector {
  /** 关掉后只保留轻档（推镜、震屏），不再运镜 */
  enabled = true;
  private minX = 0;
  private maxX = 30;
  private roomW = 30;
  private halfW = 7;
  private halfH = 3.6;
  private followX = 0;
  private followY = 0;
  private cur: Frame = { x: 0, y: 0, zoom: 1 };

  private shots: Shot[] = [];
  private anchor = new THREE.Vector3();
  private facing = 1;
  private shotIdx = 0;
  private shotT = 0;
  private onDone: (() => void) | null = null;

  private blendT = 0;
  private blendFrom: Frame = { x: 0, y: 0, zoom: 1 };

  private shakeA = 0;
  private kickT = 0;
  private kickDur = 0;
  private kickPush = 0;
  private kickTilt = 0;
  /** 当前倾斜（弧度），画的时候整体旋转 */
  roll = 0;

  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private d = new THREE.Vector3();

  get active(): boolean {
    return this.shots.length > 0;
  }

  /** 房间宽度或画面尺寸变了以后调用，镜头不会跑到房间外面 */
  setBounds(roomW: number, view: View): void {
    this.roomW = roomW;
    this.halfW = view.W / 2 / view.S;
    this.halfH = view.H / 2 / view.S;
    this.minX = this.halfW - 1.2;
    this.maxX = roomW - this.halfW + 1.2;
    if (this.minX > this.maxX) this.minX = this.maxX = roomW / 2;
  }

  /** 切房间或开局时直接跳到主角身边 */
  snap(target: THREE.Vector3, facing: number): void {
    this.followX = THREE.MathUtils.clamp(target.x + facing * LEAD, this.minX, this.maxX);
    this.followY = 0;
    this.shots = [];
    this.blendT = 0;
    this.cur = this.followFrame();
  }

  play(anchor: THREE.Vector3, facing: number, shots: Shot[], onDone?: () => void): void {
    if (!this.enabled || shots.length === 0) {
      onDone?.();
      return;
    }
    this.anchor.copy(anchor);
    this.facing = facing;
    this.shots = shots;
    this.shotIdx = 0;
    this.shotT = 0;
    this.onDone = onDone ?? null;
    this.blendT = 0;
  }

  /** 中途结束运镜（跳过），平滑回到平时的镜头 */
  stop(): void {
    if (!this.shots.length) return;
    this.finish();
  }

  shake(amount: number): void {
    this.shakeA = Math.max(this.shakeA, amount);
  }

  /** 轻档：推近 push（0~1）、倾斜 tilt（弧度），持续 dur 秒 */
  kick(push: number, tilt: number, dur: number): void {
    this.kickT = dur;
    this.kickDur = dur;
    this.kickPush = push;
    this.kickTilt = tilt;
  }

  /** 每帧更新，并把结果写进 view（镜头中心、缩放、震屏偏移） */
  update(dt: number, target: THREE.Vector3, facing: number, view: View): void {
    const tx = THREE.MathUtils.clamp(target.x + facing * LEAD, this.minX, this.maxX);
    this.followX += (tx - this.followX) * Math.min(1, dt * 5);
    const ty = Math.max(0, target.y - 0.8) * 0.6 - target.z * DEPTH * 0.5;
    this.followY += (ty - this.followY) * Math.min(1, dt * 4);

    if (this.shots.length) {
      this.shotT += dt;
      let shot = this.shots[this.shotIdx]!;
      while (this.shotT >= shot.dur) {
        this.shotT -= shot.dur;
        this.shotIdx++;
        if (this.shotIdx >= this.shots.length) {
          this.finish();
          break;
        }
        shot = this.shots[this.shotIdx]!;
      }
      if (this.shots.length) {
        const k = smooth(Math.min(1, this.shotT / shot.dur));
        this.rel(shot.pos, this.a);
        this.rel(shot.toPos ?? shot.pos, this.b);
        this.a.lerp(this.b, k);
        this.rel(shot.look, this.c);
        this.rel(shot.toLook ?? shot.look, this.d);
        this.c.lerp(this.d, k);
        const dist = Math.max(0.5, this.a.distanceTo(this.c));
        const fov = shot.fov ?? 40;
        const raw = (REF_DIST / dist) * (Math.tan(THREE.MathUtils.degToRad(REF_FOV / 2)) / Math.tan(THREE.MathUtils.degToRad(fov / 2)));
        // 3D 机位换算出来的放大倍数在 2D 里显得太冲，只取一半的变化
        const zoom = THREE.MathUtils.clamp(1 + (raw - 1) * 0.5, MIN_ZOOM, MAX_ZOOM);
        // 镜头不能抬得太高：地面最多压到画面从上往下 85% 的位置，免得只拍到房梁
        const maxY = (0.85 - 0.5) * 2 * (this.halfH / zoom);
        const goal: Frame = { x: this.c.x, y: Math.min(this.c.y - this.c.z * DEPTH, maxY), zoom };
        const f = Math.min(1, dt * 10);
        this.cur.x += (goal.x - this.cur.x) * f;
        this.cur.y += (goal.y - this.cur.y) * f;
        this.cur.zoom += (goal.zoom - this.cur.zoom) * f;
      }
    }

    if (!this.shots.length) {
      const goal = this.followFrame();
      if (this.blendT > 0) {
        this.blendT = Math.max(0, this.blendT - dt);
        const k = smooth(1 - this.blendT / BLEND_BACK);
        this.cur.x = this.blendFrom.x + (goal.x - this.blendFrom.x) * k;
        this.cur.y = this.blendFrom.y + (goal.y - this.blendFrom.y) * k;
        this.cur.zoom = this.blendFrom.zoom + (goal.zoom - this.blendFrom.zoom) * k;
      } else this.cur = goal;
    }

    // 轻档推镜：放大一点，再轻微倾斜
    let push = 0;
    let tilt = 0;
    if (this.kickT > 0) {
      this.kickT = Math.max(0, this.kickT - dt);
      const p = 1 - this.kickT / this.kickDur;
      const env = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
      push = this.kickPush * env;
      tilt = this.kickTilt * env;
    }
    view.zoom = this.cur.zoom * (1 + push * 0.6);
    view.camX = this.cur.x;
    view.camY = this.cur.y;
    // 放大以后镜头不能露出房间外面
    if (!this.shots.length) {
      const hw = view.W / 2 / view.k;
      const lo = hw - 1.2;
      const hi = this.roomW - hw + 1.2;
      view.camX = lo > hi ? this.roomW / 2 : THREE.MathUtils.clamp(view.camX, lo, hi);
    }
    if (this.shakeA > 0.001) {
      view.offX = (Math.random() - 0.5) * this.shakeA * view.S * 0.9;
      view.offY = (Math.random() - 0.5) * this.shakeA * view.S * 0.9;
      this.shakeA *= Math.max(0, 1 - dt * 9);
    } else {
      view.offX = 0;
      view.offY = 0;
    }
    this.roll = tilt;
  }

  /** 平时的镜头：中心在主角前方，地面在画面下方 */
  private followFrame(): Frame {
    return { x: this.followX, y: this.followY + (GROUND_AT - 0.5) * 2 * this.halfH, zoom: 1 };
  }

  private finish(): void {
    this.blendFrom = { ...this.cur };
    this.blendT = BLEND_BACK;
    this.shots = [];
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  private rel(v: Vec3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.anchor.x + v[0] * this.facing, this.anchor.y + v[1], this.anchor.z + v[2]);
  }
}
