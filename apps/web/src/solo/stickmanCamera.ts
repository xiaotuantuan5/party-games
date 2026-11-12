import * as THREE from "three";

/**
 * 相机：平时固定成 DNF 那样从侧前上方斜着看的横版视角，跟着主角左右移动；
 * 放大招时按一组「镜头」运镜，结束后平滑回到平时的位置。
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

const FOLLOW_FOV = 30;
/** 平时机位：俯视约 25°，离地面中心约 17 */
const FOLLOW_POS = new THREE.Vector3(0, 8.2, 15.4);
const FOLLOW_LOOK = new THREE.Vector3(0, 1.0, -0.4);
const BLEND_BACK = 0.25;

const smooth = (t: number) => t * t * (3 - 2 * t);

export class CameraDirector {
  readonly camera = new THREE.PerspectiveCamera(FOLLOW_FOV, 16 / 9, 0.1, 200);
  /** 关掉后只保留轻档（推镜、震屏），不再转相机 */
  enabled = true;
  private minX = 0;
  private maxX = 30;
  private followX = 0;
  private followY = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov = FOLLOW_FOV;

  private shots: Shot[] = [];
  private anchor = new THREE.Vector3();
  private facing = 1;
  private shotIdx = 0;
  private shotT = 0;
  private onDone: (() => void) | null = null;

  private blendT = 0;
  private blendPos = new THREE.Vector3();
  private blendLook = new THREE.Vector3();
  private blendFov = FOLLOW_FOV;

  private shakeA = 0;
  private kickT = 0;
  private kickDur = 0;
  private kickPush = 0;
  private kickTilt = 0;

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  get active(): boolean {
    return this.shots.length > 0;
  }

  setBounds(roomWidth: number): void {
    const halfW = Math.tan(THREE.MathUtils.degToRad(FOLLOW_FOV / 2)) * 17 * this.camera.aspect;
    this.minX = halfW - 0.8;
    this.maxX = roomWidth - halfW + 0.8;
    if (this.minX > this.maxX) this.minX = this.maxX = roomWidth / 2;
  }

  /** 切房间时直接跳到目标位置 */
  snap(x: number): void {
    this.followX = THREE.MathUtils.clamp(x, this.minX, this.maxX);
    this.followY = 0;
    this.shots = [];
    this.blendT = 0;
    this.followTarget(this.pos, this.look);
    this.fov = FOLLOW_FOV;
    this.applyToCamera(this.pos, this.look, this.fov);
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

  /** 中途结束运镜（跳过），平滑回到平时机位 */
  stop(): void {
    if (!this.shots.length) return;
    this.finish();
  }

  shake(amount: number): void {
    this.shakeA = Math.max(this.shakeA, amount);
  }

  /** 轻档：推近 push、倾斜 tilt（弧度），持续 dur 秒 */
  kick(push: number, tilt: number, dur: number): void {
    this.kickT = dur;
    this.kickDur = dur;
    this.kickPush = push;
    this.kickTilt = tilt;
  }

  update(dt: number, targetX: number, targetY: number): void {
    const x = THREE.MathUtils.clamp(targetX, this.minX, this.maxX);
    this.followX += (x - this.followX) * Math.min(1, dt * 8);
    this.followY += (Math.max(0, targetY) * 0.35 - this.followY) * Math.min(1, dt * 5);

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
        this.rel(shot.pos, this.tmpA);
        this.rel(shot.toPos ?? shot.pos, this.tmpB);
        this.pos.lerpVectors(this.tmpA, this.tmpB, k);
        this.rel(shot.look, this.tmpA);
        this.rel(shot.toLook ?? shot.look, this.tmpB);
        this.look.lerpVectors(this.tmpA, this.tmpB, k);
        this.fov += ((shot.fov ?? 40) - this.fov) * Math.min(1, dt * 12);
      }
    }

    if (!this.shots.length) {
      this.followTarget(this.tmpA, this.tmpB);
      if (this.blendT > 0) {
        this.blendT = Math.max(0, this.blendT - dt);
        const k = smooth(1 - this.blendT / BLEND_BACK);
        this.pos.lerpVectors(this.blendPos, this.tmpA, k);
        this.look.lerpVectors(this.blendLook, this.tmpB, k);
        this.fov = this.blendFov + (FOLLOW_FOV - this.blendFov) * k;
      } else {
        this.pos.copy(this.tmpA);
        this.look.copy(this.tmpB);
        this.fov = FOLLOW_FOV;
      }
    }

    // 轻档推镜：沿视线方向靠近，再绕视线轻微倾斜
    let push = 0;
    let tilt = 0;
    if (this.kickT > 0) {
      this.kickT = Math.max(0, this.kickT - dt);
      const p = 1 - this.kickT / this.kickDur;
      const env = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
      push = this.kickPush * env;
      tilt = this.kickTilt * env;
    }
    this.tmpA.copy(this.pos);
    if (push) this.tmpA.lerp(this.look, push);
    if (this.shakeA > 0.001) {
      this.tmpA.x += (Math.random() - 0.5) * this.shakeA;
      this.tmpA.y += (Math.random() - 0.5) * this.shakeA;
      this.shakeA *= Math.max(0, 1 - dt * 9);
    }
    this.applyToCamera(this.tmpA, this.look, this.fov);
    if (tilt) this.camera.rotateZ(tilt);
  }

  private finish(): void {
    this.blendPos.copy(this.pos);
    this.blendLook.copy(this.look);
    this.blendFov = this.fov;
    this.blendT = BLEND_BACK;
    this.shots = [];
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  private rel(v: Vec3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.anchor.x + v[0] * this.facing, this.anchor.y + v[1], this.anchor.z + v[2]);
  }

  private followTarget(pos: THREE.Vector3, look: THREE.Vector3): void {
    pos.copy(FOLLOW_POS);
    pos.x += this.followX;
    pos.y += this.followY;
    look.copy(FOLLOW_LOOK);
    look.x += this.followX;
    look.y += this.followY;
  }

  private applyToCamera(pos: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
