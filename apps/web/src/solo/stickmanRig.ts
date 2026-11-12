import * as THREE from "three";

/**
 * 3D 火柴人：球形的头 + 胶囊体的躯干和四肢，用关节层级连起来。
 * 局部坐标里火柴人面朝 +x、头朝 +y；左侧在 -z，右侧（拿剑的手、离镜头近的一侧）在 +z。
 * 所有关节只绕 z 轴转：正角度表示往前（+x）摆，所以姿势可以像 2D 一样只写一组角度。
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
  /** 上身相对髋部扭转多少（跑步时肩和髋反向转，让上下身协调） */
  twist: number;
  /** 整个身体绕髋部前后翻（倒地、空翻用），正值是往后仰 */
  roll: number;
}

export type PartialPose = Partial<Pose>;

export const STANCE: Pose = {
  rootY: -0.08,
  lean: 0.12,
  neck: -0.05,
  shL: 0.35,
  elL: 0.9,
  shR: 0.55,
  elR: 0.9,
  hipL: -0.25,
  knL: -0.3,
  hipR: 0.3,
  knR: -0.4,
  wpn: 0.7,
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

export function runPose(phase: number, base: Pose = STANCE): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  return pose(
    {
      rootY: -0.06 + Math.abs(c) * 0.07,
      lean: 0.35,
      hipL: 0.75 * s,
      knL: -0.25 - 0.9 * Math.max(0, -c),
      hipR: -0.75 * s,
      knR: -0.25 - 0.9 * Math.max(0, c),
      shL: -0.6 * s,
      elL: 1.0,
      shR: 0.4 + 0.45 * s,
      elR: 1.1,
      wpn: 1.1,
      twist: -0.22 * s,
    },
    base,
  );
}

export function idlePose(t: number): Pose {
  const b = Math.sin(t * 2.4) * 0.03;
  return pose({ rootY: STANCE.rootY + b, shL: STANCE.shL + b, shR: STANCE.shR - b });
}

/** 常用姿势 */
export const P = {
  jumpUp: pose({ rootY: 0, lean: 0.05, hipL: 0.9, knL: -1.5, hipR: 0.35, knR: -0.9, shL: 1.6, elL: 0.5, shR: 2.3, elR: 0.4, wpn: 0.4 }),
  fall: pose({ rootY: 0, lean: 0.15, hipL: 0.3, knL: -0.4, hipR: -0.2, knR: -0.5, shL: 1.2, elL: 0.3, shR: 1.5, elR: 0.5, wpn: 0.6 }),
  hurt: pose({ lean: -0.45, neck: -0.4, shL: -0.6, elL: 0.3, shR: -0.4, elR: 0.5, hipL: 0.25, knL: -0.2, hipR: -0.25, knR: -0.3, wpn: 1.2 }),
  down: pose({ rootY: -0.86, roll: Math.PI / 2, lean: 0, neck: 0, shL: 2.6, elL: 0.2, shR: 2.9, elR: 0.3, hipL: 0.1, knL: -0.1, hipR: -0.1, knR: -0.2, wpn: 0.3 }),
  crouch: pose({ rootY: -0.4, lean: 0.4, hipL: -0.1, knL: -1.4, hipR: 1.1, knR: -1.3, shL: 0.6, elL: 0.6, shR: 0.5, elR: 0.8 }),
  overhead: pose({ rootY: -0.02, lean: -0.15, neck: -0.2, shR: 3.1, elR: 0.05, wpn: 0, shL: 0.4, elL: 0.3, hipL: -0.3, knL: -0.2, hipR: 0.35, knR: -0.25 }),
};

export type Weapon = "sword" | "club" | "bow" | "hammer" | "spear" | "dagger" | "fist" | "fan" | "none";

export interface RigOptions {
  color: number;
  /** 自发光强度（主角发光，敌人只有一点） */
  glow: number;
  scale?: number;
  weapon: Weapon;
  /** 主角用：给身体加一圈黑色描边 */
  outline?: boolean;
  hat?: boolean;
  shield?: boolean;
  quiver?: boolean;
  crown?: boolean;
  cape?: boolean;
}

/** 碎裂后飞散的肢体 */
export interface Debris {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** 四肢的半径：很细，看起来是线条 */
const LIMB = 0.024;
const UPPER_ARM = 0.42;
const FOREARM = 0.4;
const THIGH = 0.5;
const SHIN = 0.5;
const TORSO = 0.62;
export const HIP_HEIGHT = THIGH + SHIN;

/** 胶囊体，原点在顶端，向 -y 延伸（四肢用）；up=true 时向 +y（躯干用） */
function capsule(len: number, radius: number, upward = false): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, len, 3, 8);
  g.translate(0, upward ? len / 2 : -len / 2, 0);
  return g;
}

/** 所有火柴人共用几何体，只有材质各自一份（受击闪白要单独控制） */
const GEO = {
  upper: capsule(UPPER_ARM, LIMB),
  fore: capsule(FOREARM, LIMB),
  thigh: capsule(THIGH, LIMB * 1.1),
  shin: capsule(SHIN, LIMB),
  torso: capsule(TORSO, LIMB * 1.3, true),
  /** 头是一个细圆环，火柴人的线条风格 */
  head: new THREE.TorusGeometry(0.12, 0.02, 6, 22),
  /** 关节的小圆点，让肩、肘、髋、膝的位置一眼能看出来 */
  joint: new THREE.SphereGeometry(0.036, 8, 6),
  blade: new THREE.BoxGeometry(0.03, 1.15, 0.012).translate(0, -0.72, 0),
  guard: new THREE.BoxGeometry(0.14, 0.03, 0.04).translate(0, -0.12, 0),
  spearShaft: new THREE.CylinderGeometry(0.014, 0.014, 1.9, 5),
  spearTip: new THREE.ConeGeometry(0.045, 0.32, 5).rotateX(Math.PI).translate(0, -0.16, 0),
  dagger: new THREE.BoxGeometry(0.03, 0.5, 0.01).translate(0, -0.25, 0),
  knuckle: new THREE.BoxGeometry(0.16, 0.13, 0.13),
  fan: new THREE.CircleGeometry(0.42, 16, -0.6, 1.2).rotateZ(-Math.PI / 2),
  club: new THREE.CylinderGeometry(0.11, 0.05, 0.75, 7).translate(0, -0.42, 0),
  hammerHandle: new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6).translate(0, -0.5, 0),
  hammerHead: new THREE.BoxGeometry(0.5, 0.32, 0.32).translate(0, -1.05, 0),
  bow: new THREE.TorusGeometry(0.42, 0.025, 4, 16, Math.PI).rotateZ(-Math.PI / 2),
  shield: new THREE.BoxGeometry(0.08, 0.7, 0.55),
  hat: new THREE.ConeGeometry(0.2, 0.42, 8).translate(0, 0.32, 0),
  quiver: new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6),
  crown: new THREE.CylinderGeometry(0.2, 0.17, 0.14, 8, 1, true).translate(0, 0.22, 0),
  cape: new THREE.PlaneGeometry(0.5, 0.95).translate(0, -0.45, 0),
};

/** 把一个材质的颜色值放大，配合辉光后期发光 */
export const glowMat = (color: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });

export interface Model {
  readonly group: THREE.Group;
  /** 0~1，受击闪白 */
  flash(k: number): void;
  /** 元素染色，null 恢复原色 */
  tint(color: number | null, k?: number): void;
  setOpacity(o: number): void;
  shatter(scene: THREE.Scene, push: THREE.Vector3): Debris[];
  dispose(): void;
}

export class StickRig implements Model {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
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
  private cape: THREE.Mesh | null = null;
  readonly mat: THREE.MeshStandardMaterial;
  private baseColor: THREE.Color;
  private baseEmissive: THREE.Color;
  private ownedMats: THREE.Material[] = [];
  /** 武器尖端和根部（局部坐标），用来画剑光拖尾 */
  private tipLocal = new THREE.Vector3(0, -1.3, 0);
  private baseLocal = new THREE.Vector3(0, -0.2, 0);
  private limbs: THREE.Mesh[] = [];
  readonly scale: number;

  constructor(opts: RigOptions) {
    this.scale = opts.scale ?? 1;
    this.baseColor = new THREE.Color(opts.color);
    this.baseEmissive = new THREE.Color(opts.color).multiplyScalar(opts.glow);
    this.mat = new THREE.MeshStandardMaterial({
      color: this.baseColor.clone(),
      emissive: this.baseEmissive.clone(),
      roughness: 0.55,
      metalness: 0.05,
    });
    this.ownedMats.push(this.mat);
    this.currentEmissive.copy(this.baseEmissive);
    const outlineMat = opts.outline ? new THREE.MeshBasicMaterial({ color: 0x05060a, side: THREE.BackSide }) : null;
    if (outlineMat) this.ownedMats.push(outlineMat);

    const limb = (parent: THREE.Object3D, geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, this.mat);
      if (outlineMat) {
        const o = new THREE.Mesh(geo, outlineMat);
        o.scale.set(1.2, 1.03, 1.2);
        m.add(o);
      }
      parent.add(m);
      this.limbs.push(m);
      return m;
    };

    this.group.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = HIP_HEIGHT;
    this.hips.add(this.spine);
    limb(this.spine, GEO.torso);
    const chest = new THREE.Group();
    chest.position.y = TORSO;
    this.spine.add(chest);
    chest.add(this.neck);
    this.neck.position.y = 0.05;
    const head = limb(this.neck, GEO.head);
    head.position.y = 0.24;

    const joint = (parent: THREE.Object3D) => {
      const m = new THREE.Mesh(GEO.joint, this.mat);
      parent.add(m);
      this.limbs.push(m);
    };

    for (const [sh, el, z] of [
      [this.shL, this.elL, -0.16],
      [this.shR, this.elR, 0.16],
    ] as const) {
      sh.position.set(0, -0.02, z);
      chest.add(sh);
      limb(sh, GEO.upper);
      joint(sh);
      el.position.y = -UPPER_ARM;
      sh.add(el);
      limb(el, GEO.fore);
      joint(el);
    }
    for (const [hip, kn, z] of [
      [this.hipL, this.knL, -0.1],
      [this.hipR, this.knR, 0.1],
    ] as const) {
      hip.position.z = z;
      this.hips.add(hip);
      limb(hip, GEO.thigh);
      joint(hip);
      kn.position.y = -THIGH;
      hip.add(kn);
      limb(kn, GEO.shin);
      joint(kn);
    }

    // 武器挂在右手（前臂末端）
    this.weapon.position.y = -FOREARM;
    this.elR.add(this.weapon);
    const metal = new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 0.7 });
    this.ownedMats.push(metal);
    switch (opts.weapon) {
      case "sword": {
        const blade = new THREE.Mesh(GEO.blade, glowMat(0xbfefff, 1.6));
        this.ownedMats.push(blade.material as THREE.Material);
        const guard = new THREE.Mesh(GEO.guard, glowMat(0xffd27a, 1.4));
        this.ownedMats.push(guard.material as THREE.Material);
        this.weapon.add(blade, guard);
        this.limbs.push(blade);
        break;
      }
      case "club":
        this.weapon.add(new THREE.Mesh(GEO.club, metal));
        this.tipLocal.set(0, -0.8, 0);
        break;
      case "hammer": {
        const head = new THREE.Mesh(GEO.hammerHead, new THREE.MeshStandardMaterial({ color: 0x3a3a44, metalness: 0.6, roughness: 0.4 }));
        this.ownedMats.push(head.material as THREE.Material);
        this.weapon.add(new THREE.Mesh(GEO.hammerHandle, metal), head);
        this.tipLocal.set(0, -1.1, 0);
        break;
      }
      case "bow": {
        const bow = new THREE.Mesh(GEO.bow, metal);
        bow.position.y = -FOREARM;
        this.elL.add(bow);
        break;
      }
      case "spear": {
        const shaft = new THREE.Mesh(GEO.spearShaft, metal);
        shaft.position.y = -0.95;
        const tip = new THREE.Mesh(GEO.spearTip, glowMat(0xdffcff, 1.8));
        this.ownedMats.push(tip.material as THREE.Material);
        tip.position.y = -1.9;
        this.weapon.add(shaft, tip);
        this.tipLocal.set(0, -2.2, 0);
        this.baseLocal.set(0, -0.3, 0);
        break;
      }
      case "dagger": {
        const blade = new THREE.Mesh(GEO.dagger, glowMat(0xdfe8ff, 1.5));
        this.ownedMats.push(blade.material as THREE.Material);
        this.weapon.add(blade);
        this.tipLocal.set(0, -0.55, 0);
        break;
      }
      case "fist": {
        const knuckle = new THREE.Mesh(GEO.knuckle, new THREE.MeshStandardMaterial({ color: 0xc9a64a, metalness: 0.7, roughness: 0.35 }));
        this.ownedMats.push(knuckle.material as THREE.Material);
        knuckle.position.y = -0.05;
        this.weapon.add(knuckle);
        this.tipLocal.set(0, -0.1, 0);
        this.baseLocal.set(0, 0, 0);
        break;
      }
      case "fan": {
        const fan = new THREE.Mesh(GEO.fan, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(1.2), side: THREE.DoubleSide }));
        this.ownedMats.push(fan.material as THREE.Material);
        fan.position.y = -0.05;
        this.weapon.add(fan);
        this.tipLocal.set(0, -0.42, 0);
        this.baseLocal.set(0, -0.05, 0);
        break;
      }
      case "none":
        break;
    }
    if (opts.shield) {
      const shield = new THREE.Mesh(GEO.shield, new THREE.MeshStandardMaterial({ color: 0x5a6470, metalness: 0.6, roughness: 0.35 }));
      this.ownedMats.push(shield.material as THREE.Material);
      shield.position.set(0.1, -FOREARM * 0.6, -0.08);
      this.elL.add(shield);
    }
    if (opts.hat) {
      const hat = new THREE.Mesh(GEO.hat, new THREE.MeshStandardMaterial({ color: 0x7a3a1a, roughness: 0.8 }));
      this.ownedMats.push(hat.material as THREE.Material);
      hat.rotation.z = -0.35;
      head.add(hat);
    }
    if (opts.crown) {
      const crown = new THREE.Mesh(GEO.crown, glowMat(0xffc83a, 1.6));
      this.ownedMats.push(crown.material as THREE.Material);
      head.add(crown);
    }
    if (opts.quiver) {
      const q = new THREE.Mesh(GEO.quiver, metal);
      q.position.set(-0.14, 0.35, 0);
      q.rotation.z = 0.4;
      this.spine.add(q);
    }
    if (opts.cape) {
      const capeMat = new THREE.MeshStandardMaterial({ color: 0x8a1a2a, side: THREE.DoubleSide, roughness: 0.9 });
      this.ownedMats.push(capeMat);
      this.cape = new THREE.Mesh(GEO.cape, capeMat);
      this.cape.position.set(-0.12, 0, 0);
      this.cape.rotation.y = Math.PI / 2;
      chest.add(this.cape);
    }
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
    if (this.cape) this.cape.rotation.x = 0.15 + Math.max(0, p.lean) * 0.6;
  }

  /** 剑尖和剑根的世界坐标 */
  weaponEnds(tip: THREE.Vector3, base: THREE.Vector3): void {
    this.weapon.updateWorldMatrix(true, false);
    tip.copy(this.tipLocal).applyMatrix4(this.weapon.matrixWorld);
    base.copy(this.baseLocal).applyMatrix4(this.weapon.matrixWorld);
  }

  flash(k: number): void {
    this.mat.emissive.copy(this.currentEmissive).lerp(WHITE, Math.min(1, k));
  }

  private currentEmissive = new THREE.Color();
  private tintKey: number | null = null;

  tint(color: number | null, k = 0.8): void {
    const key = color === null ? null : color * 10 + k;
    if (key === this.tintKey) return;
    this.tintKey = key;
    if (color === null) {
      this.mat.color.copy(this.baseColor);
      this.currentEmissive.copy(this.baseEmissive);
    } else {
      const c = new THREE.Color(color);
      this.mat.color.copy(this.baseColor).lerp(c, k);
      this.currentEmissive.copy(this.baseEmissive).lerp(c.multiplyScalar(0.9), k);
    }
    this.mat.emissive.copy(this.currentEmissive);
  }

  setOpacity(o: number): void {
    for (const m of this.ownedMats) {
      m.transparent = o < 1;
      m.opacity = o;
    }
  }

  shatter(scene: THREE.Scene, push: THREE.Vector3): Debris[] {
    this.group.updateWorldMatrix(true, true);
    const out: Debris[] = [];
    for (const m of this.limbs) {
      scene.attach(m);
      out.push({
        mesh: m,
        vel: new THREE.Vector3(push.x * (0.5 + Math.random()) + (Math.random() - 0.5) * 3, 3 + Math.random() * 5 + push.y, (Math.random() - 0.5) * 4),
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        life: 1.6,
      });
    }
    this.group.removeFromParent();
    return out;
  }

  /** 复制一个半透明的残影（共用几何体，材质单独一份） */
  ghost(color: number, opacity: number): { group: THREE.Group; mat: THREE.MeshBasicMaterial } {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(1.4),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.group.updateWorldMatrix(true, true);
    const g = new THREE.Group();
    for (const m of this.limbs) {
      const c = new THREE.Mesh(m.geometry, mat);
      m.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      g.add(c);
    }
    return { group: g, mat };
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.ownedMats) m.dispose();
  }
}

const WHITE = new THREE.Color(1.6, 1.6, 1.6);

/** 自爆虫：红色圆球加四条腿，不是火柴人 */
export class BugModel implements Model {
  readonly group = new THREE.Group();
  private bodyMesh: THREE.Mesh;
  private legs: THREE.Mesh[] = [];
  readonly mat: THREE.MeshStandardMaterial;
  private eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private base: THREE.Color;
  private parts: THREE.Mesh[] = [];

  constructor(color: number, scale = 1) {
    this.base = new THREE.Color(color);
    this.mat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.25), roughness: 0.5 });
    this.bodyMesh = new THREE.Mesh(BUG_GEO.body, this.mat);
    this.bodyMesh.position.y = 0.6;
    this.group.add(this.bodyMesh);
    this.parts.push(this.bodyMesh);
    for (const z of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(BUG_GEO.eye, this.eyeMat);
      eye.position.set(0.36, 0.12, z);
      this.bodyMesh.add(eye);
    }
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(BUG_GEO.leg, this.mat);
      const front = i < 2 ? 1 : -1;
      const side = i % 2 ? 1 : -1;
      leg.position.set(front * 0.2, 0.45, side * 0.22);
      leg.rotation.x = side * 0.6;
      this.group.add(leg);
      this.legs.push(leg);
      this.parts.push(leg);
    }
    this.group.scale.setScalar(scale);
  }

  animate(t: number, moving: boolean, fuse: number): void {
    const s = moving ? Math.sin(t * 22) * 0.5 : 0;
    this.legs.forEach((l, i) => (l.rotation.z = (i % 2 ? s : -s) + (i < 2 ? 0.3 : -0.3)));
    this.bodyMesh.position.y = 0.6 + (moving ? Math.abs(Math.sin(t * 22)) * 0.06 : 0);
    const k = fuse > 0 ? 1 + fuse * 0.35 : 1;
    this.bodyMesh.scale.setScalar(k);
    if (fuse > 0) this.mat.emissive.setRGB(1, 0.2, 0.1).multiplyScalar(Math.sin(t * (10 + fuse * 30)) > 0 ? 2 : 0.3);
  }

  flash(k: number): void {
    this.mat.emissive.copy(this.base).multiplyScalar(0.25).lerp(WHITE, Math.min(1, k));
  }

  tint(color: number | null, k = 0.8): void {
    this.mat.color.copy(this.base);
    if (color !== null) this.mat.color.lerp(new THREE.Color(color), k);
  }

  setOpacity(o: number): void {
    this.mat.transparent = o < 1;
    this.mat.opacity = o;
  }

  shatter(scene: THREE.Scene, push: THREE.Vector3): Debris[] {
    this.group.updateWorldMatrix(true, true);
    const out: Debris[] = this.parts.map((m) => {
      scene.attach(m);
      return {
        mesh: m,
        vel: new THREE.Vector3(push.x + (Math.random() - 0.5) * 5, 4 + Math.random() * 4, (Math.random() - 0.5) * 5),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        life: 1.2,
      };
    });
    this.group.removeFromParent();
    return out;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mat.dispose();
    this.eyeMat.dispose();
  }
}

const BUG_GEO = {
  body: new THREE.SphereGeometry(0.42, 14, 10),
  eye: new THREE.SphereGeometry(0.07, 8, 6),
  leg: capsule(0.42, 0.05),
};
