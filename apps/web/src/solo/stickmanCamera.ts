import * as THREE from "three";

/**
 * 相机：平时是第三人称过肩视角，机位在角色斜后方约 45 度，高度略高于头顶，
 * 跟着角色的 3D 位置走，角色转身时相机平滑绕到另一侧。
 * 放大招时按一组「镜头」运镜，结束后平滑回到平时的机位。
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

const FOLLOW_FOV = 50;
/** 平时机位：角色身后 5.2、右侧 5.2（约 45 度斜后方），高 2.9 */
const CAM_BACK = 5.2;
const CAM_SIDE = 5.2;
const CAM_HEIGHT = 2.9;
/** 镜头看向角色前方 2.4 处，略低于头顶 */
const LOOK_AHEAD = 2.4;
const LOOK_HEIGHT = 1.5;
const LOOK_SIDE = -0.6;
/** 跳起时镜头跟着抬高的比例 */
const JUMP_LIFT = 0.35;
const BLEND_BACK = 0.25;

const smooth = (t: number) => t * t * (3 - 2 * t);

export class CameraDirector {
  readonly camera = new THREE.PerspectiveCamera(FOLLOW_FOV, 16 / 9, 0.1, 300);
  /** 关掉后只保留轻档（推镜、震屏），不再转相机 */
  enabled = true;
  /** 角色朝向平滑值：+1 朝右（镜头在左后方），-1 朝左 */
  private side = 1;
  private focus = new THREE.Vector3();
  private focusReady = false;
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

  /** 切房间或开局时直接跳到角色身后的机位 */
  snap(target: THREE.Vector3, facing: number): void {
    this.side = facing >= 0 ? 1 : -1;
    this.focus.copy(target);
    this.focusReady = true;
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

  /** 每帧更新：target 是角色位置，facing 是角色朝向（+1 或 -1） */
  update(dt: number, target: THREE.Vector3, facing: number): void {
    if (!this.focusReady) this.snap(target, facing);
    const kFocus = 1 - Math.exp(-dt * 7);
    this.focus.lerp(target, kFocus);
    this.side += ((facing >= 0 ? 1 : -1) - this.side) * (1 - Math.exp(-dt * 4));

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

  /** 平时机位：以平滑后的角色位置为中心，按朝向放到身后斜上方 */
  private followTarget(pos: THREE.Vector3, look: THREE.Vector3): void {
    const lift = Math.max(0, this.focus.y) * JUMP_LIFT;
    pos.set(
      this.focus.x - this.side * CAM_BACK,
      this.focus.y + CAM_HEIGHT + lift,
      this.focus.z + CAM_SIDE,
    );
    look.set(
      this.focus.x + this.side * LOOK_AHEAD,
      this.focus.y + LOOK_HEIGHT + lift * 0.5,
      this.focus.z + LOOK_SIDE,
    );
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
