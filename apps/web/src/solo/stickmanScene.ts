import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { sfx, vibrate } from "../sound";
import { CameraDirector, type Shot } from "./stickmanCamera";
import {
  BOSS,
  ELEMENT_COLOR,
  ENEMIES,
  MAX_SKILL_LEVEL,
  MAX_SLOTS,
  ROOMS,
  SKILLS,
  ROLES,
  type RoleId,
  STATS,
  gradeFor,
  type Card,
  type Element,
  type EnemyKind,
  type Grade,
  type SkillId,
  type Spawn,
  type StatId,
} from "./stickmanData";
import { buildTheme, type Theme } from "./stickmanTheme";
import { DamageNumbers, FXGEO, FxSystem, Particles, Trail, type NumberStyle } from "./stickmanFx";
import { BugModel, P, STANCE, StickRig, glowMat, idlePose, keyed, mixPose, pose, runPose, type Debris, type Model, type Pose } from "./stickmanRig";

/**
 * 火柴人刷图：单人 2.5D 横版动作闯关，纯前端运行。
 * 逻辑坐标：x 横向（房间从 0 到 width）、z 纵深（-3 ~ 3，负值离镜头远）、y 高度。
 * 攻击判定只在逻辑坐标里做，画面是 3D 的，相机平时是第三人称过肩视角，放大招时运镜。
 */

// ================= 对外接口 =================

export type StickAction = "attack" | "jump" | "dodge" | "awaken" | number;

export interface SkillSlotHud {
  id: SkillId;
  name: string;
  icon: string;
  /** 剩余冷却占比 0~1 */
  cd: number;
  mpOk: boolean;
  level: number;
}

export interface StickHud {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  combo: number;
  awaken: number;
  skills: SkillSlotHud[];
  room: number;
  rooms: number;
  roomName: string;
  boss: { name: string; hp: number; max: number; bars: number } | null;
  score: number;
  doorOpen: boolean;
  dodgeCd: number;
  air: boolean;
}

export interface StickBanner {
  kind: "info" | "clear" | "boss" | "element" | "warn";
  text: string;
}

export interface StickResult {
  victory: boolean;
  score: number;
  grade: Grade;
  seconds: number;
  kills: number;
  maxCombo: number;
  hitsTaken: number;
  elementCombos: number;
  revived: boolean;
  breakdown: { label: string; value: number }[];
}

export interface StickHooks {
  onHud: (hud: StickHud) => void;
  onBanner: (b: StickBanner) => void;
  onCards: (cards: Card[]) => void;
  onDeath: (canRevive: boolean) => void;
  onResult: (r: StickResult) => void;
  /** 中 / 重档运镜开始和结束，界面据此隐藏按键、显示「点击跳过」 */
  onCine: (active: boolean) => void;
  onFlash: (kind: "white" | "red") => void;
  /** 觉醒时的画面主色调，null 表示恢复 */
  onTint: (color: number | null) => void;
  /** 切房间时黑场 */
  onFade: (on: boolean) => void;
}

// ================= 常量 =================

const GRAVITY = 32;
const Z_LIMIT = 3;
const PLAYER_HP = 1200;
const PLAYER_MP = 100;
const BASE_ATK = 100;
const MP_REGEN = 4;
const JUMP_VEL = 12.5;
const RUN_X = 6.5;
const RUN_Z = 4.2;
const COMBO_WINDOW = 2;
const MAX_ATTACKERS = 3;
const MEDIUM_COOLDOWN = 3;
const MEDIUM_SLOWMO = 0.3;
const SWORD_COUNT = 100;
const WHITE_SWORD = 0xbfefff;
const ICE = ELEMENT_COLOR.ice;
const FIRE = ELEMENT_COLOR.fire;
const THUNDER = ELEMENT_COLOR.thunder;
const CINE_KEY = "party.solo.stickman.cine";

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pickOne = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;
const clamp = THREE.MathUtils.clamp;
const sign = (v: number) => (v < 0 ? -1 : 1);
const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
};

// ================= 主角姿势 =================

const A1: [number, Pose][] = [
  [0, pose({ shR: 2.7, elR: 0.5, wpn: 0.4, lean: -0.05, shL: -0.2 })],
  [0.3, pose({ shR: 1.0, elR: 0.05, wpn: 0.3, lean: 0.4, shL: -0.5, hipR: 0.6, knR: -0.5, hipL: -0.5 })],
  [1, pose({ shR: 0.5, elR: 0.3, wpn: 0.3, lean: 0.3, hipR: 0.55, knR: -0.5, hipL: -0.45 })],
];
const A2: [number, Pose][] = [
  [0, pose({ shR: 0.1, elR: 0.3, wpn: 0.6, lean: 0.35, rootY: -0.15 })],
  [0.35, pose({ shR: 2.6, elR: 0.1, wpn: 0.2, lean: -0.1, shL: 0.6 })],
  [1, pose({ shR: 2.3, elR: 0.3, wpn: 0.3, lean: 0 })],
];
const A3: [number, Pose][] = [
  [0, pose({ shR: -0.6, elR: 1.3, wpn: 0.9, lean: -0.1, hipR: 0.2, rootY: -0.1 })],
  [0.3, pose({ shR: 1.55, elR: 0, wpn: 0, lean: 0.6, hipR: 1.0, knR: -0.6, hipL: -0.8, knL: -0.2, rootY: -0.25, shL: -0.8 })],
  [1, pose({ shR: 1.3, elR: 0.2, wpn: 0.2, lean: 0.45, hipR: 0.9, knR: -0.6, hipL: -0.7, knL: -0.2, rootY: -0.2, shL: -0.5 })],
];
const AIR_SLASH: [number, Pose][] = [
  [0, pose({ shR: 3.0, elR: 0.2, wpn: 0.2, hipL: 0.8, knL: -1.4, hipR: 0.4, knR: -1.0, lean: -0.1, rootY: 0 })],
  [0.25, pose({ shR: 0.6, elR: 0.1, wpn: 0.5, lean: 0.6, hipL: 0.6, knL: -1.2, hipR: 0.9, knR: -0.8, rootY: 0 })],
];
const RISE: [number, Pose][] = [
  [0, pose({ shR: 0.1, elR: 0.3, wpn: 1.0 }, P.crouch)],
  [0.35, pose({ shR: 3.1, elR: 0, wpn: 0, lean: -0.25, neck: -0.3, hipL: -0.2, knL: -0.6, hipR: 0.7, knR: -1.2, rootY: 0 })],
  [1, pose({ shR: 2.9, elR: 0.2, wpn: 0.1, lean: -0.1, hipL: 0.5, knL: -1.2, hipR: 0.7, knR: -1.0, rootY: 0 })],
];
const DASH = pose({ lean: 0.75, shR: 1.6, elR: 0, wpn: 0, shL: -0.9, elL: 0.4, hipR: 1.1, knR: -0.5, hipL: -1.0, knL: -0.3, rootY: -0.3 });
const SPIN = pose({ shR: 1.57, elR: 0, wpn: 0, shL: 1.4, elL: 0.1, lean: 0.1, rootY: -0.15, hipL: -0.4, hipR: 0.4, knL: -0.4, knR: -0.4 });
const CRESCENT: [number, Pose][] = [
  [0, pose({ shR: 3.2, elR: 0.3, wpn: 0.3, lean: -0.3, shL: 0.8 })],
  [0.3, pose({ shR: 1.4, elR: 0, wpn: 0.1, lean: 0.55, shL: -0.6, hipR: 0.8, knR: -0.6, hipL: -0.6, rootY: -0.2 })],
  [1, pose({ shR: 1.1, elR: 0.2, wpn: 0.2, lean: 0.4, shL: -0.4, hipR: 0.7, knR: -0.6, hipL: -0.5, rootY: -0.15 })],
];
const DANCE_A = pose({ shR: 2.8, elR: 0.2, wpn: 0.4, lean: -0.2, hipL: 0.8, knL: -1.3, hipR: 0.2, knR: -0.6, rootY: 0 });
const DANCE_B = pose({ shR: 0.4, elR: 0.1, wpn: 0.8, lean: 0.5, hipL: 0.3, knL: -0.8, hipR: 0.9, knR: -1.2, rootY: 0 });
const SLAM = pose({ shR: 0.8, elR: 0, wpn: 0.6, lean: 0.7, rootY: -0.45, hipR: 1.2, knR: -1.5, hipL: -0.3, knL: -1.4 });
const PUNCH: [number, Pose][] = [
  [0, pose({ shL: -0.6, elL: 1.8, lean: -0.15, shR: -0.3, elR: 0.6, wpn: 0.6 })],
  [0.3, pose({ shL: 1.6, elL: 0, lean: 0.55, hipR: 0.9, knR: -0.6, hipL: -0.7, rootY: -0.2, shR: -0.3, elR: 0.6, wpn: 0.6 })],
  [1, pose({ shL: 1.4, elL: 0.2, lean: 0.4, hipR: 0.8, knR: -0.6, hipL: -0.6, rootY: -0.15, shR: -0.2, elR: 0.6, wpn: 0.6 })],
];
const KNEEL = pose({ rootY: -0.5, hipR: 1.4, knR: -1.6, hipL: -0.3, knL: -1.7, shR: 1.0, elR: 0.5, wpn: -1.2, lean: 0.35, shL: 0.6 });
const AWAKEN = pose({ shR: 3.14, elR: 0, wpn: 0, shL: 0.5, elL: 0.3, lean: -0.15, neck: -0.25, rootY: 0 });
const DODGE = pose({ lean: 0.5, rootY: -0.35, hipL: -0.2, knL: -1.6, hipR: 1.2, knR: -1.4, shL: 0.8, shR: 0.4, wpn: 1.4 });

// ================= 敌人姿势 =================

const E_POSE = {
  clubUp: pose({ shR: 2.9, elR: 0.4, wpn: 0.3, lean: -0.2 }),
  clubDown: pose({ shR: 0.5, elR: 0.2, wpn: 0.6, lean: 0.5, hipR: 0.6, knR: -0.5 }),
  bowDraw: pose({ shL: 1.57, elL: 0, shR: 1.45, elR: 2.2, lean: 0, wpn: 0 }),
  bowRelease: pose({ shL: 1.57, elL: 0, shR: 1.0, elR: 0.5, lean: -0.1, wpn: 0 }),
  guard: pose({ shL: 1.2, elL: 1.4 }),
  bashUp: pose({ shL: 0.8, elL: 1.2, lean: -0.25 }),
  bash: pose({ shL: 1.6, elL: 0.2, lean: 0.6, hipR: 0.7, knR: -0.5, hipL: -0.6 }),
  hammerUp: pose({ shR: 3.0, elR: 0.5, wpn: 0.2, shL: 2.6, elL: 0.4, lean: -0.3, rootY: 0 }),
  smash: pose({ shR: 0.4, elR: 0.1, wpn: 0.9, shL: 0.5, lean: 0.6, rootY: -0.3, hipR: 0.8, knR: -0.8, hipL: -0.5, knL: -0.5 }),
  roar: pose({ shL: 2.4, shR: 2.6, elL: 0.6, elR: 0.6, lean: -0.4, neck: -0.5, wpn: 0.5 }),
};

// ================= 内部类型 =================

interface HitInfo {
  dmg: number;
  kb: number;
  up: number;
  hitstop: number;
  element: Element | null;
  heavy: boolean;
  radial?: boolean;
  fromAbove?: boolean;
  /** 感电弹射出来的伤害，不再继续弹 */
  chain?: boolean;
  burnMul?: number;
  /** 空中连舞：把敌人定在空中 */
  hold?: boolean;
  /** 不显示为元素组合（组合爆炸本身的伤害） */
  noCombo?: boolean;
  color?: number;
}

interface HitBox extends HitInfo {
  t: number;
  dur: number;
  delay: number;
  /** 跟着主角走：x 是相对主角朝向的偏移 */
  follow: boolean;
  ox: number;
  x: number;
  z: number;
  facing: number;
  shape: "box" | "circle";
  hw: number;
  hd: number;
  r: number;
  y0: number;
  y1: number;
  vx: number;
  vz: number;
  /** 0：每个目标只打一次；否则每隔这么久可以再打一次 */
  interval: number;
  hitT: Map<object, number>;
  pull: number;
  onHit?: (e: Enemy) => void;
}

type PActKind = "atk1" | "atk2" | "atk3" | "airAtk" | "skill" | "dodge" | "hurt" | "down" | "getup" | "awaken" | "dead";

interface PAct {
  kind: PActKind;
  skill?: SkillId;
  t: number;
  prev: number;
  dur: number;
  /** 从这个时间起可以取消到别的动作 */
  cancel: number;
  hitList: Enemy[];
  n: number;
  phase: number;
  dir: THREE.Vector3;
  landed: boolean;
}

interface Player {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: number;
  hp: number;
  maxHp: number;
  mp: number;
  rig: StickRig;
  shadow: THREE.Mesh;
  act: PAct | null;
  invuln: number;
  airSkills: number;
  runPhase: number;
  moving: boolean;
  dodgeCd: number;
  dodgeBuff: number;
  ghostIn: number;
  onLand: (() => void) | null;
}

type EState =
  | "spawn"
  | "move"
  | "windup"
  | "recover"
  | "hit"
  | "air"
  | "down"
  | "getup"
  | "fuse"
  | "dead"
  | "bIdle"
  | "bSmash"
  | "bLeap"
  | "bSummon"
  | "bStagger"
  | "bIntro";

interface Enemy {
  kind: EnemyKind | "boss";
  name: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: number;
  hp: number;
  maxHp: number;
  dmg: number;
  speed: number;
  score: number;
  radius: number;
  height: number;
  model: Model;
  rig: StickRig | null;
  bug: BugModel | null;
  shadow: THREE.Mesh;
  elite: boolean;
  boss: boolean;
  state: EState;
  t: number;
  /** 上一帧的 t，用来判断时间点是否在这一帧刚好经过 */
  pt: number;
  /** Boss 跳跃时由脚本直接控制位置 */
  noPhys: boolean;
  atkCd: number;
  token: boolean;
  hitstun: number;
  airHits: number;
  hang: number;
  burn: number;
  burnDps: number;
  burnTick: number;
  freeze: number;
  slow: number;
  shock: number;
  shockCd: number;
  frozenBy: Set<object>;
  flash: number;
  wanderZ: number;
  wanderX: number;
  wanderT: number;
  tele: { mesh: THREE.Object3D; until: number }[];
  anim: number;
  dead: boolean;
  /** Boss 用 */
  bars: number;
  enraged: boolean;
  summonCd: number;
  aim: THREE.Vector3;
  from: THREE.Vector3;
  pts: THREE.Vector3[];
  step: number;
}

interface Prop {
  kind: "crate" | "barrel";
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  dead: boolean;
}

interface DropItem {
  kind: "coin" | "hp" | "mp";
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
}

interface EnemyShot {
  pos: THREE.Vector3;
  vx: number;
  mesh: THREE.Mesh;
  dmg: number;
  life: number;
}

interface FrostField {
  pos: THREE.Vector3;
  r: number;
  t: number;
  dur: number;
  follow: boolean;
  spikeMul: number;
  respike: boolean;
  spikeT: number;
  disk: THREE.Object3D;
  snowT: number;
}

interface FirePatch {
  pos: THREE.Vector3;
  t: number;
  tick: number;
}

interface ShockWave {
  pos: THREE.Vector3;
  r: number;
  max: number;
  speed: number;
  hit: boolean;
  dmg: number;
}

interface DebrisSet {
  items: Debris[];
  model: Model;
  t: number;
}

interface Ghost {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
}

interface Script {
  t: number;
  end: number;
  events: { at: number; fn: () => void; done: boolean }[];
  update?: (t: number, dt: number) => void;
  onEnd?: () => void;
}

/** 觉醒技里的一把飞剑 */
interface FlyingSword {
  home: THREE.Vector3;
  dir: THREE.Vector3;
  appear: number;
  launch: number;
  flight: number;
  target: Enemy | null;
  goal: THREE.Vector3;
  done: boolean;
}

type GameState = "ready" | "playing" | "cards" | "transition" | "dead" | "over";

const KEY_ACTIONS: Record<string, StickAction> = {
  j: "attack",
  k: "jump",
  l: "dodge",
  shift: "dodge",
  " ": "awaken",
  u: 0,
  i: 1,
  o: 2,
  y: 3,
  h: 4,
  n: 5,
};

/** 带一点起伏的低多边形岩石 */
function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) * Math.sin(v.z * 3.7 + seed * 0.7) * 0.28;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** 大招的运镜、时间点和效果 */
interface AwakenPlan {
  shots: Shot[];
  end: number;
  events: { at: number; fn: () => void }[];
}

export class StickmanScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private director = new CameraDirector();
  private clock = new THREE.Clock();
  private resizeObserver: ResizeObserver;
  private hemi = new THREE.HemisphereLight(0x9aa8d0, 0x2a1a10, 0.9);
  private sun = new THREE.DirectionalLight(0xfff0dd, 1.3);

  // ---- 共用资源 ----
  private rockGeos = [0, 1, 2, 3].map((s) => rockGeometry(s * 1.9 + 0.4));
  private rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3440, roughness: 0.95, flatShading: true });
  private rockMat2 = new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 0.95, flatShading: true });
  private shadowGeo = new THREE.CircleGeometry(0.5, 20);
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
  private crateGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  private crateMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.9, flatShading: true });
  private barrelGeo = new THREE.CylinderGeometry(0.38, 0.42, 0.95, 12);
  private barrelMat = new THREE.MeshStandardMaterial({ color: 0xa02a1a, emissive: new THREE.Color(0x400800), roughness: 0.6 });
  private coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14).rotateX(Math.PI / 2);
  private potionGeo = new THREE.SphereGeometry(0.2, 12, 8);
  private dropMats = { coin: glowMat(0xffc83a, 1.6), hp: glowMat(0xff3a4a, 1.8), mp: glowMat(0x3a8aff, 1.8) };
  private arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5).rotateZ(Math.PI / 2);
  private arrowMat = glowMat(0xffe08a, 1.8);
  private swordMesh: THREE.InstancedMesh;
  private bigSword: THREE.Mesh;
  private env = new THREE.Group();
  private doorMat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private role: RoleId = "sword";
  private theme: Theme | null = null;
  private lastDodge = -99;
  private bellT = 0;
  private stealthT = 0;
  private traps: { pos: THREE.Vector3; r: number; t: number; dur: number; tick: number }[] = [];

  private fx: FxSystem;
  private sparks = new Particles(2500, 0.14);
  private puffs = new Particles(700, 0.45);
  private numbers: DamageNumbers;
  private trail = new Trail(14);

  // ---- 游戏状态 ----
  private state: GameState = "ready";
  private paused = false;
  private player!: Player;
  private enemies: Enemy[] = [];
  private props: Prop[] = [];
  private drops: DropItem[] = [];
  private hits: HitBox[] = [];
  private shots: EnemyShot[] = [];
  private fields: FrostField[] = [];
  private patches: FirePatch[] = [];
  private waves: ShockWave[] = [];
  private debris: DebrisSet[] = [];
  private ghosts: Ghost[] = [];
  private timers: { t: number; fn: () => void }[] = [];
  private script: Script | null = null;
  private swords: FlyingSword[] = [];

  private roomIdx = 0;
  private roomW = 30;
  private wave = 0;
  private waveDelay = 0;
  private pendingSpawns = 0;
  private roomCleared = false;
  private doorOpen = false;
  private transitionT = 0;
  private boss: Enemy | null = null;

  private time = 0;
  private playTime = 0;
  private realTime = 0;
  private hitstop = 0;
  private slowT = 0;
  private timeScale = 1;
  private cineLock = 0;
  private lastMedium = -99;
  private deadT = 0;
  private hudIn = 0;
  private hitSoundIn = 0;

  // ---- 成长 ----
  private slots: SkillId[] = [];
  private cds: Partial<Record<SkillId, number>> = {};
  private levels: Partial<Record<SkillId, number>> = {};
  private upgrades = new Set<string>();
  private stats: Record<StatId, number> = { crit: 0, atk: 0, mpRegen: 0, maxHp: 0, dodgeBuff: 0, cdr: 0 };
  private dashCharge = 0;
  private awaken = 0;

  // ---- 计分 ----
  private killScore = 0;
  private gold = 0;
  private kills = 0;
  private combo = 0;
  private comboT = 0;
  private maxCombo = 0;
  private hitsTaken = 0;
  private elementCombos = 0;
  private revived = false;

  // ---- 画质 ----
  private quality = 2;
  private frameSum = 0;
  private frameCount = 0;
  private warmup = 90;

  // ---- 输入 ----
  private keys = new Set<string>();
  private stick = new THREE.Vector2();
  private buffered: { a: StickAction; t: number } | null = null;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private hilt = new THREE.Vector3();
  private mat4 = new THREE.Matrix4();
  private quat = new THREE.Quaternion();

  constructor(
    private container: HTMLElement,
    private hooks: StickHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);
    const camera = this.director.camera;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.4, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.director.enabled = localStorage.getItem(CINE_KEY) !== "off";
    this.fx = new FxSystem(this.scene);
    this.numbers = new DamageNumbers(this.scene);

    this.scene.background = new THREE.Color(0x07060c);
    this.scene.fog = new THREE.Fog(0x07060c, 40, 120);
    this.sun.position.set(-4, 10, 8);
    this.scene.add(this.hemi, this.sun, this.env, this.sparks.points, this.puffs.points, this.trail.mesh);

    this.swordMesh = new THREE.InstancedMesh(
      FXGEO.sword,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(WHITE_SWORD).multiplyScalar(2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
      SWORD_COUNT,
    );
    this.swordMesh.frustumCulled = false;
    this.swordMesh.visible = false;
    this.bigSword = new THREE.Mesh(
      FXGEO.sword,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0b0).multiplyScalar(2.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.bigSword.visible = false;
    this.scene.add(this.swordMesh, this.bigSword);

    this.player = this.makePlayer();
    this.buildRoom(0);
    this.director.snap(this.player.pos, this.player.facing);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.applyQuality();
    this.resize();
    this.renderer.setAnimationLoop(this.frame);

    // 开发时方便在控制台调试，比如 __stick.awaken = 1；生产构建会去掉
    if (import.meta.env.DEV) (window as unknown as { __stick: StickmanScene }).__stick = this;
  }

  // ================= 对外接口 =================

  start(role: RoleId): void {
    this.setRole(role);
    this.resetRun();
    this.state = "playing";
    this.paused = false;
    this.loadRoom(0);
  }

  private setRole(role: RoleId): void {
    this.role = role;
    this.player.rig.dispose();
    const rig = new StickRig({ color: 0xf4f8ff, glow: 0.55, weapon: ROLES[role].weapon, outline: true });
    this.scene.add(rig.group);
    this.player.rig = rig;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
    this.stick.set(0, 0);
    this.buffered = null;
  }

  get cinematics(): boolean {
    return this.director.enabled;
  }

  setCinematics(on: boolean): void {
    this.director.enabled = on;
    localStorage.setItem(CINE_KEY, on ? "on" : "off");
  }

  /** 摇杆：x 向右为正，y 向上（远离镜头）为正，长度不超过 1 */
  setStick(x: number, y: number): void {
    this.stick.set(x, y);
  }

  press(a: StickAction): void {
    if (this.state !== "playing" || this.paused) return;
    if (!this.exec(a)) this.buffered = { a, t: 0.25 };
  }

  chooseCard(card: Card): void {
    if (this.state !== "cards") return;
    this.applyCard(card);
    this.state = "playing";
    this.openDoor();
  }

  revive(): void {
    if (this.state !== "dead" || this.revived) return;
    this.revived = true;
    const p = this.player;
    p.hp = p.maxHp;
    p.mp = PLAYER_MP;
    p.invuln = 2.5;
    this.state = "playing";
    this.startAct("getup", 0.5, 0.5);
    this.timeScale = 1;
    this.slowT = 0;
    // 复活时把周围的敌人震开
    this.fx.spawn({ geo: FXGEO.ring, color: 0xfff0b0, k: 2.5, pos: [p.pos.x, 0.05, p.pos.z], rot: [-Math.PI / 2, 0, 0], scale: 0.5, scaleTo: 7, life: 0.6 });
    for (const e of this.enemies) {
      if (e.dead || e.boss) continue;
      const dx = e.pos.x - p.pos.x;
      if (Math.abs(dx) < 7) this.launch(e, sign(dx) * 7, 7);
    }
    sfx.gate();
    this.hooks.onBanner({ kind: "info", text: "复活！" });
  }

  giveUp(): void {
    if (this.state === "over") return;
    this.finish(false);
  }

  /** 点击屏幕跳过运镜 */
  skipCine(): void {
    if (this.script) {
      const s = this.script;
      for (const ev of s.events) {
        if (!ev.done) {
          ev.done = true;
          ev.fn();
        }
      }
      s.t = s.end;
      s.update?.(s.end, 0);
      this.endScript();
    }
    if (this.slowT > 0 || this.cineLock > 0) {
      this.slowT = 0;
      this.cineLock = 0;
      this.hooks.onCine(false);
    }
    this.director.stop();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.clearRoom();
    this.player.rig.dispose();
    this.fx.dispose();
    this.numbers.dispose();
    this.sparks.dispose();
    this.puffs.dispose();
    this.trail.dispose();
    this.disposeEnv();
    const geos: THREE.BufferGeometry[] = [
      ...this.rockGeos,
      this.shadowGeo,
      this.crateGeo,
      this.barrelGeo,
      this.coinGeo,
      this.potionGeo,
      this.arrowGeo,
    ];
    geos.forEach((g) => g.dispose());
    const mats: THREE.Material[] = [
      this.rockMat,
      this.rockMat2,
      this.shadowMat,
      this.crateMat,
      this.barrelMat,
      this.arrowMat,
      this.doorMat,
      ...Object.values(this.dropMats),
      this.swordMesh.material as THREE.Material,
      this.bigSword.material as THREE.Material,
    ];
    mats.forEach((m) => m.dispose());
    this.swordMesh.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ================= 场景搭建 =================

  private makePlayer(): Player {
    const rig = new StickRig({ color: 0xf4f8ff, glow: 0.55, weapon: ROLES[this.role].weapon, outline: true });
    this.scene.add(rig.group);
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(shadow);
    return {
      pos: new THREE.Vector3(2.5, 0, 0),
      vel: new THREE.Vector3(),
      facing: 1,
      hp: PLAYER_HP,
      maxHp: PLAYER_HP,
      mp: PLAYER_MP,
      rig,
      shadow,
      act: null,
      invuln: 0,
      airSkills: 0,
      runPhase: 0,
      moving: false,
      dodgeCd: 0,
      dodgeBuff: 0,
      ghostIn: 0,
      onLand: null,
    };
  }

  private disposeEnv(): void {
    this.theme?.dispose();
    this.theme = null;
    this.env.clear();
  }

  /** 按房间搭古风场景（见 stickmanTheme.ts） */
  private buildRoom(idx: number): void {
    this.disposeEnv();
    const def = ROOMS[idx]!;
    this.roomW = def.width;
    this.theme = buildTheme(this.env, idx, def.width, this.doorMat);
    this.scene.background = new THREE.Color(this.theme.fog);
    this.scene.fog = new THREE.Fog(this.theme.fog, this.theme.fogNear, this.theme.fogFar);
    this.hemi.color.set(this.theme.sky);
    this.hemi.groundColor.set(this.theme.ground);
    this.hemi.intensity = this.theme.hemi;
  }

  private openDoor(): void {
    this.doorOpen = true;
    this.doorMat.color.set(0x5ad8ff).multiplyScalar(1.4);
    sfx.gate();
    this.hooks.onBanner({ kind: "info", text: "门开了，向右前进 →" });
  }

  private resetRun(): void {
    this.clearRoom();
    const p = this.player;
    p.hp = p.maxHp = ROLES[this.role].hp;
    p.mp = PLAYER_MP;
    p.act = null;
    p.invuln = 0;
    p.dodgeCd = 0;
    p.dodgeBuff = 0;
    p.onLand = null;
    p.rig.tint(null);
    if (!p.rig.group.parent) this.scene.add(p.rig.group);
    this.slots = [...ROLES[this.role].start];
    this.lastDodge = -99;
    this.bellT = 0;
    this.stealthT = 0;
    this.cds = {};
    this.levels = {};
    this.upgrades.clear();
    this.stats = { crit: 0, atk: 0, mpRegen: 0, maxHp: 0, dodgeBuff: 0, cdr: 0 };
    this.dashCharge = 0;
    this.awaken = 0;
    this.killScore = 0;
    this.gold = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.hitsTaken = 0;
    this.elementCombos = 0;
    this.revived = false;
    this.time = 0;
    this.playTime = 0;
    this.hitstop = 0;
    this.slowT = 0;
    this.timeScale = 1;
    this.cineLock = 0;
    this.deadT = 0;
    this.buffered = null;
  }

  private clearRoom(): void {
    if (this.script) this.endScript();
    for (const e of this.enemies) {
      e.model.dispose();
      e.shadow.removeFromParent();
    }
    for (const pr of this.props) pr.mesh.removeFromParent();
    for (const d of this.drops) d.mesh.removeFromParent();
    for (const s of this.shots) s.mesh.removeFromParent();
    for (const d of this.debris) this.removeDebris(d);
    for (const g of this.ghosts) {
      g.group.removeFromParent();
      g.mat.dispose();
    }
    this.enemies = [];
    this.props = [];
    this.drops = [];
    this.shots = [];
    this.hits = [];
    this.fields = [];
    this.patches = [];
    this.traps = [];
    this.waves = [];
    this.debris = [];
    this.ghosts = [];
    this.timers = [];
    this.swords = [];
    this.boss = null;
    this.swordMesh.visible = false;
    this.bigSword.visible = false;
    this.fx.clear();
    this.numbers.clear();
    this.sparks.clear();
    this.puffs.clear();
  }

  private loadRoom(idx: number): void {
    this.clearRoom();
    this.roomIdx = idx;
    this.buildRoom(idx);
    const def = ROOMS[idx]!;
    const p = this.player;
    p.pos.set(2.5, 0, 0);
    p.vel.set(0, 0, 0);
    p.facing = 1;
    p.act = null;
    this.director.snap(p.pos, p.facing);
    this.wave = 0;
    this.waveDelay = 0.9;
    this.pendingSpawns = 0;
    this.roomCleared = false;
    this.doorOpen = false;
    for (let i = 0; i < def.crates + def.barrels; i++) {
      const kind = i < def.crates ? "crate" : "barrel";
      const mesh = new THREE.Mesh(kind === "crate" ? this.crateGeo : this.barrelGeo, kind === "crate" ? this.crateMat : this.barrelMat);
      const pos = new THREE.Vector3(rand(6, this.roomW - 4), 0, rand(-2.6, 2.6));
      mesh.position.set(pos.x, kind === "crate" ? 0.45 : 0.48, pos.z);
      mesh.rotation.y = rand(0, Math.PI);
      this.scene.add(mesh);
      this.props.push({ kind, pos, mesh, dead: false });
    }
    this.hooks.onBanner({ kind: def.boss ? "boss" : "info", text: `${idx + 1}/${ROOMS.length} · ${def.name}` });
    if (def.boss) this.later(0.6, () => this.spawnBoss());
    this.emitHud();
  }

  // ================= 主循环 =================

  private frame = (): void => {
    const realDt = Math.min(0.05, this.clock.getDelta());
    this.watchPerformance(realDt);
    if (this.paused) {
      this.render();
      return;
    }
    this.realTime += realDt;

    // 时间控制：重档运镜时世界静止；打击停顿时短暂冻结；中档运镜时慢动作
    let dt: number;
    let fxDt: number;
    if (this.script) {
      this.runScript(realDt);
      dt = 0;
      fxDt = realDt;
    } else {
      if (this.slowT > 0) {
        this.slowT -= realDt;
        this.timeScale = MEDIUM_SLOWMO;
        if (this.slowT <= 0) this.hooks.onCine(false);
      } else if (this.state === "dead") {
        this.timeScale = 0.35;
      } else {
        this.timeScale += (1 - this.timeScale) * Math.min(1, realDt * 6);
      }
      if (this.hitstop > 0) {
        this.hitstop -= realDt;
        dt = 0;
      } else dt = realDt * this.timeScale;
      fxDt = dt;
    }
    if (this.cineLock > 0) this.cineLock -= realDt;
    this.time += dt;

    if (this.state === "playing") {
      this.playTime += dt;
      this.tickBuffer(realDt);
      this.updatePlayer(dt);
      this.updateHits(dt);
      this.updateEnemies(dt);
      this.updateShots(dt);
      this.updateFields(dt);
      this.updateTraps(dt);
      this.updateWaves(dt);
      this.updateRoom(dt);
    } else if (this.state === "dead") {
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      this.deadT -= realDt;
      if (this.deadT <= 0 && this.deadT > -1) {
        this.deadT = -2;
        this.hooks.onDeath(!this.revived);
      }
    } else if (this.state === "transition") {
      this.transitionT += realDt;
      if (this.transitionT >= 0.35 && this.transitionT - realDt < 0.35) {
        this.loadRoom(this.roomIdx + 1);
        this.state = "transition";
      }
      if (this.transitionT >= 0.5) {
        this.state = "playing";
        this.hooks.onFade(false);
      }
    } else if (this.state === "cards" || this.state === "ready") {
      this.updatePlayer(0);
    }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]!;
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    this.updateDrops(dt);
    this.updateDebris(fxDt);
    this.updateGhosts(fxDt);
    this.fx.update(fxDt);
    this.sparks.update(fxDt);
    this.puffs.update(fxDt);
    this.numbers.update(fxDt);
    this.updateTrail();
    this.theme?.update(realDt, this.realTime);

    this.director.update(realDt, this.player.pos, this.player.facing);
    this.hudIn -= realDt;
    if (this.hudIn <= 0 && (this.state === "playing" || this.state === "dead")) this.emitHud();
    this.render();
  };

  private render(): void {
    if (this.quality >= 1) this.composer.render();
    else this.renderer.render(this.scene, this.director.camera);
  }

  private watchPerformance(dt: number): void {
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    this.frameSum += dt;
    this.frameCount++;
    if (this.frameCount < 120) return;
    const avg = this.frameSum / this.frameCount;
    this.frameSum = 0;
    this.frameCount = 0;
    // 掉到 45 帧以下就降一档：先降分辨率，再关辉光、粒子减半
    if (avg > 1 / 45 && this.quality > 0) {
      this.quality--;
      this.applyQuality();
      this.warmup = 30;
    }
  }

  private applyQuality(): void {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.quality === 2 ? Math.min(dpr, 1.75) : this.quality === 1 ? Math.min(dpr, 1.1) : 1);
    const density = this.quality === 0 ? 0.5 : 1;
    this.sparks.density = this.puffs.density = density;
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    const cam = this.director.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  // ================= 输入 =================

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === " " || k.startsWith("arrow")) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(k);
    const a = KEY_ACTIONS[k];
    if (a !== undefined) this.press(a);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  /** 读取移动方向：x 向右，z 向镜头（下方）为正 */
  private readMove(out: THREE.Vector2): THREE.Vector2 {
    let x = this.stick.x;
    let z = -this.stick.y;
    const k = this.keys;
    if (k.has("a") || k.has("arrowleft")) x -= 1;
    if (k.has("d") || k.has("arrowright")) x += 1;
    if (k.has("w") || k.has("arrowup")) z -= 1;
    if (k.has("s") || k.has("arrowdown")) z += 1;
    out.set(clamp(x, -1, 1), clamp(z, -1, 1));
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }
  private move2 = new THREE.Vector2();

  private tickBuffer(dt: number): void {
    if (!this.buffered) return;
    if (this.exec(this.buffered.a)) this.buffered = null;
    else {
      this.buffered.t -= dt;
      if (this.buffered.t <= 0) this.buffered = null;
    }
  }

  // ================= 主角 =================

  private onGround(): boolean {
    return this.player.pos.y <= 0.001 && this.player.vel.y <= 0;
  }

  private atk(): number {
    return BASE_ATK * (ROLES[this.role].atk / 100) * (1 + this.stats.atk * 0.2);
  }

  private has(upgrade: string): boolean {
    return this.upgrades.has(upgrade);
  }

  private skillCd(id: SkillId): number {
    let cd = SKILLS[id].cd * Math.pow(0.85, this.stats.cdr);
    if (id === "rise" && this.has("rise.cd")) cd *= 0.6;
    return cd;
  }

  private startAct(kind: PActKind, dur: number, cancel: number, skill?: SkillId): PAct {
    const act: PAct = { kind, skill, t: 0, prev: -1, dur, cancel, hitList: [], n: 0, phase: 0, dir: new THREE.Vector3(), landed: false };
    this.player.act = act;
    this.player.onLand = null;
    return act;
  }

  /** 能否打断当前动作去做 next */
  private canCancel(next: "attack" | "skill" | "dodge" | "jump", skill?: SkillId): boolean {
    const act = this.player.act;
    if (!act) return true;
    if (act.kind === "hurt" || act.kind === "down" || act.kind === "getup" || act.kind === "dead" || act.kind === "awaken") return false;
    if (next === "dodge") return act.kind !== "dodge";
    if (act.kind === "dodge") return act.t >= 0.15;
    if (next === "skill") {
      if (act.kind === "atk1" || act.kind === "atk2" || act.kind === "atk3" || act.kind === "airAtk") return true;
      return act.kind === "skill" && act.skill !== skill && act.t >= act.cancel;
    }
    if (next === "jump") return act.kind !== "skill" ? act.t >= act.cancel : act.t >= act.dur * 0.85;
    return act.t >= act.cancel;
  }

  private exec(a: StickAction): boolean {
    const p = this.player;
    if (this.state !== "playing" || this.cineLock > 0 || this.script) return false;
    const ground = this.onGround();
    const mv = this.readMove(this.move2);
    const faceInput = () => {
      if (Math.abs(mv.x) > 0.3) p.facing = sign(mv.x);
    };

    if (a === "jump") {
      if (!ground || !this.canCancel("jump")) return false;
      p.act = null;
      p.vel.y = JUMP_VEL;
      p.airSkills = 0;
      sfx.hop();
      return true;
    }
    if (a === "dodge") {
      if (!ground || p.dodgeCd > 0 || !this.canCancel("dodge")) return false;
      const act = this.startAct("dodge", 0.32, 0.15);
      if (mv.lengthSq() > 0.04) act.dir.set(mv.x, 0, mv.y).normalize();
      else act.dir.set(-p.facing, 0, 0);
      p.invuln = Math.max(p.invuln, 0.3);
      p.dodgeCd = 0.9;
      this.lastDodge = this.realTime;
      if (this.stats.dodgeBuff) p.dodgeBuff = 2;
      sfx.glide(true);
      return true;
    }
    if (a === "awaken") {
      if (this.awaken < 1 || (p.act && (p.act.kind === "hurt" || p.act.kind === "down" || p.act.kind === "dead"))) return false;
      faceInput();
      this.awaken = 0;
      this.startAwaken();
      return true;
    }
    if (a === "attack") {
      const act = p.act;
      if (!ground) {
        if (act && !(act.kind === "skill" && act.t >= act.cancel)) return false;
        faceInput();
        this.startAct("airAtk", 5, 5);
        sfx.swing();
        return true;
      }
      if (act && (act.kind === "atk1" || act.kind === "atk2")) {
        if (act.t < act.cancel) return false;
        faceInput();
        if (act.kind === "atk1") this.startAct("atk2", 0.34, 0.17);
        else this.startAct("atk3", 0.5, 0.32);
        sfx.swing(act.kind === "atk2");
        return true;
      }
      if (!this.canCancel("attack")) return false;
      faceInput();
      this.startAct("atk1", 0.34, 0.17);
      sfx.swing();
      return true;
    }
    // 技能
    const id = this.slots[a];
    if (!id) return true;
    const def = SKILLS[id];
    const freeDash = id === "dash" && this.dashCharge > 0;
    if ((this.cds[id] ?? 0) > 0 && !freeDash) return false;
    if (p.mp < def.mp && !freeDash) return false;
    if (def.air === "only" && ground) return false;
    if (def.air === "no" && !ground) return false;
    if (!ground && p.airSkills >= 2) return false;
    if (!this.canCancel("skill", id)) return false;
    faceInput();
    if (freeDash) this.dashCharge = 0;
    else {
      p.mp -= def.mp;
      this.cds[id] = this.skillCd(id);
      if (id === "dash" && this.has("dash.twice")) this.dashCharge = 1;
    }
    if (!ground) p.airSkills++;
    this.beginSkill(id, mv);
    return true;
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const playing = this.state === "playing";
    if (dt > 0) {
      for (const id of this.slots) if ((this.cds[id] ?? 0) > 0) this.cds[id] = Math.max(0, this.cds[id]! - dt);
      p.dodgeCd = Math.max(0, p.dodgeCd - dt);
      p.dodgeBuff = Math.max(0, p.dodgeBuff - dt);
      p.invuln = Math.max(0, p.invuln - dt);
      this.bellT = Math.max(0, this.bellT - dt);
      this.stealthT = Math.max(0, this.stealthT - dt);
      p.mp = Math.min(PLAYER_MP, p.mp + MP_REGEN * (1 + this.stats.mpRegen * 0.4) * dt);
      if (this.dashCharge > 0 && (this.cds.dash ?? 0) < this.skillCd("dash") - 1) this.dashCharge = 0;
      if (this.comboT > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) this.combo = 0;
      }
    }

    const mv = this.readMove(this.move2);
    const ground = this.onGround();
    let gravity = GRAVITY;
    const act = p.act;
    if (act) {
      act.prev = act.t;
      act.t += dt;
      gravity = this.updateAct(act, dt, mv);
      if (p.act === act && act.t >= act.dur) this.endAct(act);
    } else if (playing && dt > 0) {
      if (ground) {
        p.vel.x = mv.x * RUN_X;
        p.vel.z = mv.y * RUN_Z;
      } else {
        p.vel.x += (mv.x * RUN_X * 0.85 - p.vel.x) * Math.min(1, dt * 6);
        p.vel.z += (mv.y * RUN_Z * 0.7 - p.vel.z) * Math.min(1, dt * 6);
      }
      if (Math.abs(mv.x) > 0.2) p.facing = sign(mv.x);
    }
    p.moving = !p.act && ground && mv.lengthSq() > 0.02;
    if (p.moving) p.runPhase += dt * 11;
    if (!playing && !p.act) p.vel.set(0, p.vel.y, 0);

    // 物理
    const wasAir = p.pos.y > 0.001;
    if (p.pos.y > 0 || p.vel.y > 0) p.vel.y -= gravity * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      if (p.vel.y < 0) p.vel.y = 0;
      if (wasAir && dt > 0) this.playerLanded();
    }
    if (ground && (!p.act || p.act.kind === "hurt" || p.act.kind === "getup" || p.act.kind === "down")) {
      if (p.act) p.vel.x *= Math.max(0, 1 - dt * 8);
    }
    p.pos.x = clamp(p.pos.x, 0.6, this.roomW + (this.doorOpen ? 0.8 : -0.6));
    p.pos.z = clamp(p.pos.z, -Z_LIMIT, Z_LIMIT);

    // 进门
    if (playing && this.doorOpen && p.pos.x > this.roomW - 0.6 && Math.abs(p.pos.z) < 2.3) {
      this.state = "transition";
      this.transitionT = 0;
      this.hooks.onFade(true);
    }

    // 画面
    const rig = p.rig;
    rig.apply(this.playerPose());
    rig.group.position.copy(p.pos);
    rig.group.rotation.y = p.facing > 0 ? -0.4 : Math.PI + 0.4;
    const blink = p.invuln > 0 && (!p.act || p.act.kind === "getup") && Math.floor(this.realTime * 20) % 2 === 0;
    rig.group.visible = !blink;
    rig.setOpacity(this.stealthT > 0 ? 0.22 : 1);
    const el = act?.skill ? SKILLS[act.skill].element : null;
    const upEl = act?.skill === "airDance" && this.has("airDance.fire") ? "fire" : act?.skill === "rise" && this.has("rise.shock") ? "thunder" : null;
    const tintEl = el ?? upEl;
    if (act?.kind === "awaken") rig.tint(0xffe080, 0.5);
    else rig.tint(tintEl ? ELEMENT_COLOR[tintEl] : null, 0.55);
    this.placeShadow(p.shadow, p.pos, 1);
  }

  private placeShadow(shadow: THREE.Mesh, pos: THREE.Vector3, size: number): void {
    const s = size * Math.max(0.35, 1 - pos.y * 0.12);
    shadow.position.set(pos.x, 0.03, pos.z);
    shadow.scale.setScalar(s);
  }

  private playerLanded(): void {
    const p = this.player;
    p.airSkills = 0;
    this.puffs.emit(this.tmp.set(p.pos.x, 0.1, p.pos.z), 6, 0x2a2630, { speed: 2, life: 0.4, upward: true });
    const cb = p.onLand;
    p.onLand = null;
    if (cb) cb();
    else if (!p.act) sfx.land();
  }

  private endAct(act: PAct): void {
    const p = this.player;
    if (act.kind === "down") {
      this.startAct("getup", 0.4, 0.4);
      p.invuln = Math.max(p.invuln, 0.8);
      return;
    }
    if (act.kind === "dead") {
      act.t = act.dur;
      return;
    }
    // onLand 保留：空中连舞结束后还要等落地放冲击波
    p.act = null;
  }

  /** 每帧推进当前动作；返回本帧主角受到的重力 */
  private updateAct(act: PAct, dt: number, mv: THREE.Vector2): number {
    const p = this.player;
    const at = (time: number) => act.prev < time && act.t >= time;
    const f = p.facing;
    switch (act.kind) {
      case "atk1":
      case "atk2":
      case "atk3": {
        const heavy = act.kind === "atk3";
        if (act.t < 0.1) p.vel.x = f * (heavy ? 5 : 2.5);
        else p.vel.x *= Math.max(0, 1 - dt * 12);
        p.vel.z = 0;
        const hitAt = heavy ? 0.14 : 0.08;
        if (at(hitAt)) {
          const mul = act.kind === "atk1" ? 0.8 : act.kind === "atk2" ? 0.9 : 1.5;
          this.addHit({
            follow: true,
            ox: heavy ? 1.3 : 1.1,
            hw: heavy ? 1.3 : 1.0,
            hd: 0.65,
            y0: -0.2,
            y1: 2.3,
            dur: 0.06,
            dmg: mul * this.atk(),
            kb: heavy ? 9 : 2.5,
            up: 0,
            hitstop: heavy ? 0.08 : 0.045,
            heavy,
            element: null,
          });
          const ang = act.kind === "atk1" ? -0.7 : act.kind === "atk2" ? 0.9 : 0;
          this.slashFx(heavy ? 1.2 : 0.95, 1.2, ang, heavy ? 1.6 : 1.25, WHITE_SWORD, heavy ? 0.22 : 0.16, heavy ? [3, 0.5] : [1, 1]);
          if (heavy) this.director.kick(0.05, 0, 0.2);
        }
        return GRAVITY;
      }
      case "airAtk": {
        if (act.t < 0.1) {
          p.vel.y = Math.max(p.vel.y, 2);
          return 0;
        }
        if (act.phase === 0) {
          act.phase = 1;
          p.vel.y = -16;
          p.vel.x = f * 4;
          this.addHit({ follow: true, ox: 0.7, hw: 0.9, hd: 0.7, y0: -1.4, y1: 1.6, dur: 3, dmg: 1.0 * this.atk(), kb: 3, up: 0, hitstop: 0.05, heavy: false, element: null, fromAbove: true });
          this.slashFx(0.6, 1.0, -1.2, 1.4, WHITE_SWORD, 0.2);
          p.onLand = () => {
            this.removeFollowHits();
            this.addHit({ follow: false, shape: "circle", r: 1.6, x: p.pos.x + f * 0.5, z: p.pos.z, y0: -0.5, y1: 1.5, dur: 0.06, dmg: 1.0 * this.atk(), kb: 5, up: 0, hitstop: 0.06, heavy: true, element: null, radial: true, fromAbove: true });
            this.groundRing(p.pos.x + f * 0.5, p.pos.z, 1.8, WHITE_SWORD, 0.35);
            this.dust(p.pos.x, p.pos.z, 10);
            this.director.shake(0.15);
            sfx.land();
            act.dur = act.t + 0.18;
            act.cancel = act.t + 0.08;
          };
        }
        return GRAVITY;
      }
      case "dodge": {
        const k = 1 - act.t / act.dur;
        // 往后闪避时保持面朝前方，方便闪完立刻反击
        p.vel.x = act.dir.x * 15 * k;
        p.vel.z = act.dir.z * 10 * k;
        this.ghostTick(dt, 0.05, 0x9ad8ff, 0.35);
        return GRAVITY;
      }
      case "hurt":
        return GRAVITY;
      case "down":
        if (!act.landed) {
          if (this.onGround() && act.t > 0.05) {
            act.landed = true;
            act.dur = act.t + 0.7;
            this.dust(p.pos.x, p.pos.z, 8);
          } else act.dur = act.t + 1;
        }
        return GRAVITY;
      case "getup":
      case "dead":
        p.vel.x *= Math.max(0, 1 - dt * 6);
        return GRAVITY;
      case "awaken":
        p.vel.set(0, 0, 0);
        return 0;
      case "skill":
        return this.updateSkill(act, dt, mv, at);
    }
    return GRAVITY;
  }

  private playerPose(): Pose {
    const p = this.player;
    const act = p.act;
    if (!act) {
      if (p.pos.y > 0.01) return p.vel.y > 0 ? P.jumpUp : P.fall;
      if (p.moving) return runPose(p.runPhase);
      return idlePose(this.realTime);
    }
    const k = Math.min(1, act.t / act.dur);
    switch (act.kind) {
      case "atk1":
        return keyed(k, A1);
      case "atk2":
        return keyed(k, A2);
      case "atk3":
        return keyed(k, A3);
      case "airAtk":
        return keyed(Math.min(1, act.t / 0.4), AIR_SLASH);
      case "dodge":
        return DODGE;
      case "hurt":
        return P.hurt;
      case "down":
        return act.landed ? P.down : mixPose(P.hurt, P.down, Math.min(1, act.t * 3));
      case "getup":
        return mixPose(P.down, STANCE, k);
      case "dead":
        return mixPose(P.hurt, P.down, Math.min(1, act.t * 2.5));
      case "awaken":
        return this.awakenPose();
      case "skill":
        return this.skillPose(act, k);
    }
  }

  // ================= 技能 =================

  private beginSkill(id: SkillId, mv: THREE.Vector2): void {
    const p = this.player;
    const f = p.facing;
    switch (id) {
      case "rise":
        this.startAct("skill", 0.5, 0.3, id);
        sfx.swing(true);
        break;
      case "dash": {
        const act = this.startAct("skill", 0.3, 0.22, id);
        act.dir.set(f, 0, mv.y * 0.35);
        p.invuln = Math.max(p.invuln, 0.36);
        p.vel.y = 0;
        this.addHit({
          act,
          follow: true,
          ox: 0.3,
          hw: 1.1,
          hd: 0.8,
          y0: -0.3,
          y1: 2.3,
          dur: 0.3,
          dmg: 1.6 * this.atk(),
          kb: 2,
          up: 0,
          hitstop: 0.03,
          heavy: false,
          element: null,
          onHit: (e) => {
            if (!act.hitList.includes(e)) act.hitList.push(e);
          },
        });
        sfx.glide(true);
        this.director.kick(0.06, -0.02 * f, 0.3);
        break;
      }
      case "spin": {
        const dur = this.has("spin.long") ? 3 : 1.5;
        const act = this.startAct("skill", dur, 0.35, id);
        this.addHit({
          act,
          follow: true,
          ox: 0,
          shape: "circle",
          r: 2.5,
          y0: -0.3,
          y1: 2.6,
          dur,
          interval: 0.15,
          dmg: 0.45 * this.atk(),
          kb: 0.5,
          up: 0,
          hitstop: 0.02,
          heavy: false,
          element: this.has("spin.shock") ? "thunder" : null,
          pull: 6,
          radial: true,
        });
        break;
      }
      case "crescent":
        this.startAct("skill", 0.4, 0.24, id).dir.set(f, 0, clamp(mv.y, -1, 1) * 0.55);
        break;
      case "airDance": {
        const n = this.has("airDance.more") ? 10 : 6;
        const dur = n * 0.11 + 0.2;
        const act = this.startAct("skill", dur, dur - 0.12, id);
        act.n = n;
        p.vel.set(0, 0, 0);
        break;
      }
      case "thunder": {
        const act = this.startAct("skill", 1, 1, id);
        if (this.onGround()) p.vel.y = 15;
        else act.phase = 1;
        act.cancel = 99;
        sfx.hop();
        break;
      }
      case "firePunch":
        this.startAct("skill", 0.45, 0.3, id);
        break;
      case "frost":
        this.startAct("skill", 0.6, 0.42, id);
        sfx.swing(true);
        break;
      default:
        this.beginRoleSkill(id, mv);
        break;
    }
  }

  private updateSkill(act: PAct, dt: number, mv: THREE.Vector2, at: (t: number) => boolean): number {
    const p = this.player;
    const f = p.facing;
    const atk = this.atk();
    switch (act.skill!) {
      case "rise": {
        if (act.t < 0.1) p.vel.x = f * 1;
        if (at(0.1)) {
          const big = this.has("rise.big");
          const shock = this.has("rise.shock");
          this.addHit({
            follow: true,
            ox: 1.0,
            hw: big ? 1.8 : 1.0,
            hd: big ? 1.1 : 0.7,
            y0: -0.3,
            y1: 3.4,
            dur: 0.08,
            dmg: 2.0 * atk,
            kb: 1,
            up: 13,
            hitstop: 0.06,
            heavy: true,
            element: shock ? "thunder" : null,
          });
          p.vel.y = 9.5;
          p.vel.x = f * 1.5;
          const color = shock ? THUNDER : WHITE_SWORD;
          const s = big ? 2.3 : 1.5;
          this.fx.spawn({ geo: FXGEO.arc, color, k: 2.8, pos: [p.pos.x + f * 1.0, p.pos.y + 1.2, p.pos.z + 0.3], rot: [0, f > 0 ? 0 : Math.PI, Math.PI / 2], scale: [s, s * 1.2, 1], scaleTo: [s * 1.3, s * 1.6, 1], life: 0.32, vel: [0, 7, 0] });
          this.fx.spawn({ geo: FXGEO.arc, color, k: 1.2, pos: [p.pos.x + f * 1.0, p.pos.y + 1.0, p.pos.z + 0.2], rot: [0, f > 0 ? 0 : Math.PI, Math.PI / 2], scale: [s * 1.3, s * 1.5, 1], scaleTo: [s * 1.6, s * 2, 1], life: 0.4, vel: [0, 5, 0], opacity: 0.6 });
          this.sparks.emit(this.tmp.set(p.pos.x + f, 0.6, p.pos.z), 24, color, { speed: 7, life: 0.5, up: 6, gravity: 12 });
        }
        if (act.t > 0.1) this.ghostTick(dt, 0.06, WHITE_SWORD, 0.3);
        return GRAVITY;
      }
      case "dash": {
        const k = act.t / act.dur;
        p.vel.x = act.dir.x * 26 * (1 - k * 0.5);
        p.vel.z = act.dir.z * 10;
        this.ghostTick(dt, 0.035, 0x9ad8ff, 0.5);
        this.sparks.emit(this.tmp.set(p.pos.x - f * 0.5, 1 + rand(-0.5, 0.6), p.pos.z), 2, 0x9ad8ff, { speed: 2, life: 0.3 });
        if (this.has("dash.fireTrail")) {
          act.phase -= dt;
          if (act.phase <= 0) {
            act.phase = 0.06;
            this.patches.push({ pos: p.pos.clone().setY(0), t: 0, tick: 0 });
            this.fx.spawn({ geo: FXGEO.disk, color: FIRE, k: 1.2, pos: [p.pos.x, 0.05, p.pos.z], rot: [-Math.PI / 2, 0, 0], scale: 0.9, life: 2, opacity: 0.6, opacityTo: 0 });
          }
        }
        if (act.t >= act.dur && !act.landed) {
          act.landed = true;
          p.vel.x *= 0.15;
          act.hitList.forEach((e, i) =>
            this.later(0.1 + i * 0.03, () => {
              if (e.dead) return;
              this.crossSlash(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z, WHITE_SWORD);
              this.damageEnemy(e, { dmg: 1.0 * this.atk(), kb: 3, up: 0, hitstop: 0.05, heavy: true, element: null, radial: false }, p.pos.x);
            }),
          );
          if (act.hitList.length) sfx.slashHit(true);
          if (this.has("dash.frostEnd")) this.spawnFrost(p.pos.clone().setY(0), 2.5, 2, false, 1, false);
        }
        return 0;
      }
      case "spin": {
        p.vel.x = mv.x * 2.8;
        p.vel.z = mv.y * 2;
        act.phase -= dt;
        if (act.phase <= 0) {
          act.phase = 0.06;
          const shock = this.has("spin.shock");
          this.fx.spawn({ geo: FXGEO.arc, color: shock ? THUNDER : WHITE_SWORD, k: 2.4, pos: [p.pos.x, p.pos.y + rand(0.7, 1.5), p.pos.z], rot: [-Math.PI / 2, 0, rand(0, Math.PI * 2)], scale: [2.5, 2.5, 1], scaleTo: [2.8, 2.8, 1], life: 0.16, spin: [0, 0, 28] });
          this.puffs.emit(this.tmp.set(p.pos.x, 0.2, p.pos.z), 2, 0x3a3440, { speed: 4, life: 0.5, spread: 1.5, upward: true });
          if (Math.floor(act.t / 0.18) !== Math.floor((act.t - dt) / 0.18)) sfx.swing();
        }
        if (act.t >= act.dur && !act.landed) {
          act.landed = true;
          if (this.has("spin.waves")) {
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              this.fireCrescent(Math.cos(a), Math.sin(a), false, false, 0.9);
            }
            sfx.swing(true);
          }
        }
        return GRAVITY;
      }
      case "crescent": {
        p.vel.x *= Math.max(0, 1 - dt * 10);
        p.vel.z = 0;
        if (at(0.1)) {
          const huge = this.has("crescent.huge");
          const boom = this.has("crescent.explode");
          const d = act.dir.clone().normalize();
          this.fireCrescent(d.x, d.z, huge, boom);
          if (this.has("crescent.triple")) {
            for (const off of [-0.32, 0.32]) {
              const a = Math.atan2(d.z, d.x) + off * f;
              this.fireCrescent(Math.cos(a), Math.sin(a), huge, boom);
            }
          }
          sfx.swing(true);
          this.director.kick(0.04, 0, 0.2);
        }
        return GRAVITY;
      }
      case "airDance": {
        p.vel.set(0, 0, 0);
        const interval = (act.dur - 0.2) / act.n;
        for (let i = 0; i < act.n; i++) {
          if (!at(0.05 + i * interval)) continue;
          act.phase = i;
          const fire = this.has("airDance.fire");
          this.addHit({ follow: true, ox: 1.0, hw: 1.5, hd: 0.9, y0: -1.6, y1: 1.9, dur: 0.05, dmg: 0.6 * atk, kb: 0.5, up: 0, hitstop: 0.035, heavy: false, element: fire ? "fire" : null, hold: true });
          const color = fire ? FIRE : WHITE_SWORD;
          this.slashFx(1.0, 0.9, rand(-Math.PI, Math.PI), rand(1.2, 1.7), color, 0.18);
          this.slashFx(0.6, 0.8, rand(-Math.PI, Math.PI), rand(1.6, 2.2), color, 0.22, [1, 1], 0.4);
          sfx.swing(i % 2 === 0);
        }
        this.ghostTick(dt, 0.08, WHITE_SWORD, 0.3);
        if (act.t >= act.dur && !act.landed) {
          act.landed = true;
          if (this.has("airDance.finisher")) {
            p.vel.y = -24;
            p.onLand = () => {
              this.addHit({ follow: false, shape: "circle", r: 3, x: p.pos.x, z: p.pos.z, y0: -0.5, y1: 3, dur: 0.06, dmg: 2.0 * this.atk(), kb: 6, up: 5, hitstop: 0.08, heavy: true, element: null, radial: true });
              this.groundRing(p.pos.x, p.pos.z, 3.2, WHITE_SWORD, 0.4);
              this.groundRing(p.pos.x, p.pos.z, 2.2, WHITE_SWORD, 0.3);
              this.dust(p.pos.x, p.pos.z, 18);
              this.director.shake(0.3);
              sfx.blast();
            };
          }
        }
        return 0;
      }
      case "thunder": {
        if (act.phase === 0) {
          p.vel.x = f * 2;
          if (act.t >= 0.28) {
            act.phase = 1;
            act.n = 0;
          }
          return GRAVITY;
        }
        if (act.phase === 1) {
          p.vel.set(0, 0, 0);
          act.n += dt;
          if (act.n >= 0.08) {
            act.phase = 2;
            p.vel.y = -32;
            p.vel.x = f * 3;
            p.onLand = () => this.thunderImpact(act);
          }
          act.dur = act.t + 1;
          return 0;
        }
        if (act.phase === 2) act.dur = act.t + 1;
        return GRAVITY;
      }
      case "firePunch": {
        if (act.t < 0.15) p.vel.x = f * 2;
        else p.vel.x *= Math.max(0, 1 - dt * 10);
        p.vel.z = 0;
        if (at(0.14)) {
          const n = this.has("firePunch.multi") ? 3 : 1;
          const r = this.has("firePunch.big") ? 3.4 : 2.0;
          const burnMul = this.has("firePunch.burn") ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const x = p.pos.x + f * (2.0 + i * 2.1);
            const z = p.pos.z;
            this.later(i * 0.12, () => {
              this.explosion(x, z, r, FIRE);
              this.addHit({ follow: false, shape: "circle", r, x, z, y0: -0.5, y1: r + 1, dur: 0.06, dmg: 3.0 * this.atk(), kb: 10, up: 6, hitstop: 0.09, heavy: true, element: "fire", burnMul, radial: true });
              this.director.shake(0.3);
              sfx.blast();
            });
          }
          this.director.kick(0.06, 0.02 * f, 0.25);
        }
        return GRAVITY;
      }
      case "frost": {
        p.vel.set(0, p.vel.y, 0);
        if (at(0.22)) {
          const spikes = this.has("frost.spikes");
          this.spawnFrost(p.pos.clone().setY(0), 4.2, this.has("frost.long") ? 6 : 3, this.has("frost.follow"), spikes ? 2 : 1, spikes);
          this.director.shake(0.25);
          sfx.freeze();
          this.medium(p.pos, f, [{ dur: 0.8, pos: [-4.5, 0.5, 3.8], toPos: [4.5, 0.6, 3.8], look: [0, 0.6, 0], fov: 44 }]);
        }
        return GRAVITY;
      }
      default:
        return this.updateRoleSkill(act, dt, mv, at);
    }
  }

  private skillPose(act: PAct, k: number): Pose {
    switch (act.skill!) {
      case "rise":
        return keyed(k, RISE);
      case "dash":
        return DASH;
      case "spin":
        return pose({ spinY: -act.t * 24 }, SPIN);
      case "crescent":
        return keyed(k, CRESCENT);
      case "airDance":
        return pose({ roll: Math.sin(act.t * 21) * 0.35 }, act.phase % 2 ? DANCE_A : DANCE_B);
      case "thunder":
        if (act.phase < 2) return pose({ hipL: 0.9, knL: -1.5, hipR: 0.4, knR: -1.0 }, P.overhead);
        return act.phase === 2 ? mixPose(P.overhead, SLAM, 0.8) : SLAM;
      case "firePunch":
        return keyed(k, PUNCH);
      case "frost":
        return keyed(k, [
          [0, P.overhead],
          [0.35, KNEEL],
          [1, KNEEL],
        ]);
      default:
        return this.roleSkillPose(act, k);
    }
  }

  private thunderImpact(act: PAct): void {
    const p = this.player;
    const f = p.facing;
    const x = p.pos.x + f * 0.4;
    const z = p.pos.z;
    const r = this.has("thunder.wide") ? 5.6 : 3.5;
    const mul = this.has("thunder.power") ? 1.6 : 1;
    this.fx.bolt(this.tmp.set(x, 15, z), this.tmp2.set(x, 0, z), THUNDER, 0.12, 0.35, 1.2);
    this.fx.bolt(this.tmp.set(x + 0.6, 15, z - 0.3), this.tmp2.set(x, 0, z), 0xffffff, 0.06, 0.25, 1.6);
    this.fx.spawn({ geo: FXGEO.sphere, color: THUNDER, k: 3, pos: [x, 0.3, z], scale: 0.5, scaleTo: 2.2, life: 0.25 });
    this.groundRing(x, z, r * 1.05, THUNDER, 0.45);
    this.groundRing(x, z, r * 0.7, 0xffffff, 0.3);
    this.sparks.emit(this.tmp.set(x, 0.3, z), 60, THUNDER, { speed: 12, life: 0.5, up: 4, gravity: 10 });
    this.dust(x, z, 16);
    this.addHit({ follow: false, shape: "circle", r, x, z, y0: -0.5, y1: 4, dur: 0.06, dmg: 3.0 * mul * this.atk(), kb: 6, up: 7, hitstop: 0.1, heavy: true, element: "thunder", radial: true });
    this.director.shake(0.5);
    sfx.zap();
    sfx.blast();
    vibrate(40);
    if (this.has("thunder.triple")) {
      for (let i = 0; i < 3; i++) {
        this.later(0.2 + i * 0.15, () => {
          const near = this.enemies.filter((e) => !e.dead && Math.abs(e.pos.x - x) < 8);
          const t = near.length ? pickOne(near) : null;
          const tx = t ? t.pos.x : x + rand(-5, 5);
          const tz = t ? t.pos.z : rand(-2.5, 2.5);
          this.fx.bolt(this.tmp.set(tx, 14, tz), this.tmp2.set(tx, 0, tz), THUNDER, 0.08, 0.3, 1);
          this.groundRing(tx, tz, 1.6, THUNDER, 0.3);
          this.addHit({ follow: false, shape: "circle", r: 1.4, x: tx, z: tz, y0: -0.5, y1: 5, dur: 0.06, dmg: 1.5 * this.atk(), kb: 2, up: 4, hitstop: 0.03, heavy: false, element: "thunder", radial: true });
          sfx.zap();
        });
      }
    }
    act.phase = 3;
    act.dur = act.t + 0.35;
    act.cancel = act.t + 0.18;
    this.medium(p.pos, f, [{ dur: 0.8, pos: [-3.2, 0.5, 5], toPos: [-2.4, 0.6, 4], look: [1, 1, 0], fov: 40 }]);
  }

  private fireCrescent(dx: number, dz: number, huge: boolean, boom: boolean, power = 1): void {
    const p = this.player;
    const s = huge ? 2 : 1;
    const v = 18;
    const x = p.pos.x + dx * 0.9;
    const z = p.pos.z + dz * 0.9;
    const y = p.pos.y + 1.2 * Math.sqrt(s);
    const rotY = -Math.atan2(dz, dx);
    this.fx.spawn({ geo: FXGEO.crescent, color: WHITE_SWORD, k: 2.8, pos: [x, y, z], rot: [0, rotY, 0], scale: [0.9 * s, 1.5 * s, 1], scaleTo: [1.1 * s, 1.8 * s, 1], life: 0.75, opacity: 1, opacityTo: 0.3, vel: [dx * v, 0, dz * v] });
    this.fx.spawn({ geo: FXGEO.crescent, color: 0x6ad8ff, k: 1.2, pos: [x - dx * 0.3, y, z - dz * 0.3], rot: [0, rotY, 0], scale: [1.3 * s, 2 * s, 1], scaleTo: [1.5 * s, 2.3 * s, 1], life: 0.75, opacity: 0.6, opacityTo: 0, vel: [dx * v, 0, dz * v] });
    this.addHit({
      follow: false,
      x,
      z,
      vx: dx * v,
      vz: dz * v,
      hw: 0.55 * s,
      hd: 0.65 * s,
      y0: y - 1.5 * s,
      y1: y + 1.5 * s,
      dur: 0.75,
      dmg: 2.2 * power * this.atk(),
      kb: 5,
      up: 0,
      hitstop: 0.04,
      heavy: false,
      element: null,
      onHit: boom
        ? (e) => {
            this.explosion(e.pos.x, e.pos.z, 1.5, WHITE_SWORD);
            this.aoe(e.pos, 1.5, 1.0 * this.atk(), null, e);
          }
        : undefined,
    });
  }

  private spawnFrost(pos: THREE.Vector3, r: number, dur: number, follow: boolean, spikeMul: number, respike: boolean): void {
    this.fx.spawn({ geo: FXGEO.disk, color: ICE, k: 1.4, pos: [pos.x, 0.05, pos.z], rot: [-Math.PI / 2, 0, 0], scale: 0.3, scaleTo: r, life: 0.3, opacity: 0.8, opacityTo: 0.2 });
    const disk = this.fx.spawn({ geo: FXGEO.disk, color: ICE, k: 0.55, pos: [pos.x, 0.04, pos.z], rot: [-Math.PI / 2, 0, 0], scale: r, life: dur, opacity: 0.55, opacityTo: 0.25 });
    this.fx.spawn({ geo: FXGEO.ring, color: ICE, k: 1.8, pos: [pos.x, 0.06, pos.z], rot: [-Math.PI / 2, 0, 0], scale: r, life: dur, opacity: 0.9, opacityTo: 0.3 });
    const field: FrostField = { pos, r, t: 0, dur, follow, spikeMul, respike, spikeT: 1, disk, snowT: 0 };
    this.fields.push(field);
    this.iceSpikes(field);
  }

  private iceSpikes(f: FrostField): void {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * f.r * 0.9;
      const h = rand(1, 1.9);
      this.fx.spawn({ geo: FXGEO.cone, color: ICE, k: 1.5, pos: [f.pos.x + Math.cos(a) * d, 0, f.pos.z + Math.sin(a) * d * 0.8], rot: [rand(-0.3, 0.3), 0, rand(-0.3, 0.3)], scale: [1, 0.05, 1], scaleTo: [1.1, h, 1.1], life: 0.9, opacity: 1, opacityTo: 0, delay: i * 0.012 });
    }
    this.sparks.emit(this.tmp.set(f.pos.x, 0.5, f.pos.z), 30, 0xcff4ff, { speed: 6, life: 0.6, up: 3, spread: f.r * 0.5, gravity: 6 });
    this.addHit({ follow: false, shape: "circle", r: f.r, x: f.pos.x, z: f.pos.z, y0: -0.5, y1: 2.5, dur: 0.06, dmg: 1.5 * f.spikeMul * this.atk(), kb: 1, up: 0, hitstop: 0.05, heavy: false, element: "ice", radial: true });
  }

  // ================= 判定 =================

  private addHit(o: Partial<HitBox> & HitInfo & { act?: PAct }): void {
    const p = this.player;
    const facing = o.facing ?? p.facing;
    const ox = o.ox ?? 0;
    const h: HitBox & { act?: PAct } = {
      t: 0,
      delay: 0,
      follow: false,
      x: p.pos.x + facing * ox,
      z: p.pos.z,
      shape: "box",
      hw: 1,
      hd: 0.6,
      r: 1,
      y0: 0,
      y1: 2.5,
      vx: 0,
      vz: 0,
      interval: 0,
      pull: 0,
      dur: 0.06,
      ...o,
      ox,
      facing,
      hitT: new Map(),
    };
    this.hits.push(h);
  }

  private removeFollowHits(): void {
    this.hits = this.hits.filter((h) => !h.follow);
  }

  private updateHits(dt: number): void {
    const p = this.player;
    let hitstop = 0;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]! as HitBox & { act?: PAct };
      if (h.act && p.act !== h.act) {
        this.hits.splice(i, 1);
        continue;
      }
      if (h.delay > 0) {
        h.delay -= dt;
        continue;
      }
      h.t += dt;
      let cx = h.x;
      let cz = h.z;
      let y0 = h.y0;
      let y1 = h.y1;
      if (h.follow) {
        cx = p.pos.x + p.facing * h.ox;
        cz = p.pos.z;
        y0 += p.pos.y;
        y1 += p.pos.y;
        h.facing = p.facing;
      } else {
        h.x += h.vx * dt;
        h.z += h.vz * dt;
        cx = h.x;
        cz = h.z;
      }
      for (const e of this.enemies) {
        if (e.dead || e.state === "getup" || e.state === "bIntro" || (e.state === "spawn" && e.pos.y > 0.8)) continue;
        if (!this.overlap(h, cx, cz, y0, y1, e.pos, e.radius, e.height)) continue;
        if (h.pull && !e.boss && !e.freeze) {
          this.tmp.set(cx - e.pos.x, 0, cz - e.pos.z);
          const d = this.tmp.length();
          if (d > 0.6) e.pos.addScaledVector(this.tmp.normalize(), Math.min(d - 0.6, h.pull * dt));
        }
        const last = h.hitT.get(e);
        if (last !== undefined && (h.interval <= 0 || h.t - last < h.interval)) continue;
        h.hitT.set(e, h.t);
        this.damageEnemy(e, h, h.radial ? cx : p.pos.x, h.facing);
        hitstop = Math.max(hitstop, h.hitstop);
        h.onHit?.(e);
      }
      for (const pr of this.props) {
        if (pr.dead || h.hitT.has(pr)) continue;
        if (!this.overlap(h, cx, cz, y0, y1, pr.pos, 0.45, 1)) continue;
        h.hitT.set(pr, h.t);
        this.breakProp(pr);
      }
      if (h.t >= h.dur) this.hits.splice(i, 1);
    }
    if (hitstop > 0) this.hitstop = Math.max(this.hitstop, hitstop);
  }

  private overlap(h: HitBox, cx: number, cz: number, y0: number, y1: number, pos: THREE.Vector3, r: number, height: number): boolean {
    if (pos.y > y1 || pos.y + height < y0) return false;
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    if (h.shape === "circle") return dx * dx + dz * dz <= (h.r + r) * (h.r + r);
    return Math.abs(dx) <= h.hw + r && Math.abs(dz) <= h.hd + r * 0.5;
  }

  /** 主角造成的伤害。srcX 用来判断击退方向和盾牌正面 */
  private damageEnemy(e: Enemy, h: HitInfo, srcX: number, facing = this.player.facing): void {
    if (e.dead) return;
    let dmg = h.dmg * rand(0.92, 1.08);
    const crit = Math.random() < 0.1 + this.stats.crit * 0.15;
    if (crit) dmg *= 1.6;
    if (this.player.dodgeBuff > 0) dmg *= 1.3;
    let style: NumberStyle = crit ? "crit" : "normal";
    const guarding = e.state === "move" || e.state === "windup" || e.state === "recover" || e.state === "hit";
    const blocked =
      e.kind === "shield" && !e.freeze && guarding && e.pos.y < 0.1 && sign(srcX - e.pos.x) === e.facing && !(h.up > 0) && !h.fromAbove && !h.chain;
    if (blocked) {
      dmg *= 0.2;
      style = "block";
    }
    if (e.state === "down") dmg *= 0.5;
    if (e.freeze > 0 && h.heavy && !h.noCombo) {
      dmg *= 2;
      e.freeze = 0;
      this.sparks.emit(this.tmp.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z), 40, ICE, { speed: 9, life: 0.6, up: 3, gravity: 14 });
      sfx.shieldBreak();
      this.elementCombo("碎冰！", e);
    }
    dmg = Math.max(1, Math.round(dmg));
    e.hp -= dmg;
    e.flash = 1;
    this.numbers.show(this.tmp.set(e.pos.x, e.pos.y + e.height * 0.85, e.pos.z), dmg, style);
    this.sparks.emit(this.tmp.set(e.pos.x - facing * 0.2, e.pos.y + e.height * 0.55, e.pos.z + 0.2), blocked ? 6 : 10, blocked ? 0x9ad8ff : (h.color ?? 0xffc080), {
      speed: blocked ? 5 : 8,
      life: 0.3,
    });
    if (this.realTime - this.hitSoundIn > 0.045) {
      this.hitSoundIn = this.realTime;
      if (blocked) sfx.woodTap();
      else sfx.slashHit(h.heavy);
    }
    this.combo++;
    this.comboT = COMBO_WINDOW;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.awaken = Math.min(1, this.awaken + 0.0025);
    this.player.mp = Math.min(PLAYER_MP, this.player.mp + 0.8);
    if (h.element) this.applyElement(e, h.element, h.burnMul ?? 1, !!h.noCombo);

    // 感电：被打时电到旁边一个敌人
    if (e.shock > 0 && !h.chain && e.shockCd <= 0) {
      e.shockCd = 0.25;
      let best: Enemy | null = null;
      let bestD = 4.5;
      for (const o of this.enemies) {
        if (o === e || o.dead) continue;
        const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        this.fx.bolt(this.tmp.set(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z), this.tmp2.set(best.pos.x, best.pos.y + best.height * 0.55, best.pos.z), THUNDER, 0.04, 0.15, 0.35);
        this.damageEnemy(best, { dmg: 0.3 * this.atk(), kb: 1, up: 0, hitstop: 0, element: null, heavy: false, chain: true, color: THUNDER }, e.pos.x);
      }
    }

    if (e.boss) {
      const per = e.maxHp / BOSS.bars;
      const bars = Math.max(0, Math.ceil(e.hp / per));
      if (bars < e.bars && e.hp > 0) {
        e.bars = bars;
        this.awaken = Math.min(1, this.awaken + 0.05);
        if (e.state !== "bLeap") {
          this.clearTele(e);
          e.state = "bStagger";
          e.t = 0;
          e.pt = 0;
          e.vel.set(0, 0, 0);
        }
      }
    }
    if (!blocked) this.react(e, h, srcX, facing);
    if (e.hp <= 0) this.kill(e, srcX);
  }

  /** 受击反应：硬直、击退、浮空 */
  private react(e: Enemy, h: HitInfo, srcX: number, facing: number): void {
    if (e.boss || e.dead || e.freeze > 0) return;
    if (e.elite && e.state === "windup") return;
    const dir = h.radial ? sign(e.pos.x - srcX) : facing;
    if (e.kind === "bomber" && e.state === "fuse") {
      e.vel.x = dir * h.kb * 0.5;
      return;
    }
    this.clearTele(e);
    e.token = false;
    if (h.hold) {
      e.vel.y = e.pos.y < 0.5 ? 7 : 1.2;
      e.hang = 0.3;
      e.vel.x = dir * 0.5;
      e.state = "air";
      e.t = 0;
      e.airHits++;
      return;
    }
    if (e.state === "down" && h.up <= 0) {
      e.vel.x = dir * h.kb * 0.3;
      return;
    }
    if (h.up > 0 || e.pos.y > 0.05 || e.state === "air") {
      e.vel.y = h.up > 0 ? Math.max(4, h.up - e.airHits * 0.5) : Math.max(e.vel.y, 4.2 - e.airHits * 0.25);
      e.vel.x = dir * h.kb * 0.6;
      e.state = "air";
      e.t = 0;
      e.airHits++;
      return;
    }
    e.state = "hit";
    e.t = 0;
    e.hitstun = h.heavy ? 0.45 : 0.3;
    e.vel.x = dir * h.kb;
    e.vel.z = 0;
  }

  private launch(e: Enemy, vx: number, vy: number): void {
    if (e.boss || e.dead) return;
    this.clearTele(e);
    e.token = false;
    e.freeze = 0;
    e.state = "air";
    e.t = 0;
    e.vel.set(vx, vy, 0);
  }

  private applyElement(e: Enemy, el: Element, burnMul: number, noCombo: boolean): void {
    if (e.dead) return;
    if (el === "fire") {
      if (e.freeze > 0 && !noCombo) return this.steam(e);
      if (e.shock > 0 && !noCombo) return this.overload(e);
      e.burn = 3 * burnMul;
      e.burnDps = 0.12 * this.atk() * burnMul;
      return;
    }
    if (el === "ice") {
      if (e.burn > 0 && !noCombo) return this.steam(e);
      this.freezeEnemy(e, 1.5);
      return;
    }
    if (e.burn > 0 && !noCombo) return this.overload(e);
    e.shock = 4;
  }

  private freezeEnemy(e: Enemy, dur: number): void {
    if (e.boss) {
      e.slow = Math.max(e.slow, 2);
      return;
    }
    if (e.freeze <= 0 && this.realTime - this.hitSoundIn > 0.1) sfx.freeze();
    e.freeze = Math.max(e.freeze, dur);
    e.vel.x = e.vel.z = 0;
    this.clearTele(e);
    e.token = false;
    if (e.state === "windup") e.state = "move";
  }

  private steam(e: Enemy): void {
    e.burn = 0;
    e.freeze = 0;
    const at = this.tmp.set(e.pos.x, e.pos.y + 1, e.pos.z).clone();
    this.fx.spawn({ geo: FXGEO.sphere, color: 0xe8f4ff, k: 1.6, pos: at, scale: 0.5, scaleTo: 3.2, life: 0.45, opacity: 0.8 });
    this.puffs.emit(at, 30, 0xcfd8e8, { speed: 6, life: 0.9, up: 2, spread: 1 });
    this.aoe(e.pos, 3, 2.0 * this.atk(), null);
    this.elementCombo("蒸汽爆炸！", e);
    sfx.blast();
  }

  private overload(e: Enemy): void {
    e.burn = 0;
    e.shock = 0;
    const at = this.tmp.set(e.pos.x, e.pos.y + 1, e.pos.z).clone();
    this.fx.spawn({ geo: FXGEO.sphere, color: 0xff8a5a, k: 2, pos: at, scale: 0.4, scaleTo: 2.6, life: 0.35 });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.bolt(at, this.tmp2.set(at.x + Math.cos(a) * 2.6, at.y + rand(-0.5, 1), at.z + Math.sin(a) * 1.5), THUNDER, 0.04, 0.2, 0.4);
    }
    this.aoe(e.pos, 2.6, 1.8 * this.atk(), null);
    this.elementCombo("过载！", e);
    sfx.zap();
  }

  private elementCombo(text: string, e: Enemy): void {
    this.elementCombos++;
    this.hooks.onBanner({ kind: "element", text });
    this.director.kick(0.05, 0, 0.25);
    this.sparks.emit(this.tmp.set(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z), 20, 0xffffff, { speed: 6, life: 0.4 });
  }

  /** 以 pos 为中心的范围伤害（元素组合、爆炸桶、自爆虫） */
  private aoe(pos: THREE.Vector3, r: number, dmg: number, element: Element | null, except?: Enemy): void {
    const c = pos.clone();
    for (const o of [...this.enemies]) {
      if (o.dead || o === except) continue;
      if (Math.hypot(o.pos.x - c.x, o.pos.z - c.z) > r + o.radius) continue;
      this.damageEnemy(o, { dmg, kb: 6, up: 5, hitstop: 0.04, element, heavy: true, radial: true, noCombo: true }, c.x);
    }
    for (const pr of this.props) if (!pr.dead && Math.hypot(pr.pos.x - c.x, pr.pos.z - c.z) < r + 0.4) this.breakProp(pr);
  }

  // ================= 特效小工具 =================

  private slashFx(ox: number, oy: number, angle: number, scale: number, color: number, life: number, stretch: [number, number] = [1, 1], opacity = 1): void {
    const p = this.player;
    const f = p.facing;
    const [sx, sy] = stretch;
    this.fx.spawn({
      geo: FXGEO.arc,
      color,
      k: 2.6,
      pos: [p.pos.x + f * ox, p.pos.y + oy, p.pos.z + 0.25],
      rot: [0, f > 0 ? 0 : Math.PI, angle],
      scale: [scale * sx, scale * sy, 1],
      scaleTo: [scale * sx * 1.15, scale * sy * 1.15, 1],
      life,
      opacity,
    });
  }

  private crossSlash(x: number, y: number, z: number, color: number): void {
    for (const a of [0.75, -0.75]) {
      this.fx.spawn({ geo: FXGEO.slash, color, k: 3, pos: [x, y, z + 0.4], rot: [0, 0, a], scale: [0.4, 1.4, 1], scaleTo: [3, 1, 1], life: 0.25 });
    }
    this.sparks.emit(this.tmp.set(x, y, z), 16, color, { speed: 8, life: 0.35 });
  }

  private groundRing(x: number, z: number, r: number, color: number, life: number): void {
    this.fx.spawn({ geo: FXGEO.ring, color, k: 2.4, pos: [x, 0.06, z], rot: [-Math.PI / 2, 0, 0], scale: r * 0.25, scaleTo: r, life });
  }

  private dust(x: number, z: number, n: number): void {
    this.puffs.emit(this.tmp.set(x, 0.15, z), n, 0x3a3440, { speed: 4, life: 0.6, upward: true, spread: 0.5 });
  }

  private explosion(x: number, z: number, r: number, color: number): void {
    this.fx.spawn({ geo: FXGEO.sphere, color, k: 2.2, pos: [x, r * 0.45, z], scale: r * 0.3, scaleTo: r, life: 0.35, opacity: 0.95 });
    this.fx.spawn({ geo: FXGEO.sphere, color: 0xfff0c0, k: 2.5, pos: [x, r * 0.45, z], scale: r * 0.2, scaleTo: r * 0.6, life: 0.18 });
    this.groundRing(x, z, r * 1.3, color, 0.4);
    this.sparks.emit(this.tmp.set(x, r * 0.4, z), 36, color, { speed: 10, life: 0.6, up: 3, gravity: 10 });
    this.puffs.emit(this.tmp.set(x, r * 0.4, z), 10, 0x2a1a14, { speed: 3, life: 0.9, up: 1.5, spread: r * 0.4 });
  }

  /** 预警区域：圆形或长方形（长方形 a 是 x 方向长度，b 是 z 方向宽度） */
  private tele(e: Enemy | null, shape: "circle" | "rect", x: number, z: number, a: number, b: number, life: number): void {
    const meshes: THREE.Object3D[] = [];
    if (shape === "circle") {
      meshes.push(this.fx.spawn({ geo: FXGEO.disk, color: 0xff2a1a, k: 0.9, pos: [x, 0.05, z], rot: [-Math.PI / 2, 0, 0], scale: a, life, opacity: 0.22, opacityTo: 0.4, additive: false, onTop: true }));
      meshes.push(this.fx.spawn({ geo: FXGEO.disk, color: 0xff2a1a, k: 1, pos: [x, 0.06, z], rot: [-Math.PI / 2, 0, 0], scale: 0.05, scaleTo: a, life, opacity: 0.35, opacityTo: 0.5, additive: false, onTop: true, easeOut: false }));
      meshes.push(this.fx.spawn({ geo: FXGEO.ring, color: 0xff4a2a, k: 1.6, pos: [x, 0.07, z], rot: [-Math.PI / 2, 0, 0], scale: a, life, opacity: 0.9, opacityTo: 0.9, onTop: true }));
    } else {
      meshes.push(this.fx.spawn({ geo: FXGEO.plane, color: 0xff2a1a, k: 1, pos: [x, 0.05, z], rot: [-Math.PI / 2, 0, 0], scale: [a, b, 1], life, opacity: 0.25, opacityTo: 0.55, additive: false, onTop: true }));
    }
    if (e) for (const m of meshes) e.tele.push({ mesh: m, until: this.time + life - 0.02 });
  }

  private clearTele(e: Enemy): void {
    for (const t of e.tele) if (this.time < t.until) this.fx.kill(t.mesh);
    e.tele = [];
  }

  private ghostTick(dt: number, interval: number, color: number, opacity: number): void {
    const p = this.player;
    p.ghostIn -= dt;
    if (p.ghostIn > 0) return;
    p.ghostIn = interval;
    const g = p.rig.ghost(color, opacity);
    g.mat.userData.o0 = opacity;
    this.scene.add(g.group);
    this.ghosts.push({ group: g.group, mat: g.mat, life: 0.3, max: 0.3 });
  }

  private updateGhosts(dt: number): void {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]!;
      g.life -= dt;
      if (g.life <= 0) {
        g.group.removeFromParent();
        g.mat.dispose();
        this.ghosts.splice(i, 1);
      } else g.mat.opacity = (g.mat.userData.o0 as number) * (g.life / g.max);
    }
  }

  private updateTrail(): void {
    const p = this.player;
    const act = p.act;
    let on = false;
    let color = WHITE_SWORD;
    if (act) {
      if (act.kind === "atk1" || act.kind === "atk2" || act.kind === "atk3" || act.kind === "airAtk") on = true;
      if (act.kind === "skill" && act.skill !== "firePunch") {
        on = true;
        const el = SKILLS[act.skill!].element;
        if (el) color = ELEMENT_COLOR[el];
      }
      if (act.kind === "awaken") {
        on = true;
        color = 0xffe080;
      }
    }
    p.rig.weaponEnds(this.tip, this.hilt);
    this.trail.push(this.hilt, this.tip, on && p.rig.group.visible, color);
  }

  private later(t: number, fn: () => void): void {
    this.timers.push({ t, fn });
  }

  // ================= 敌人 =================

  private makeEnemy(kind: EnemyKind | "boss", x: number, z: number, y: number, elite = false): Enemy {
    let model: Model;
    let rig: StickRig | null = null;
    let bug: BugModel | null = null;
    let hp: number;
    let dmg: number;
    let speed: number;
    let score: number;
    let name: string;
    let radius: number;
    let height: number;
    if (kind === "boss") {
      rig = new StickRig({ color: BOSS.color, glow: 0.15, scale: 2.5, weapon: "hammer", crown: true, cape: true });
      model = rig;
      hp = BOSS.hp;
      dmg = BOSS.dmg;
      speed = 2.3;
      score = BOSS.score;
      name = BOSS.name;
      radius = 1.0;
      height = 5;
    } else {
      const def = ENEMIES[kind];
      const s = elite ? 1.3 : 1;
      if (kind === "bomber") {
        bug = new BugModel(def.color, s);
        model = bug;
        radius = 0.5 * s;
        height = 1.1 * s;
      } else {
        const scale = (kind === "goblin" ? 0.85 : 1) * s;
        rig = new StickRig({
          color: def.color,
          glow: 0.12,
          scale,
          weapon: kind === "goblin" ? "dagger" : kind === "archer" ? "bow" : "none",
          hat: kind === "goblin",
          quiver: kind === "archer",
          shield: kind === "shield",
        });
        model = rig;
        radius = 0.45 * scale;
        height = 2 * scale;
      }
      hp = def.hp * (elite ? 3 : 1);
      dmg = def.dmg * (elite ? 1.3 : 1);
      speed = def.speed * (elite ? 1.15 : 1);
      score = def.score * (elite ? 3 : 1);
      name = (elite ? "精英" : "") + def.name;
    }
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(model.group, shadow);
    const e: Enemy = {
      kind,
      name,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      facing: sign(this.player.pos.x - x),
      hp,
      maxHp: hp,
      dmg,
      speed,
      score,
      radius,
      height,
      model,
      rig,
      bug,
      shadow,
      elite,
      boss: kind === "boss",
      state: "spawn",
      t: 0,
      pt: 0,
      atkCd: rand(0.8, 1.8),
      token: false,
      hitstun: 0,
      airHits: 0,
      hang: 0,
      burn: 0,
      burnDps: 0,
      burnTick: 0,
      freeze: 0,
      slow: 0,
      shock: 0,
      shockCd: 0,
      frozenBy: new Set(),
      flash: 0,
      wanderZ: rand(-2.5, 2.5),
      wanderX: rand(3.5, 6),
      wanderT: 0,
      tele: [],
      anim: Math.random() * 10,
      dead: false,
      noPhys: false,
      bars: BOSS.bars,
      enraged: false,
      summonCd: 10,
      aim: new THREE.Vector3(),
      from: new THREE.Vector3(),
      pts: [],
      step: 0,
    };
    this.enemies.push(e);
    this.syncEnemy(e, 0);
    return e;
  }

  private spawnWave(list: Spawn[]): void {
    this.pendingSpawns += list.length;
    list.forEach((s, i) =>
      this.later(i * 0.28, () => {
        this.pendingSpawns--;
        const p = this.player;
        const side = i % 3 === 2 ? -1 : 1;
        let x = p.pos.x + side * rand(5, 9);
        if (x > this.roomW - 1.5 || x < 1.5) x = p.pos.x - side * rand(5, 9);
        x = clamp(x, 1.5, this.roomW - 1.5);
        this.makeEnemy(s.kind, x, rand(-2.6, 2.6), 7, s.elite);
      }),
    );
  }

  private updateEnemies(dt: number): void {
    let attackers = 0;
    for (const e of this.enemies) if (e.token && !e.dead) attackers++;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.anim += dt;
      e.atkCd -= dt;
      e.shockCd -= dt;
      if (e.shock > 0) e.shock -= dt;
      if (e.burn > 0) {
        e.burn -= dt;
        e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick = 0.5;
          this.dot(e, e.burnDps * 0.5);
          if (e.dead) continue;
        }
        if (Math.random() < dt * 12) this.sparks.emit(this.tmp.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z), 1, FIRE, { speed: 1, life: 0.5, up: 2.5, spread: 0.3 });
      }
      if (e.freeze > 0) {
        e.freeze -= dt;
        this.physics(e, dt);
        this.syncEnemy(e, dt, true);
        continue;
      }
      const edt = e.slow > 0 ? dt * 0.5 : dt;
      if (e.slow > 0) e.slow -= dt;
      e.pt = e.t;
      e.t += edt;
      if (e.boss) this.updateBoss(e, edt);
      else {
        const before = e.token;
        this.updateMob(e, edt, attackers);
        if (!before && e.token) attackers++;
        if (before && !e.token) attackers--;
      }
      if (e.dead) continue;
      if (!e.noPhys) this.physics(e, edt);
      this.syncEnemy(e, dt);
    }
    // 互相推开，避免叠在一起
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (a.dead || a.boss) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (b.dead || b.boss) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) * 0.5;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  /** 灼烧之类的持续伤害：不算连击、没有硬直 */
  private dot(e: Enemy, dmg: number): void {
    const v = Math.max(1, Math.round(dmg));
    e.hp -= v;
    this.numbers.show(this.tmp.set(e.pos.x, e.pos.y + e.height * 0.7, e.pos.z), v, "dot");
    if (e.hp <= 0) this.kill(e, e.pos.x - 1);
  }

  private physics(e: Enemy, dt: number): void {
    const air = e.pos.y > 0.001 || e.vel.y > 0;
    if (air) {
      let g = GRAVITY * (1 + e.airHits * 0.07);
      if (e.hang > 0) {
        e.hang -= dt;
        g *= 0.15;
      }
      e.vel.y -= g * dt;
    }
    e.pos.addScaledVector(e.vel, dt);
    if (e.pos.y <= 0) {
      e.pos.y = 0;
      if (air && e.vel.y <= 0) {
        if (e.state === "air") {
          e.state = "down";
          e.t = 0;
          this.dust(e.pos.x, e.pos.z, 6);
        } else if (e.state === "spawn") {
          e.state = e.boss ? e.state : "move";
          e.t = 0;
          this.dust(e.pos.x, e.pos.z, 10);
        }
      }
      if (e.vel.y < 0) e.vel.y = 0;
    }
    if (e.pos.y <= 0 && e.state !== "move") {
      const k = Math.max(0, 1 - dt * 10);
      e.vel.x *= k;
      e.vel.z *= k;
    }
    e.pos.x = clamp(e.pos.x, 0.5, this.roomW - 0.5);
    e.pos.z = clamp(e.pos.z, -Z_LIMIT, Z_LIMIT);
  }

  private syncEnemy(e: Enemy, dt: number, frozen = false): void {
    const m = e.model;
    m.group.position.copy(e.pos);
    m.group.rotation.y = e.facing > 0 ? -0.4 : Math.PI + 0.4;
    if (e.freeze > 0) m.tint(ICE, 0.75);
    else if (e.burn > 0) m.tint(FIRE, 0.4);
    else if (e.shock > 0) m.tint(THUNDER, 0.4);
    else if (e.enraged) m.tint(0xff2a2a, 0.45);
    else if (e.elite) m.tint(0xffc83a, 0.35);
    else m.tint(null);
    if (e.bug) e.bug.animate(e.anim, e.state === "move" && !frozen, e.state === "fuse" ? e.t / 0.9 : 0);
    if (e.flash > 0) {
      e.flash = Math.max(0, e.flash - Math.max(dt, 0.016) * 7);
      m.flash(e.flash);
    }
    if (e.rig && !frozen) e.rig.apply(this.enemyPose(e));
    this.placeShadow(e.shadow, e.pos, e.radius * 2.2);
  }

  private enemyPose(e: Enemy): Pose {
    const moving = Math.abs(e.vel.x) + Math.abs(e.vel.z) > 0.3;
    switch (e.state) {
      case "spawn":
        return P.fall;
      case "hit":
        return P.hurt;
      case "air":
        return mixPose(P.hurt, P.down, Math.min(1, e.t * 2.5));
      case "down":
        return P.down;
      case "getup":
        return mixPose(P.down, STANCE, Math.min(1, e.t / 0.45));
      case "windup":
        return e.kind === "goblin" ? E_POSE.clubUp : e.kind === "shield" ? E_POSE.bashUp : E_POSE.bowDraw;
      case "recover":
        return e.kind === "goblin" ? E_POSE.clubDown : e.kind === "shield" ? E_POSE.bash : E_POSE.bowRelease;
      case "bIdle":
        return moving ? runPose(e.anim * 6) : idlePose(e.anim);
      case "bSmash": {
        const T = e.enraged ? 0.4 : 0.55;
        const lt = (e.t - Math.min(2, Math.floor(e.t / T)) * T) / T;
        if (e.t > 3 * T) return E_POSE.smash;
        return lt < 0.8 ? mixPose(STANCE, E_POSE.hammerUp, lt / 0.8) : E_POSE.smash;
      }
      case "bLeap": {
        const flight = e.enraged ? 0.8 : 1.0;
        if (e.t < 0.45) return mixPose(STANCE, P.crouch, e.t / 0.45);
        if (e.t < 0.45 + flight) return pose({ shR: 3.0, elR: 0.4, wpn: 0.2 }, P.jumpUp);
        return E_POSE.smash;
      }
      case "bSummon":
      case "bIntro":
        return E_POSE.roar;
      case "bStagger":
        return P.hurt;
      default: {
        if (e.kind === "shield") {
          const base = moving ? runPose(e.anim * 9) : idlePose(e.anim);
          return { ...base, shL: 1.2, elL: 1.4 };
        }
        return moving ? runPose(e.anim * (e.kind === "goblin" ? 11 : 9)) : idlePose(e.anim);
      }
    }
  }

  private updateMob(e: Enemy, dt: number, attackers: number): void {
    const p = this.player;
    const dx = p.pos.x - e.pos.x;
    const dz = p.pos.z - e.pos.z;
    const adx = Math.abs(dx);
    const playing = this.state === "playing";
    const playerDown = !!p.act && (p.act.kind === "down" || p.act.kind === "getup" || p.act.kind === "dead");
    switch (e.state) {
      case "spawn":
        return;
      case "hit":
        if (e.t >= e.hitstun) this.toMove(e);
        return;
      case "air":
        return;
      case "down":
        if (e.t >= 0.9) {
          e.state = "getup";
          e.t = 0;
        }
        return;
      case "getup":
        if (e.t >= 0.45) {
          e.airHits = 0;
          this.toMove(e);
        }
        return;
      case "recover":
        e.vel.x = e.vel.z = 0;
        if (e.t >= 0.5) this.toMove(e);
        return;
      case "windup":
        e.vel.x = e.vel.z = 0;
        if (e.t >= this.windupTime(e)) this.mobAttack(e);
        return;
      case "fuse":
        e.vel.x *= 0.9;
        e.vel.z *= 0.9;
        if (e.t >= 0.9) {
          this.bombBlast(e, true);
          this.kill(e, e.pos.x, true);
        }
        return;
      default:
        break;
    }

    // 移动
    e.facing = sign(dx);
    let tx = e.pos.x;
    let tz = e.pos.z;
    let wantAttack = false;
    if (!playing || playerDown) {
      // 主角倒地时散开一点，不追着打
      tx = p.pos.x - sign(dx) * 4.5;
      tz = e.wanderZ;
      if (e.token) e.token = false;
    } else if (e.kind === "archer") {
      tx = p.pos.x - sign(dx) * 7.5;
      if (tx < 1 || tx > this.roomW - 1) tx = p.pos.x + sign(dx) * 7.5;
      tz = p.pos.z;
      wantAttack = Math.abs(adx - 7.5) < 2.5 && Math.abs(dz) < 0.4 && e.atkCd <= 0;
    } else if (e.kind === "bomber") {
      tx = p.pos.x;
      tz = p.pos.z;
      if (Math.hypot(dx, dz) < 1.6) {
        e.state = "fuse";
        e.t = 0;
        this.tele(e, "circle", e.pos.x, e.pos.z, 2.2, 0, 0.9);
        sfx.placeBomb();
        return;
      }
    } else {
      if (!e.token && e.atkCd <= 0 && attackers < MAX_ATTACKERS) e.token = true;
      if (e.token) {
        tx = p.pos.x - sign(dx) * 1.15;
        tz = p.pos.z;
        wantAttack = adx < 1.7 && Math.abs(dz) < 0.5 && e.atkCd <= 0;
      } else {
        e.wanderT -= dt;
        if (e.wanderT <= 0) {
          e.wanderT = rand(1, 2.5);
          e.wanderZ = rand(-2.6, 2.6);
          e.wanderX = rand(3.5, 6);
        }
        tx = p.pos.x - sign(dx) * e.wanderX;
        tz = e.wanderZ;
      }
    }
    if (wantAttack) {
      e.state = "windup";
      e.t = 0;
      const w = this.windupTime(e);
      const f = e.facing;
      if (e.kind === "goblin") this.tele(e, "rect", e.pos.x + f * 0.95, e.pos.z, 1.9, 1.1, w);
      else if (e.kind === "shield") this.tele(e, "rect", e.pos.x + f * 1.05, e.pos.z, 2.1, 1.2, w);
      else this.tele(e, "rect", e.pos.x + f * 6.8, e.pos.z, 13, 0.55, w);
      return;
    }
    const mx = tx - e.pos.x;
    const mz = tz - e.pos.z;
    const d = Math.hypot(mx, mz);
    if (d > 0.15) {
      const sp = e.speed * (d < 1 ? d : 1);
      e.vel.x = (mx / d) * sp;
      e.vel.z = (mz / d) * sp * 0.7;
    } else e.vel.x = e.vel.z = 0;
  }

  private toMove(e: Enemy): void {
    e.state = "move";
    e.t = 0;
  }

  private windupTime(e: Enemy): number {
    const base = e.kind === "goblin" ? 0.55 : e.kind === "shield" ? 0.65 : 0.75;
    return base * (e.elite ? 0.8 : 1);
  }

  private mobAttack(e: Enemy): void {
    const p = this.player;
    e.tele = [];
    const f = e.facing;
    if (e.kind === "archer") {
      const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
      const pos = new THREE.Vector3(e.pos.x + f * 0.6, 1.35 * (e.elite ? 1.3 : 1), e.pos.z);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.shots.push({ pos, vx: f * 17, mesh, dmg: e.dmg, life: 1.3 });
      sfx.swing();
    } else {
      const reach = e.kind === "shield" ? 2.1 : 1.9;
      const rel = (p.pos.x - e.pos.x) * f;
      if (rel > -0.3 && rel < reach * (e.elite ? 1.2 : 1) && Math.abs(p.pos.z - e.pos.z) < 0.6 && p.pos.y < 1.8) {
        const shield = e.kind === "shield";
        this.hurtPlayer(e.dmg, e.pos.x, shield ? 10 : 6, shield ? 6 : 0, shield);
      }
      this.fx.spawn({ geo: FXGEO.arc, color: 0xffd0a0, k: 1.4, pos: [e.pos.x + f * 0.9, 1.0, e.pos.z + 0.2], rot: [0, f > 0 ? 0 : Math.PI, -0.6], scale: 1.1, life: 0.15 });
      sfx.swing(e.kind === "shield");
    }
    e.state = "recover";
    e.t = 0;
    e.token = false;
    e.atkCd = (e.kind === "archer" ? rand(2, 3) : rand(1.4, 2.4)) * (e.elite ? 0.7 : 1);
  }

  private bombBlast(e: Enemy, hurtsPlayer: boolean): void {
    const r = 2.2 * (e.elite ? 1.3 : 1);
    this.explosion(e.pos.x, e.pos.z, r, 0xff5a2a);
    this.director.shake(0.3);
    sfx.blast();
    for (const o of [...this.enemies]) {
      if (o === e || o.dead) continue;
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > r + o.radius) continue;
      this.damageEnemy(o, { dmg: 300, kb: 8, up: 6, hitstop: 0, element: "fire", heavy: true, radial: true, noCombo: true }, e.pos.x);
    }
    const p = this.player;
    if (hurtsPlayer && Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < r && p.pos.y < 1.5) this.hurtPlayer(e.dmg, e.pos.x, 8, 7, true);
  }

  private updateShots(dt: number): void {
    const p = this.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      s.pos.x += s.vx * dt;
      s.life -= dt;
      s.mesh.position.copy(s.pos);
      const hit = Math.abs(s.pos.x - p.pos.x) < 0.5 && Math.abs(s.pos.z - p.pos.z) < 0.45 && p.pos.y < 1.6;
      if (hit) this.hurtPlayer(s.dmg, s.pos.x - sign(s.vx), 4, 0, false);
      if (hit || s.life <= 0 || s.pos.x < -1 || s.pos.x > this.roomW + 1) {
        s.mesh.removeFromParent();
        this.shots.splice(i, 1);
      }
    }
  }

  private kill(e: Enemy, srcX: number, silent = false): void {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    e.token = false;
    this.clearTele(e);
    this.killScore += e.score;
    this.kills++;
    if (!e.boss) this.awaken = Math.min(1, this.awaken + (e.elite ? 0.15 : 0.035));
    const coins = e.boss ? 30 : e.elite ? 8 : Math.floor(rand(2, 5));
    for (let i = 0; i < coins; i++) this.spawnDrop(e.pos, "coin");
    if (Math.random() < (e.elite ? 1 : 0.14)) this.spawnDrop(e.pos, "hp");
    if (Math.random() < (e.elite ? 1 : 0.1)) this.spawnDrop(e.pos, "mp");
    if (e.boss) {
      this.bossDeath(e);
      return;
    }
    const push = new THREE.Vector3(sign(e.pos.x - srcX) * 6, 2, 0);
    this.debris.push({ items: e.model.shatter(this.scene, push), model: e.model, t: 0 });
    e.shadow.removeFromParent();
    this.sparks.emit(this.tmp.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z), 20, e.bug ? 0xff6a3a : 0xffffff, { speed: 7, life: 0.5, gravity: 8 });
    if (e.kind === "bomber" && !silent) this.bombBlast(e, false);

    // 房间里最后一个敌人、精英怪被击杀时放慢镜头
    const def = ROOMS[this.roomIdx]!;
    const last = !def.boss && this.wave >= def.waves.length && this.pendingSpawns === 0 && this.enemies.every((o) => o.dead);
    if (last || e.elite) {
      this.medium(e.pos, this.player.facing, [{ dur: 0.8, pos: [2.8, 0.8, 4.2], toPos: [2.0, 1.0, 3.3], look: [0, 1, 0], fov: 36 }]);
    }
  }

  // ================= Boss =================

  private spawnBoss(): void {
    const e = this.makeEnemy("boss", this.roomW - 6, 0, 14);
    e.state = "bIntro";
    e.facing = -1;
    e.noPhys = true;
    this.boss = e;
    let landed = false;
    this.runScriptNow({
      t: 0,
      end: 2.5,
      events: [
        {
          at: 0.9,
          fn: () => {
            this.hooks.onBanner({ kind: "boss", text: `⚠ ${BOSS.name}` });
            sfx.bossWarning();
          },
          done: false,
        },
      ],
      update: (t, dt) => {
        if (!landed) {
          e.vel.y -= 40 * dt;
          e.pos.y += e.vel.y * dt;
          if (e.pos.y <= 0 || t >= 0.8) {
            e.pos.y = 0;
            e.vel.y = 0;
            landed = true;
            this.director.shake(0.9);
            this.dust(e.pos.x, e.pos.z, 30);
            this.groundRing(e.pos.x, e.pos.z, 5, 0xffa060, 0.5);
            sfx.blast();
            vibrate(80);
          }
        }
        e.rig!.apply(landed && t > 1 ? E_POSE.roar : landed ? mixPose(P.crouch, E_POSE.roar, Math.min(1, (t - 0.7) * 3)) : P.fall);
        e.model.group.position.copy(e.pos);
        e.model.group.rotation.y = Math.PI + 0.4;
        this.placeShadow(e.shadow, e.pos, e.radius * 2.2);
      },
      onEnd: () => {
        e.pos.y = 0;
        e.state = "bIdle";
        e.t = 0;
        e.noPhys = false;
      },
    });
    this.director.play(this.tmp.set(e.pos.x, 0, 0), -1, [
      { dur: 0.85, pos: [3.5, 1.0, 6.5], look: [0, 3, 0], fov: 42 },
      { dur: 1.65, pos: [2.6, 2.4, 5.8], toPos: [1.8, 2.8, 4.4], look: [0, 3.6, 0], fov: 42 },
    ]);
  }

  private updateBoss(e: Enemy, dt: number): void {
    const p = this.player;
    const dx = p.pos.x - e.pos.x;
    const dz = p.pos.z - e.pos.z;
    const adx = Math.abs(dx);
    const at = (x: number) => e.pt < x && e.t >= x;
    if (!e.enraged && e.hp < e.maxHp / 2) {
      e.enraged = true;
      this.hooks.onBanner({ kind: "warn", text: "酋长狂暴了！" });
      sfx.bossWarning();
    }
    e.summonCd -= dt;
    const spd = e.enraged ? 1.3 : 1;
    const playing = this.state === "playing";
    switch (e.state) {
      case "bIntro":
        return;
      case "bStagger":
        e.vel.x = e.vel.z = 0;
        if (e.t >= 1.2) this.bossIdle(e);
        return;
      case "bIdle": {
        e.facing = sign(dx);
        if (adx > 3) {
          e.vel.x = sign(dx) * 2.3 * spd;
          e.vel.z = clamp(dz, -1, 1) * 1.5;
        } else e.vel.x = e.vel.z = 0;
        if (!playing) return;
        if (e.t > (e.enraged ? 0.6 : 1.0)) {
          const minions = this.enemies.filter((o) => !o.dead && !o.boss).length;
          e.t = 0;
          e.pt = 0;
          e.vel.x = e.vel.z = 0;
          if (e.summonCd <= 0 && minions < 3) e.state = "bSummon";
          else if (adx > 6 || Math.random() < 0.35) e.state = "bLeap";
          else {
            e.state = "bSmash";
            const dir = this.tmp.set(dx, 0, dz).normalize();
            e.pts = [2.6, 4.6, 6.6].map((d) => new THREE.Vector3(clamp(e.pos.x + dir.x * d, 1, this.roomW - 1), 0, clamp(e.pos.z + dir.z * d, -Z_LIMIT, Z_LIMIT)));
          }
        }
        return;
      }
      case "bSmash": {
        const T = e.enraged ? 0.4 : 0.55;
        for (let i = 0; i < 3; i++) {
          const pt = e.pts[i]!;
          if (at(i * T)) this.tele(e, "circle", pt.x, pt.z, 1.8, 0, T);
          if (at(i * T + T)) {
            this.groundRing(pt.x, pt.z, 2.2, 0xffa060, 0.4);
            this.dust(pt.x, pt.z, 14);
            this.sparks.emit(this.tmp.set(pt.x, 0.3, pt.z), 16, 0xffa060, { speed: 7, life: 0.4, up: 5, gravity: 14 });
            this.director.shake(0.35);
            sfx.blast();
            if (Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z) < 2.1 && p.pos.y < 1.2) this.hurtPlayer(e.dmg, pt.x, 7, 8, true);
          }
        }
        if (e.t >= 3 * T + 0.7) this.bossIdle(e);
        return;
      }
      case "bLeap": {
        const flight = e.enraged ? 0.8 : 1.0;
        if (at(0.45)) {
          e.from.copy(e.pos);
          e.aim.set(clamp(p.pos.x, 2, this.roomW - 2), 0, p.pos.z);
          e.facing = sign(e.aim.x - e.pos.x);
          this.tele(e, "circle", e.aim.x, e.aim.z, 2.6, 0, flight);
          e.noPhys = true;
          sfx.hop();
        }
        if (e.t > 0.45 && e.t < 0.45 + flight) {
          const k = (e.t - 0.45) / flight;
          e.pos.lerpVectors(e.from, e.aim, k);
          e.pos.y = Math.sin(Math.PI * k) * 6;
        }
        if (at(0.45 + flight)) {
          e.pos.copy(e.aim);
          e.noPhys = false;
          e.tele = [];
          this.groundRing(e.pos.x, e.pos.z, 3, 0xffa060, 0.4);
          this.fx.spawn({ geo: FXGEO.ring, color: 0xffa060, k: 2, pos: [e.pos.x, 0.08, e.pos.z], rot: [-Math.PI / 2, 0, 0], scale: 2.6, scaleTo: 11, life: 0.93, opacity: 1, opacityTo: 0.4, easeOut: false });
          this.waves.push({ pos: e.pos.clone(), r: 2.6, max: 11, speed: 9, hit: false, dmg: 120 });
          this.dust(e.pos.x, e.pos.z, 30);
          this.director.shake(0.7);
          sfx.blast();
          vibrate(60);
          if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < 2.6 && p.pos.y < 1.5) this.hurtPlayer(180, e.pos.x, 8, 9, true);
        }
        if (e.t < 0.45 || e.t > 0.45 + flight) e.vel.x = e.vel.z = 0;
        if (e.t >= 0.45 + flight + 0.8) this.bossIdle(e);
        return;
      }
      case "bSummon": {
        e.vel.x = e.vel.z = 0;
        if (at(0.4)) {
          sfx.bossWarning();
          this.director.shake(0.3);
          for (const side of [-1, 1]) {
            const x = clamp(p.pos.x + side * rand(4, 6), 1.5, this.roomW - 1.5);
            this.makeEnemy("goblin", x, rand(-2.5, 2.5), 7);
          }
          e.summonCd = 14;
        }
        if (e.t >= 1.2) this.bossIdle(e);
        return;
      }
      default:
        return;
    }
  }

  private bossIdle(e: Enemy): void {
    e.state = "bIdle";
    e.t = 0;
    e.pt = 0;
    e.noPhys = false;
  }

  private bossDeath(e: Enemy): void {
    // 小怪一起倒下，主角无敌
    for (const o of [...this.enemies]) if (!o.dead && o !== e) this.kill(o, e.pos.x, true);
    this.player.invuln = 99;
    this.hits = [];
    this.shots.forEach((s) => s.mesh.removeFromParent());
    this.shots = [];
    this.waves = [];
    this.runAfterScript(() => {
      this.runScriptNow({
        t: 0,
        end: 2.8,
        events: [
          {
            at: 0.5,
            fn: () => {
              this.debris.push({ items: e.model.shatter(this.scene, new THREE.Vector3(sign(e.pos.x - this.player.pos.x) * 4, 4, 0)), model: e.model, t: 0 });
              e.shadow.removeFromParent();
              this.explosion(e.pos.x, e.pos.z, 4, 0xffc060);
              this.sparks.emit(this.tmp.set(e.pos.x, 2.5, e.pos.z), 140, 0xffe0a0, { speed: 14, life: 1.1, up: 3, gravity: 8 });
              this.hooks.onFlash("white");
              this.director.shake(1);
              sfx.explode();
              vibrate(200);
            },
            done: false,
          },
        ],
        update: (t) => {
          if (t < 0.5 && e.rig) {
            e.rig.apply(P.hurt);
            e.model.flash(Math.sin(t * 40) > 0 ? 1 : 0);
          }
        },
        onEnd: () => {
          this.hooks.onBanner({ kind: "clear", text: "🏆 通关！" });
          sfx.win();
          this.later(1.2, () => this.finish(true));
        },
      });
      this.director.play(this.tmp.set(e.pos.x, 0, e.pos.z), sign(this.player.pos.x - e.pos.x), [
        { dur: 2.8, pos: [4, 1.6, 6], toPos: [-4, 3, 7], look: [0, 2.2, 0], fov: 44 },
      ]);
    });
  }

  private updateWaves(dt: number): void {
    const p = this.player;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]!;
      w.r += w.speed * dt;
      if (!w.hit) {
        const d = Math.hypot(p.pos.x - w.pos.x, p.pos.z - w.pos.z);
        if (Math.abs(d - w.r) < 0.5 && p.pos.y < 0.45) {
          w.hit = true;
          this.hurtPlayer(w.dmg, w.pos.x, 6, 6, true);
        }
      }
      if (w.r > w.max) this.waves.splice(i, 1);
    }
  }

  // ================= 主角受伤 =================

  private hurtPlayer(dmg: number, srcX: number, kb: number, up: number, heavy: boolean): void {
    const p = this.player;
    if (this.state !== "playing" || p.invuln > 0 || this.cineLock > 0 || this.script) return;
    const k = p.act?.kind;
    if (k === "awaken" || k === "down" || k === "getup" || k === "dead") return;
    const v = Math.round(dmg * rand(0.9, 1.1) * (this.bellT > 0 ? 0.5 : 1));
    p.hp -= v;
    if (this.bellT > 0 && this.has("bell.reflect")) this.aoe(p.pos.clone(), 2.4, dmg * 0.6, null);
    this.hitsTaken++;
    this.combo = 0;
    this.comboT = 0;
    this.numbers.show(this.tmp.set(p.pos.x, p.pos.y + 1.9, p.pos.z), v, "hurt");
    this.sparks.emit(this.tmp.set(p.pos.x, p.pos.y + 1.1, p.pos.z), 14, 0xff3a4a, { speed: 6, life: 0.4 });
    sfx.playerHit();
    vibrate(heavy ? 60 : 30);
    this.director.shake(heavy ? 0.4 : 0.2);
    this.hooks.onFlash("red");
    const dir = sign(p.pos.x - srcX);
    if (p.hp <= 0) {
      p.hp = 0;
      this.die(dir);
      return;
    }
    if (heavy || up > 0) {
      const act = this.startAct("down", 1, 1);
      act.landed = false;
      p.vel.set(dir * kb * 0.6, up || 6, 0);
    } else {
      this.startAct("hurt", 0.3, 0.3);
      p.vel.set(dir * kb, p.vel.y, 0);
      p.invuln = 0.25;
    }
  }

  private die(dir: number): void {
    const p = this.player;
    this.state = "dead";
    this.startAct("dead", 99, 99);
    p.vel.set(dir * 5, 6, 0);
    this.deadT = 1.4;
    this.hits = [];
    vibrate(200);
    sfx.explode();
  }

  // ================= 场景物件与掉落 =================

  private breakProp(pr: Prop): void {
    if (pr.dead) return;
    pr.dead = true;
    pr.mesh.removeFromParent();
    if (pr.kind === "crate") {
      this.puffs.emit(this.tmp.set(pr.pos.x, 0.5, pr.pos.z), 10, 0x6a4a2a, { speed: 4, life: 0.6, up: 2 });
      this.sparks.emit(this.tmp.set(pr.pos.x, 0.5, pr.pos.z), 14, 0xc08a4a, { speed: 6, life: 0.5, up: 3, gravity: 14 });
      sfx.woodPlace();
      for (let i = 0; i < 3; i++) this.spawnDrop(pr.pos, "coin");
      if (Math.random() < 0.3) this.spawnDrop(pr.pos, "hp");
      else if (Math.random() < 0.25) this.spawnDrop(pr.pos, "mp");
    } else {
      this.later(0.12, () => {
        this.explosion(pr.pos.x, pr.pos.z, 2.6, FIRE);
        this.director.shake(0.35);
        sfx.blast();
        for (const o of [...this.enemies]) {
          if (o.dead || Math.hypot(o.pos.x - pr.pos.x, o.pos.z - pr.pos.z) > 2.6 + o.radius) continue;
          this.damageEnemy(o, { dmg: 4 * this.atk(), kb: 8, up: 7, hitstop: 0.05, element: "fire", heavy: true, radial: true }, pr.pos.x);
        }
        for (const o of this.props) if (!o.dead && Math.hypot(o.pos.x - pr.pos.x, o.pos.z - pr.pos.z) < 2.6) this.breakProp(o);
      });
    }
  }

  private spawnDrop(at: THREE.Vector3, kind: DropItem["kind"]): void {
    const mesh = new THREE.Mesh(kind === "coin" ? this.coinGeo : this.potionGeo, this.dropMats[kind]);
    const pos = new THREE.Vector3(at.x, Math.max(0.3, at.y + 0.6), at.z);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.drops.push({ kind, mesh, pos, vel: new THREE.Vector3(rand(-3, 3), rand(4, 8), rand(-1.5, 1.5)), t: 0 });
  }

  private updateDrops(dt: number): void {
    const p = this.player;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.t += dt;
      const dx = p.pos.x - d.pos.x;
      const dz = p.pos.z - d.pos.z;
      const dist = Math.hypot(dx, dz, p.pos.y + 0.8 - d.pos.y);
      if (d.t > 0.5 && dist < 2.4 && this.state === "playing") {
        d.vel.set(dx, p.pos.y + 0.8 - d.pos.y, dz).normalize().multiplyScalar(12);
        d.pos.addScaledVector(d.vel, dt);
      } else {
        d.vel.y -= 20 * dt;
        d.pos.addScaledVector(d.vel, dt);
        if (d.pos.y < 0.22) {
          d.pos.y = 0.22;
          d.vel.y = Math.abs(d.vel.y) * 0.35;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
        }
      }
      d.pos.x = clamp(d.pos.x, 0.5, this.roomW - 0.5);
      d.pos.z = clamp(d.pos.z, -Z_LIMIT, Z_LIMIT);
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y += dt * 5;
      if (d.t > 0.3 && dist < 0.7 && this.state === "playing") {
        d.mesh.removeFromParent();
        this.drops.splice(i, 1);
        this.pickup(d.kind);
      }
    }
  }

  private pickup(kind: DropItem["kind"]): void {
    const p = this.player;
    if (kind === "coin") {
      this.gold++;
      if (this.realTime - this.hitSoundIn > 0.06) sfx.pick();
    } else if (kind === "hp") {
      const v = Math.round(p.maxHp * 0.25);
      p.hp = Math.min(p.maxHp, p.hp + v);
      this.numbers.show(this.tmp.set(p.pos.x, p.pos.y + 2, p.pos.z), v, "heal");
      sfx.powerup();
    } else {
      p.mp = Math.min(PLAYER_MP, p.mp + 40);
      sfx.powerup();
    }
  }

  private updateFields(dt: number): void {
    const p = this.player;
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i]!;
      f.t += dt;
      if (f.follow) {
        f.pos.set(p.pos.x, 0, p.pos.z);
        f.disk.position.set(f.pos.x, 0.04, f.pos.z);
      }
      for (const e of this.enemies) {
        if (e.dead || f.pos.distanceTo(this.tmp.set(e.pos.x, 0, e.pos.z)) > f.r + e.radius || e.frozenBy.has(f)) continue;
        e.frozenBy.add(f);
        if (e.pos.y < 1) this.freezeEnemy(e, 1.5);
      }
      f.snowT -= dt;
      if (f.snowT <= 0) {
        f.snowT = 0.08;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * f.r;
        this.sparks.emit(this.tmp.set(f.pos.x + Math.cos(a) * d, rand(1, 3), f.pos.z + Math.sin(a) * d * 0.8), 2, 0xdff6ff, { speed: 0.5, life: 1, gravity: 1.5 });
      }
      if (f.respike) {
        f.spikeT -= dt;
        if (f.spikeT <= 0) {
          f.spikeT = 1;
          this.iceSpikes(f);
          sfx.freeze();
        }
      }
      if (f.t >= f.dur) this.fields.splice(i, 1);
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const fp = this.patches[i]!;
      fp.t += dt;
      fp.tick -= dt;
      if (fp.tick <= 0) {
        fp.tick = 0.4;
        for (const e of [...this.enemies]) {
          if (e.dead || Math.hypot(e.pos.x - fp.pos.x, e.pos.z - fp.pos.z) > 0.9 + e.radius) continue;
          this.damageEnemy(e, { dmg: 0.2 * this.atk(), kb: 0, up: 0, hitstop: 0, element: "fire", heavy: false, color: FIRE }, fp.pos.x);
        }
      }
      if (Math.random() < dt * 8) this.sparks.emit(this.tmp.set(fp.pos.x + rand(-0.4, 0.4), 0.2, fp.pos.z + rand(-0.3, 0.3)), 1, FIRE, { speed: 0.8, life: 0.5, up: 3 });
      if (fp.t > 2) this.patches.splice(i, 1);
    }
  }

  private updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const set = this.debris[i]!;
      set.t += dt;
      for (const d of set.items) {
        d.vel.y -= 22 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.y += d.spin.y * dt;
        d.mesh.rotation.z += d.spin.z * dt;
        if (d.mesh.position.y < 0.08) {
          d.mesh.position.y = 0.08;
          d.vel.y = Math.abs(d.vel.y) * 0.3;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
          d.spin.multiplyScalar(0.6);
        }
      }
      if (set.t > 1) set.model.setOpacity(Math.max(0, 1 - (set.t - 1) / 0.6));
      if (set.t > 1.6) {
        this.removeDebris(set);
        this.debris.splice(i, 1);
      }
    }
  }

  private removeDebris(set: DebrisSet): void {
    for (const d of set.items) d.mesh.removeFromParent();
    set.model.dispose();
  }

  // ================= 房间流程与选卡 =================

  private updateRoom(dt: number): void {
    const def = ROOMS[this.roomIdx]!;
    if (def.boss || this.roomCleared) return;
    if (this.enemies.length || this.pendingSpawns) return;
    if (this.wave < def.waves.length) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        if (this.wave > 0) this.hooks.onBanner({ kind: "warn", text: `第 ${this.wave + 1} 波` });
        this.spawnWave(def.waves[this.wave]!);
        this.wave++;
        this.waveDelay = 1.2;
      }
      return;
    }
    this.roomCleared = true;
    this.hooks.onBanner({ kind: "clear", text: "清除！" });
    this.later(1.1, () => {
      if (this.state !== "playing") return;
      this.state = "cards";
      this.player.act = null;
      this.player.vel.set(0, 0, 0);
      this.hooks.onCards(this.drawCards());
    });
  }

  private drawCards(): Card[] {
    const owned = new Set(this.slots);
    const newSkills: Card[] = this.slots.length < MAX_SLOTS ? ROLES[this.role].pool.filter((s) => !owned.has(s)).map((s) => ({ kind: "skill", skill: s })) : [];
    const ups: Card[] = this.slots.flatMap((s) =>
      (this.levels[s] ?? 0) < MAX_SKILL_LEVEL
        ? SKILLS[s].upgrades.filter((u) => !this.upgrades.has(u.id)).map((u): Card => ({ kind: "upgrade", skill: s, upgrade: u.id }))
        : [],
    );
    const stats: Card[] = (Object.keys(STATS) as StatId[]).map((s) => ({ kind: "stat", stat: s }));
    const key = (c: Card) => (c.kind === "skill" ? c.skill : c.kind === "upgrade" ? c.upgrade : c.stat);
    const out: Card[] = [];
    const add = (c: Card | undefined) => {
      if (c && !out.some((o) => key(o) === key(c))) out.push(c);
    };
    if (newSkills.length) add(pickOne(newSkills));
    if (ups.length) add(pickOne(ups));
    add(pickOne(stats));
    for (const c of shuffle([...newSkills, ...ups, ...stats])) {
      if (out.length >= 3) break;
      add(c);
    }
    return shuffle(out.slice(0, 3));
  }

  private applyCard(c: Card): void {
    const p = this.player;
    if (c.kind === "skill") {
      if (!this.slots.includes(c.skill) && this.slots.length < MAX_SLOTS) this.slots.push(c.skill);
      this.hooks.onBanner({ kind: "info", text: `学会了 ${SKILLS[c.skill].icon} ${SKILLS[c.skill].name}` });
    } else if (c.kind === "upgrade") {
      this.upgrades.add(c.upgrade);
      this.levels[c.skill] = (this.levels[c.skill] ?? 0) + 1;
    } else {
      this.stats[c.stat]++;
      if (c.stat === "maxHp") {
        p.maxHp = Math.round(ROLES[this.role].hp * (1 + 0.2 * this.stats.maxHp));
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
      }
    }
    sfx.powerup();
  }

  // ================= 运镜与脚本 =================

  /** 中档运镜：慢动作 + 低角度镜头。关掉运镜或冷却中时退化成轻档推镜 */
  private medium(anchor: THREE.Vector3, facing: number, shots: Shot[]): void {
    if (!this.director.enabled || this.script || this.realTime - this.lastMedium < MEDIUM_COOLDOWN || this.state !== "playing") {
      this.director.kick(0.08, 0.02 * facing, 0.3);
      return;
    }
    this.lastMedium = this.realTime;
    const dur = shots.reduce((s, x) => s + x.dur, 0);
    this.slowT = dur;
    this.cineLock = dur;
    this.player.invuln = Math.max(this.player.invuln, 0.5);
    this.director.play(anchor, facing, shots);
    this.hooks.onCine(true);
  }

  private runScriptNow(s: Script): void {
    this.script = s;
    this.hooks.onCine(true);
  }

  private pendingScripts: (() => void)[] = [];

  private runAfterScript(fn: () => void): void {
    if (this.script) this.pendingScripts.push(fn);
    else fn();
  }

  private runScript(dt: number): void {
    const s = this.script!;
    s.t += dt;
    for (const ev of s.events) {
      if (!ev.done && s.t >= ev.at) {
        ev.done = true;
        ev.fn();
      }
    }
    s.update?.(Math.min(s.t, s.end), dt);
    if (s.t >= s.end && this.script === s) this.endScript();
  }

  private endScript(): void {
    const s = this.script;
    if (!s) return;
    this.script = null;
    s.onEnd?.();
    this.director.stop();
    this.hooks.onCine(false);
    const next = this.pendingScripts.shift();
    if (next) next();
  }

  /** 觉醒技：万剑归宗 */
  private startSwordAwaken(): void {
    const p = this.player;
    const f = p.facing;
    this.startAct("awaken", 99, 99);
    p.invuln = 99;
    this.hits = this.hits.filter((h) => !h.follow);
    sfx.awaken();
    vibrate(50);
    const targets = this.enemies.filter((e) => !e.dead && e.state !== "bIntro");
    const center = new THREE.Vector3(p.pos.x - f * 0.6, p.pos.y + 1.7, p.pos.z - 0.4);
    this.swords = [];
    for (let i = 0; i < SWORD_COUNT; i++) {
      const th = -1.35 + (2.7 * i) / (SWORD_COUNT - 1) + rand(-0.03, 0.03);
      const ring = i % 3;
      const r = 1.7 + ring * 0.55;
      const home = new THREE.Vector3(center.x + Math.sin(th) * r, center.y + Math.cos(th) * r * 0.9, center.z - 0.3 - ring * 0.25);
      const target = targets.length ? targets[i % targets.length]! : null;
      this.swords.push({
        home,
        dir: home.clone().sub(center).normalize(),
        appear: 0.45 + i * 0.005,
        launch: 1.05 + i * 0.0095,
        flight: rand(0.18, 0.3),
        target,
        goal: target
          ? new THREE.Vector3(target.pos.x + rand(-0.3, 0.3), target.pos.y + target.height * rand(0.3, 0.8), target.pos.z)
          : new THREE.Vector3(p.pos.x + f * rand(2, 9), 0.2, rand(-2.5, 2.5)),
        done: false,
      });
    }
    this.swordMesh.visible = true;
    const boss = this.boss && !this.boss.dead ? this.boss : null;
    const bigX = boss ? boss.pos.x : p.pos.x + f * 4.5;
    const bigZ = boss ? boss.pos.z : p.pos.z;
    const hemi0 = this.hemi.intensity;
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const dir = new THREE.Vector3();

    this.runScriptNow({
      t: 0,
      end: 2.9,
      events: [
        {
          at: 2.1,
          fn: () => {
            this.bigSword.visible = true;
            (this.bigSword.material as THREE.MeshBasicMaterial).opacity = 1;
            sfx.swing(true);
          },
          done: false,
        },
        {
          at: 2.4,
          fn: () => {
            for (const e of [...this.enemies]) {
              if (e.dead) continue;
              this.damageEnemy(e, { dmg: 8 * this.atk(), kb: 6, up: e.boss ? 0 : 11, hitstop: 0, element: null, heavy: true, radial: true, color: 0xfff0b0 }, bigX);
            }
            for (const pr of this.props) if (!pr.dead && Math.abs(pr.pos.x - bigX) < 10) this.breakProp(pr);
            this.groundRing(bigX, bigZ, 9, 0xfff0b0, 0.7);
            this.groundRing(bigX, bigZ, 5, 0xffffff, 0.5);
            this.fx.spawn({ geo: FXGEO.sphere, color: 0xfff0b0, k: 2.5, pos: [bigX, 0.5, bigZ], scale: 1, scaleTo: 6, life: 0.5, opacity: 0.9 });
            this.sparks.emit(this.tmp.set(bigX, 0.5, bigZ), 160, 0xfff0b0, { speed: 16, life: 0.9, up: 5, gravity: 10 });
            this.dust(bigX, bigZ, 40);
            this.hooks.onFlash("white");
            this.director.shake(1.2);
            sfx.explode();
            vibrate(150);
          },
          done: false,
        },
      ],
      update: (t) => {
        const dim = t < 0.3 ? t / 0.3 : t > 2.6 ? Math.max(0, (2.9 - t) / 0.3) : 1;
        this.hemi.intensity = hemi0 * (1 - 0.75 * dim);
        this.sun.intensity = 1.3 * (1 - 0.7 * dim);
        this.swords.forEach((s, i) => {
          let scale = 0;
          if (t >= s.appear && t < s.launch) {
            scale = Math.min(1, (t - s.appear) / 0.12);
            pos.copy(s.home).addScaledVector(s.dir, Math.sin(t * 6 + i) * 0.05);
            dir.copy(s.dir);
          } else if (t >= s.launch && !s.done) {
            const k = (t - s.launch) / s.flight;
            if (k >= 1) {
              s.done = true;
              if (s.target && !s.target.dead) {
                this.damageEnemy(s.target, { dmg: 0.45 * this.atk(), kb: 0.5, up: 0, hitstop: 0, element: null, heavy: false, color: WHITE_SWORD }, p.pos.x);
              }
              this.sparks.emit(s.goal, 5, WHITE_SWORD, { speed: 5, life: 0.3 });
            } else {
              scale = 1;
              pos.lerpVectors(s.home, s.goal, k * k);
              pos.y += Math.sin(Math.PI * k) * 0.8;
              dir.subVectors(s.goal, s.home).normalize();
            }
          }
          this.quat.setFromUnitVectors(up, dir.lengthSq() > 0 ? dir : up);
          scl.setScalar(scale);
          this.mat4.compose(pos, this.quat, scl);
          this.swordMesh.setMatrixAt(i, this.mat4);
        });
        this.swordMesh.instanceMatrix.needsUpdate = true;

        // 巨剑从天而降
        if (t >= 2.1) {
          const k = Math.min(1, (t - 2.1) / 0.3);
          const y = 16 - 16 * k * k;
          this.bigSword.position.set(bigX, y - 0.6, bigZ);
          this.bigSword.rotation.set(Math.PI, 0, 0);
          this.bigSword.scale.set(4, 7, 4);
          if (t > 2.5) (this.bigSword.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - (t - 2.5) / 0.4);
        }
      },
      onEnd: () => {
        this.swordMesh.visible = false;
        this.bigSword.visible = false;
        this.hemi.intensity = hemi0;
        this.sun.intensity = 1.3;
        if (p.act?.kind === "awaken") p.act = null;
        p.invuln = this.boss?.dead ? 99 : 0.6;
      },
    });
    this.director.play(p.pos, f, [
      { dur: 0.45, pos: [2.4, 1.6, 2.2], toPos: [1.8, 1.7, 1.6], look: [0, 1.5, 0], fov: 38 },
      { dur: 0.6, pos: [-3.8, 2.2, 3.8], toPos: [-4.6, 3.4, 2.4], look: [0.5, 2.4, -0.4], fov: 45 },
      { dur: 1.05, pos: [2.5, 6.5, 13.5], look: [3, 1, -0.4], fov: 34 },
      { dur: 0.8, pos: [4, 13, 7], toPos: [4, 11, 6], look: [4, 0, 0], fov: 45 },
    ]);
  }

  // ================= HUD 与结算 =================

  private emitHud(): void {
    this.hudIn = 0.1;
    const p = this.player;
    const def = ROOMS[this.roomIdx]!;
    const b = this.boss && !this.boss.dead ? this.boss : null;
    this.hooks.onHud({
      hp: Math.max(0, Math.round(p.hp)),
      maxHp: p.maxHp,
      mp: Math.round(p.mp),
      maxMp: PLAYER_MP,
      combo: this.combo,
      awaken: this.awaken,
      skills: this.slots.map((id) => ({
        id,
        name: SKILLS[id].name,
        icon: SKILLS[id].icon,
        cd: id === "dash" && this.dashCharge > 0 ? 0 : (this.cds[id] ?? 0) / this.skillCd(id),
        mpOk: p.mp >= SKILLS[id].mp,
        level: this.levels[id] ?? 0,
      })),
      room: this.roomIdx,
      rooms: ROOMS.length,
      roomName: def.name,
      boss: b && b.state !== "bIntro" ? { name: BOSS.name, hp: Math.max(0, b.hp), max: b.maxHp, bars: BOSS.bars } : null,
      score: this.killScore + this.gold * 20 + this.maxCombo * 30 + this.elementCombos * 200,
      doorOpen: this.doorOpen,
      dodgeCd: p.dodgeCd / 0.9,
      air: !this.onGround(),
    });
  }

  private finish(victory: boolean): void {
    if (this.state === "over") return;
    this.state = "over";
    const seconds = Math.round(this.playTime);
    const breakdown = [
      { label: "击杀", value: this.killScore },
      { label: "金币", value: this.gold * 20 },
      { label: "最大连击", value: this.maxCombo * 30 },
      { label: "元素组合", value: this.elementCombos * 200 },
      { label: "速度", value: victory ? Math.max(0, Math.round((300 - seconds) * 20)) : 0 },
      { label: "无伤", value: victory ? Math.max(0, (20 - this.hitsTaken) * 100) : 0 },
    ];
    const score = breakdown.reduce((s, b) => s + b.value, 0);
    this.hooks.onResult({
      victory,
      score,
      grade: gradeFor(score, this.revived),
      seconds,
      kills: this.kills,
      maxCombo: this.maxCombo,
      hitsTaken: this.hitsTaken,
      elementCombos: this.elementCombos,
      revived: this.revived,
      breakdown,
    });
  }

  // ================= 枪客 / 拳师 / 暗器师 / 扇舞者 =================

  private startAwaken(): void {
    if (this.role === "sword") this.startSwordAwaken();
    else this.startRoleAwaken();
  }

  private mod(id: SkillId, key: "dmg" | "size" | "cd" | "dur"): number {
    let m = 1;
    for (const u of SKILLS[id].upgrades) {
      const v = u.mod?.[key];
      if (v && this.upgrades.has(u.id)) m *= v;
    }
    return m;
  }

  private petal(at: { x: number; y: number; z: number }, n: number, color: number, speed = 5, life = 0.9): void {
    this.theme?.petals.burst(at, n, color, speed, life);
  }

  /** 一道发光的线，从 from 沿 dir 画出长度 len（枪尖、飞刀的轨迹） */
  private line(from: THREE.Vector3, dir: THREE.Vector3, len: number, width: number, color: number, life: number): void {
    const m = this.fx.spawn({ geo: FXGEO.beam, color, k: 2.6, pos: from, scale: [width, len, width], scaleTo: [width * 0.3, len, width * 0.3], life, opacity: 1, opacityTo: 0 });
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  }

  /** 竖直放着的半圆剑光，朝向镜头 */
  private arcFx(at: { x: number; y: number; z: number }, r: number, color: number, life: number, spin = 0, k = 2.6, angle = 0): void {
    const f = this.player.facing;
    this.fx.spawn({ geo: FXGEO.arc, color, k, pos: [at.x, at.y, at.z], rot: [0, f > 0 ? 0 : Math.PI, angle], scale: r, scaleTo: r * 1.15, life, spin: [0, 0, spin] });
  }

  /** 地面上的墨迹 */
  private ink(x: number, z: number, r: number, life: number): void {
    this.fx.spawn({ geo: FXGEO.disk, color: 0x0a0a12, k: 1, additive: false, pos: [x, 0.03, z], rot: [-Math.PI / 2, 0, 0], scale: r * 0.3, scaleTo: r, life, opacity: 0.85, opacityTo: 0 });
  }

  /** 一条青龙：一串渐细的光珠沿直线冲出去 */
  private dragon(from: THREE.Vector3, f: number, color: number, life: number, speed: number, count = 14): void {
    for (let i = 0; i < count; i++) {
      const s = 0.22 * (1 - i / (count + 2)) + 0.05;
      this.fx.spawn({
        geo: FXGEO.sphere,
        color,
        k: 2.4,
        pos: [from.x + f * i * 0.25, from.y + Math.sin(i * 0.7) * 0.22, from.z],
        scale: s,
        scaleTo: s * 0.4,
        life,
        opacity: 0.95,
        opacityTo: 0,
        vel: [f * speed, 0, 0],
        delay: i * 0.02,
        easeOut: false,
      });
    }
    this.petal(from, 10, color, 2, 0.6);
  }

  private dart(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const dir = new THREE.Vector3(vx, vy, vz);
    const m = this.fx.spawn({ geo: FXGEO.beam, color: 0xe8f0ff, k: 3, pos: [x, y, z], scale: [0.03, 0.55, 0.03], life, vel: [vx, vy, vz] });
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  private beginRoleSkill(id: SkillId, mv: THREE.Vector2): void {
    const p = this.player;
    const f = p.facing;
    const timing: Partial<Record<SkillId, [number, number]>> = {
      longOut: [0.35, 0.2],
      backStab: [this.realTime - this.lastDodge < 1 ? 0.4 : 0.5, 0.3],
      sweep: [0.6, 0.35],
      plumBlossom: [0.85, 0.45],
      powerPunch: [0.9, 0.6],
      quake: [0.75, 0.45],
      whirl: [0.8 * this.mod(id, "dur"), 0.5],
      bell: [4 * this.mod(id, "dur"), 99],
      flyKnife: [0.35, 0.2],
      fanDarts: [0.45, 0.3],
      shadowStep: [0.7, 0.5],
      caltrops: [0.5, 0.3],
      flyingFan: [0.7, 0.4],
      sleeveHook: [0.5, 0.3],
      inkStorm: [3.2 * this.mod(id, "dur"), 99],
      fanWave: [0.4, 0.25],
    };
    const [dur, cancel] = timing[id] ?? [0.5, 0.3];
    const act = this.startAct("skill", dur, cancel, id);
    act.dir.set(f, 0, mv.y * 0.4);
    if (id === "backStab" && this.realTime - this.lastDodge < 1) act.n = 1;
    if (id === "bell") this.bellT = dur;
    if (id === "shadowStep") {
      this.stealthT = 3 * this.mod(id, "dur");
      p.rig.setOpacity(0.22);
      this.petal({ x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }, 16, 0x7a6a8a, 3, 0.8);
    }
    if (id === "caltrops") this.spawnTrap();
    sfx.swing(id === "powerPunch" || id === "quake");
  }

  private spawnTrap(): void {
    const p = this.player;
    const r = 2.2 * this.mod("caltrops", "size");
    const pos = p.pos.clone().setY(0);
    const dur = 6 * this.mod("caltrops", "dur");
    this.traps.push({ pos, r, t: 0, dur, tick: 0 });
    this.fx.spawn({ geo: FXGEO.disk, color: 0x6aa84a, k: 1.2, additive: false, pos: [pos.x, 0.04, pos.z], rot: [-Math.PI / 2, 0, 0], scale: r, life: dur, opacity: 0.35, opacityTo: 0.15 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      this.fx.spawn({ geo: FXGEO.slash, color: 0xc8d4e8, k: 2, pos: [pos.x + Math.cos(a) * d, 0.08, pos.z + Math.sin(a) * d], rot: [-Math.PI / 2, 0, Math.random() * Math.PI], scale: 0.35, life: dur, opacity: 0.9, opacityTo: 0.4 });
    }
  }

  private updateTraps(dt: number): void {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const tr = this.traps[i]!;
      tr.t += dt;
      tr.tick -= dt;
      if (tr.t >= tr.dur) {
        this.traps.splice(i, 1);
        continue;
      }
      const hurt = tr.tick <= 0;
      for (const e of this.enemies) {
        if (e.dead || Math.hypot(e.pos.x - tr.pos.x, e.pos.z - tr.pos.z) > tr.r + e.radius) continue;
        e.slow = Math.max(e.slow, 0.3);
        if (hurt) this.damageEnemy(e, { dmg: 0.5 * this.atk() * this.mod("caltrops", "dmg"), kb: 0, up: 0, hitstop: 0, element: null, heavy: false, color: 0xbfe6a0 }, tr.pos.x);
      }
      if (hurt) tr.tick = 0.5;
    }
  }

  private updateRoleSkill(act: PAct, dt: number, mv: THREE.Vector2, at: (t: number) => boolean): number {
    const p = this.player;
    const f = p.facing;
    const id = act.skill!;
    const atk = this.atk();
    const m = (k: "dmg" | "size" | "cd" | "dur") => this.mod(id, k);
    const from = () => new THREE.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z);
    const hitStop = 0.05;
    switch (id) {
      case "longOut": {
        p.vel.x = f * 1.5;
        if (at(0.08)) {
          const L = 9 * m("size");
          const el = this.has("longOut.fire") ? "fire" : null;
          const start = from();
          this.line(start, new THREE.Vector3(f, 0, 0), L, 0.09, 0x7affd8, 0.35);
          this.dragon(start, f, 0x7affd8, 0.45, 26);
          for (const dz of this.has("longOut.twin") ? [-0.7, 0.7] : [0]) {
            this.addHit({ follow: false, x: p.pos.x + f * (0.6 + L / 2), z: p.pos.z + dz, vx: 0, vz: 0, hw: L / 2, hd: 0.4, y0: p.pos.y + 0.5, y1: p.pos.y + 2, dur: 0.1, dmg: 2.2 * atk * m("dmg"), kb: 6, up: 0, hitstop: 0.06, heavy: true, element: el });
          }
          sfx.swing(true);
          this.director.kick(0.04, 0, 0.2);
        }
        return GRAVITY;
      }
      case "backStab": {
        if (act.t < 0.15) p.vel.x = -f * 5;
        else p.vel.x *= Math.max(0, 1 - dt * 10);
        if (at(0.18)) {
          const heavy = act.n ? 1.5 : 1;
          this.addHit({ follow: true, ox: 1.6, hw: 1.6, hd: 0.5, y0: 0.3, y1: 2, dur: 0.1, dmg: 2.4 * atk * m("dmg") * heavy, kb: 7, up: 0, hitstop: 0.07, heavy: true, element: null });
          this.line(from(), new THREE.Vector3(f, 0, 0), 3.2, 0.09, 0x7affd8, 0.3);
          this.dragon(from(), f, 0x7affd8, 0.3, 22, 8);
          if (this.has("backStab.wind")) this.aoe(p.pos, 2.4, atk * 0.8, null);
          sfx.swing(true);
        }
        return GRAVITY;
      }
      case "sweep": {
        p.vel.x *= Math.max(0, 1 - dt * 8);
        if (at(0.12) || at(0.36)) {
          const r = 3 * m("size");
          this.addHit({ follow: true, ox: 0, shape: "circle", r, y0: 0, y1: 2.4, dur: 0.1, dmg: 1.9 * atk * m("dmg"), kb: 4, up: this.has("sweep.knock") ? 9 : 5, hitstop: hitStop, heavy: true, element: null, radial: true });
          this.arcFx({ x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z + 0.3 }, r, 0xcfeeff, 0.35, 16, 2.4);
          this.petal({ x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }, 18, 0x7affd8, 6, 0.8);
          sfx.swing(true);
        }
        return GRAVITY;
      }
      case "plumBlossom": {
        p.vel.x *= Math.max(0, 1 - dt * 6);
        const n = this.has("plumBlossom.more") ? 5 : 3;
        for (let i = 0; i < n; i++) {
          if (!at(0.12 + i * 0.14)) continue;
          const x = p.pos.x + f * (1.8 + i * 0.5);
          const z = p.pos.z + (i % 2 ? 0.5 : -0.5);
          this.addHit({ follow: false, x, z, vx: 0, vz: 0, shape: "circle", r: 1.1, y0: p.pos.y, y1: p.pos.y + 2.2, dur: 0.06, dmg: 1.2 * atk * m("dmg"), kb: 3, up: 0, hitstop: 0.03, heavy: false, element: this.has("plumBlossom.frost") ? "ice" : null });
          this.petal({ x, y: p.pos.y + 1.4, z }, 14, 0xff6a8a, 4, 0.9);
          this.arcFx({ x, y: p.pos.y + 1.3, z }, 0.9, 0xff8aa0, 0.25, 0, 2.6, f > 0 ? 0 : 0);
          sfx.slashHit(false);
        }
        if (at(0.5 + (n - 3) * 0.14)) {
          const x = p.pos.x + f * 3;
          this.addHit({ follow: false, x, z: p.pos.z, vx: 0, vz: 0, shape: "circle", r: 2.4, y0: 0, y1: 2.5, dur: 0.06, dmg: 1.5 * atk * m("dmg"), kb: 6, up: 6, hitstop: 0.06, heavy: true, element: null, radial: true });
          this.groundRing(x, p.pos.z, 2.4, 0xff8aa0, 0.4);
        }
        return GRAVITY;
      }
      case "powerPunch": {
        p.vel.x = 0;
        p.vel.z = 0;
        if (act.t < 0.5) {
          // 蓄力：身后压下一座山影，地面的金光向拳头聚拢
          if (Math.random() < dt * 40) this.arcFx({ x: p.pos.x - f * 1.6, y: p.pos.y + 1.2, z: p.pos.z - 0.6 }, 1.8 + Math.random() * 0.6, 0xe0b050, 0.25, 6, 1.4);
        }
        if (at(0.5)) {
          const x = p.pos.x + f * 1.4;
          this.addHit({ follow: true, ox: 1.2, hw: 1.2, hd: 0.7, y0: 0, y1: 2.3, dur: 0.08, dmg: 3.2 * atk * m("dmg"), kb: 9, up: 4, hitstop: 0.09, heavy: true, element: null });
          this.groundRing(x, p.pos.z, 2.8 * m("size"), 0xffc83a, 0.45);
          this.aoe(this.tmp.set(x, 0, p.pos.z).clone(), 2.8 * m("size"), 1.2 * atk, null);
          this.dust(x, p.pos.z, 16);
          this.director.shake(0.35);
          this.hooks.onFlash("white");
          sfx.blast();
          vibrate(50);
        }
        return 0;
      }
      case "quake": {
        p.vel.x *= Math.max(0, 1 - dt * 8);
        if (at(0.3)) {
          const r = 3.6 * m("size");
          for (let i = 0; i < 3; i++) this.groundRing(p.pos.x, p.pos.z, r * (0.4 + i * 0.3), 0xffc83a, 0.4 + i * 0.1);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            this.fx.spawn({ geo: FXGEO.slash, color: 0xffa040, k: 2.4, pos: [p.pos.x + Math.cos(a) * 1.4, 0.06, p.pos.z + Math.sin(a) * 1.4], rot: [-Math.PI / 2, 0, a], scale: [1.4, 0.12, 1], scaleTo: [2.2, 0.06, 1], life: 1.2 });
            if (this.has("quake.crack")) this.patches.push({ pos: new THREE.Vector3(p.pos.x + Math.cos(a) * 2, 0, p.pos.z + Math.sin(a) * 2), t: 0, tick: 0 });
          }
          this.aoe(p.pos.clone(), r, 2.4 * atk * m("dmg"), null);
          this.director.shake(0.4);
          this.dust(p.pos.x, p.pos.z, 20);
          sfx.blast();
        }
        return GRAVITY;
      }
      case "whirl": {
        p.vel.x = mv.x * 1.5;
        if (act.t < 0.1 || Math.floor(act.t / 0.18) !== Math.floor((act.t - dt) / 0.18)) {
          const r = 2.2 * m("size");
          this.arcFx({ x: p.pos.x, y: p.pos.y + 0.8, z: p.pos.z }, r, 0xffc83a, 0.2, 18, 2.2);
        }
        if (Math.floor(act.t / 0.25) !== Math.floor((act.t - dt) / 0.25)) {
          this.addHit({ follow: true, ox: 0, shape: "circle", r: 2.2 * m("size"), y0: 0, y1: 1.8, dur: 0.1, dmg: 0.9 * atk * m("dmg"), kb: 3, up: this.has("whirl.knock") ? 6 : 0, hitstop: 0.02, heavy: false, element: null, radial: true });
        }
        return GRAVITY;
      }
      case "bell": {
        p.vel.x *= Math.max(0, 1 - dt * 8);
        if (Math.floor(act.t / 0.2) !== Math.floor((act.t - dt) / 0.2)) {
          this.fx.spawn({ geo: FXGEO.ring, color: 0xffc83a, k: 2, pos: [p.pos.x, p.pos.y + 1.1, p.pos.z], rot: [-Math.PI / 2, 0, 0], scale: 0.8, scaleTo: 1.4, life: 0.4, opacity: 0.9, opacityTo: 0 });
        }
        if (act.t >= act.dur && !act.landed) {
          act.landed = true;
          if (this.has("bell.heal")) {
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.2);
            this.numbers.show(this.tmp.set(p.pos.x, p.pos.y + 2, p.pos.z), Math.round(p.maxHp * 0.2), "heal");
          }
        }
        return GRAVITY;
      }
      case "flyKnife": {
        p.vel.x = f * 1;
        if (at(0.1)) {
          const n = this.has("flyKnife.triple") ? 3 : 1;
          const fire = this.has("flyKnife.fire") ? "fire" : null;
          for (let i = 0; i < n; i++) {
            const a = (i - (n - 1) / 2) * 0.16;
            const vx = f * 24 * Math.cos(a);
            const vz = 24 * Math.sin(a) * 0.5;
            const x = p.pos.x + f * 0.8;
            const y = p.pos.y + 1.3;
            this.dart(x, y, p.pos.z, vx, 0, vz, 0.9);
            this.addHit({ follow: false, x, z: p.pos.z, vx, vz, hw: 0.4, hd: 0.3, y0: y - 0.6, y1: y + 0.6, dur: 0.9, dmg: 1.1 * atk * m("dmg"), kb: 4, up: 0, hitstop: 0.02, heavy: false, element: fire });
          }
          sfx.swing();
        }
        return GRAVITY * 0.25;
      }
      case "fanDarts": {
        p.vel.x *= Math.max(0, 1 - dt * 10);
        if (at(0.15)) {
          const n = this.has("fanDarts.more") ? 11 : 7;
          const spread = 0.7 * m("size");
          const burn = this.has("fanDarts.poison") ? "fire" : null;
          for (let i = 0; i < n; i++) {
            const a = (i / (n - 1) - 0.5) * 2 * spread;
            const vx = f * 22 * Math.cos(a);
            const vz = 22 * Math.sin(a);
            const x = p.pos.x + f * 0.8;
            const y = p.pos.y + 1.4;
            this.dart(x, y, p.pos.z, vx, 0, vz, 0.7);
            this.addHit({ follow: false, x, z: p.pos.z, vx, vz, hw: 0.35, hd: 0.35, y0: y - 0.7, y1: y + 0.7, dur: 0.6, dmg: 0.9 * atk * m("dmg"), kb: 2, up: 0, hitstop: 0.01, heavy: false, element: burn, burnMul: 0.6 });
          }
          this.petal({ x: p.pos.x + f * 2, y: p.pos.y + 1.4, z: p.pos.z }, 20, 0xf4e6b0, 6, 0.6);
        }
        return GRAVITY;
      }
      case "shadowStep": {
        p.vel.x = 0;
        p.vel.z = 0;
        if (at(0.22)) {
          // 找最近的敌人，瞬移到它背后
          let best: Enemy | null = null;
          let bd = Infinity;
          for (const e of this.enemies) {
            if (e.dead) continue;
            const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
            if (d < bd) {
              bd = d;
              best = e;
            }
          }
          const old = p.pos.clone();
          if (best) {
            p.pos.x = clamp(best.pos.x - best.facing * 1.3, 0.6, this.roomW - 0.6);
            p.pos.z = best.pos.z;
            p.facing = sign(best.pos.x - p.pos.x) || p.facing;
          } else {
            p.pos.x = clamp(p.pos.x + f * 4, 0.6, this.roomW - 0.6);
          }
          this.petal({ x: old.x, y: 1.2, z: old.z }, 22, 0x7a6a8a, 4, 0.9);
          this.petal({ x: p.pos.x, y: 1.2, z: p.pos.z }, 22, 0x9a8aa8, 4, 0.9);
          this.ink(old.x, old.z, 1.4, 1.2);
          this.addHit({ follow: true, ox: 0, shape: "circle", r: 1.8, y0: 0, y1: 2.4, dur: 0.08, dmg: 2.6 * atk * m("dmg"), kb: 6, up: 4, hitstop: 0.06, heavy: true, element: null, radial: true });
          if (this.has("shadowStep.smoke")) this.ink(p.pos.x, p.pos.z, 2, 1.5);
          sfx.swing(true);
        }
        return 0;
      }
      case "flyingFan": {
        p.vel.x *= Math.max(0, 1 - dt * 6);
        if (at(0.12)) {
          const L = 9 * m("size");
          const lanes = this.has("flyingFan.twin") ? [-0.9, 0.9] : [0];
          for (const dz of lanes) {
            const z = p.pos.z + dz;
            const y = p.pos.y + 1.4;
            this.addHit({ follow: false, x: p.pos.x + f * 0.8, z, vx: f * L / 0.5, vz: 0, hw: 0.7, hd: 0.5, y0: y - 0.8, y1: y + 0.8, dur: 0.5, dmg: 1.4 * atk * m("dmg"), kb: 4, up: 0, hitstop: 0.02, heavy: false, element: null });
            this.addHit({ follow: false, x: p.pos.x + f * L, z, vx: -f * L / 0.5, vz: 0, hw: 0.7, hd: 0.5, y0: y - 0.8, y1: y + 0.8, dur: 0.5, dmg: 1.4 * atk * m("dmg"), kb: 4, up: 0, hitstop: 0.02, heavy: false, element: null, delay: 0.5 });
            this.arcFx({ x: p.pos.x + f * 0.8, y, z }, 0.9, 0xfff4e0, 0.5, 26, 2.4);
          }
          sfx.swing();
        }
        if (act.t > 0.12 && Math.random() < dt * 30) this.petal({ x: p.pos.x + f * (act.t * 6), y: p.pos.y + 1.4, z: p.pos.z }, 3, 0xffb7c5, 2, 0.6);
        return GRAVITY;
      }
      case "sleeveHook": {
        p.vel.x = 0;
        p.vel.z = 0;
        if (at(0.15)) {
          const reach = 7 * m("size");
          const pull = this.has("sleeveHook.stun") ? 4 : 0;
          for (const e of [...this.enemies]) {
            if (e.dead || e.boss) continue;
            const d = (e.pos.x - p.pos.x) * f;
            if (d < 0.5 || d > reach || Math.abs(e.pos.z - p.pos.z) > 2.2) continue;
            e.pos.x = p.pos.x + f * 1.4;
            this.damageEnemy(e, { dmg: 1.0 * atk * m("dmg"), kb: 1, up: pull, hitstop: 0.02, element: null, heavy: false }, p.pos.x);
          }
          // 水袖：一道白色的长带从手里飞出去
          for (let i = 0; i < 8; i++) {
            this.fx.spawn({ geo: FXGEO.plane, color: 0xfff4e0, k: 1.6, pos: [p.pos.x + f * (1 + i * 0.6), p.pos.y + 1.6 + Math.sin(i) * 0.3, p.pos.z], rot: [0, f > 0 ? 0 : Math.PI, 0], scale: [1.2, 0.18, 1], scaleTo: [1.4, 0.1, 1], life: 0.6, delay: i * 0.02, vel: [f * 6, 0, 0] });
          }
          this.petal({ x: p.pos.x + f * 4, y: p.pos.y + 1.5, z: p.pos.z }, 16, 0xf4e6b0, 5, 0.8);
          sfx.swing();
        }
        return GRAVITY;
      }
      case "inkStorm": {
        p.vel.x = mv.x * 1.2;
        p.vel.z = mv.y * 1.2;
        const every = 0.25;
        if (act.t >= act.n * every) {
          act.n++;
          const r = 3.2 * m("size");
          this.aoe(p.pos.clone(), r, 0.6 * atk * m("dmg"), null);
          this.arcFx({ x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z }, r, 0x0a0a12, 0.5, 14, 1, Math.random() * 6);
          this.ink(p.pos.x + rand(-r * 0.6, r * 0.6), p.pos.z + rand(-1, 1), rand(0.6, 1.2), 1.6);
          if (this.has("inkStorm.ink")) this.patches.push({ pos: new THREE.Vector3(p.pos.x, 0, p.pos.z), t: 0, tick: 0 });
          this.petal({ x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z }, 14, 0xe8e0d0, 4, 1.2);
        }
        return GRAVITY;
      }
      case "fanWave": {
        p.vel.x *= Math.max(0, 1 - dt * 8);
        if (at(0.14)) {
          const L = 4 * m("size");
          this.addHit({ follow: true, ox: 2.4, hw: L / 2, hd: 1.4, y0: 0, y1: 2.6, dur: 0.1, dmg: 1.3 * atk * m("dmg"), kb: 8, up: 2, hitstop: 0.03, heavy: true, element: null });
          this.arcFx({ x: p.pos.x + f * 2.4, y: p.pos.y + 1.3, z: p.pos.z }, 1.8 * m("size"), 0xf4f8ff, 0.3, 0, 2.2);
          this.petal({ x: p.pos.x + f * 2.5, y: p.pos.y + 1.2, z: p.pos.z }, 12, 0xe8f0ff, 6, 0.6);
          sfx.swing(true);
        }
        return GRAVITY;
      }
      default:
        return GRAVITY;
    }
  }

  private roleSkillPose(act: PAct, k: number): Pose {
    switch (act.skill!) {
      case "longOut":
        return keyed(k, [
          [0, pose({ shR: 2.6, elR: 0.6, wpn: 0.3, lean: -0.1 })],
          [0.4, pose({ shR: 1.5, elR: 0, wpn: 0, lean: 0.5, hipR: 0.8, knR: -0.5, hipL: -0.7, knL: -0.2, rootY: -0.2, shL: 0.2 })],
          [1, pose({ shR: 1.45, elR: 0, wpn: 0, lean: 0.45, hipR: 0.7, knR: -0.5, hipL: -0.6, rootY: -0.2, shL: 0.3 })],
        ]);
      case "backStab":
        return keyed(k, [
          [0, pose({ shR: 1.2, elR: 0.2, wpn: 0.1, lean: -0.3, hipR: -0.2, hipL: 0.5 })],
          [0.35, pose({ shR: 1.5, elR: 0, wpn: 0, lean: 0.5, hipR: 0.8, knR: -0.5, hipL: -0.7, rootY: -0.2 })],
          [1, pose({ shR: 1.4, elR: 0.1, lean: 0.35, rootY: -0.12 })],
        ]);
      case "sweep":
        return pose({ spinY: Math.min(1, act.t * 4) * Math.PI * 2 * (act.t > 0.12 ? 1 : 0), shR: 1.6, elR: 0, wpn: 0, shL: 1.2, elL: 0.2, lean: 0.15, rootY: -0.1 }, STANCE);
      case "plumBlossom":
        return keyed(k, [
          [0, pose({ shR: 2.5, elR: 0.6, wpn: 0.2 })],
          [0.5, pose({ shR: 1.5, elR: 0, lean: 0.45, hipR: 0.7, knR: -0.4, hipL: -0.5 })],
          [1, pose({ shR: 2.0, elR: 0.3, lean: 0.1 })],
        ]);
      case "powerPunch":
        return keyed(k, [
          [0, pose({ shR: 2.9, elR: 2.2, wpn: 0, lean: -0.25, rootY: -0.2, hipL: 0.2, knL: -0.6 })],
          [0.55, pose({ shR: 0.2, elR: 0.05, lean: 0.6, rootY: -0.25, hipR: 0.9, knR: -0.6, hipL: -0.6, knL: -0.3, shL: -0.5, elL: 1.5 })],
          [1, pose({ shR: 0.3, elR: 0.1, lean: 0.45, rootY: -0.2, hipR: 0.7, knR: -0.5, hipL: -0.5 })],
        ]);
      case "quake":
        return keyed(k, [
          [0, pose({ shR: 2.8, elR: 0.1, shL: 2.8, elL: 0.1, lean: -0.3 })],
          [0.4, pose({ shR: 0.5, elR: 0.1, shL: 0.5, elL: 0.1, lean: 0.8, rootY: -0.45, hipR: 1.0, knR: -0.9, hipL: -0.5 })],
          [1, pose({ rootY: -0.2, shR: 0.5, shL: 0.5, lean: 0.3 })],
        ]);
      case "whirl":
        return pose({ spinY: act.t * 14, hipR: 1.3, knR: -0.4, hipL: -0.4, knL: -0.2, shR: 1.4, shL: 1.4, elL: 0.8, elR: 0.8, lean: 0.1 });
      case "bell":
        return pose({ shL: 1.0, elL: 2.2, shR: 1.0, elR: 2.2, lean: 0.05, rootY: -0.05 });
      case "flyKnife":
        return keyed(k, [
          [0, pose({ shR: 2.4, elR: 0.4, wpn: 0.2, lean: -0.2 })],
          [0.5, pose({ shR: 0.4, elR: 0.1, lean: 0.35, wpn: 0.2 })],
          [1, pose({ shR: 0.8, elR: 0.2, lean: 0.25 })],
        ]);
      case "fanDarts":
        return keyed(k, [
          [0, pose({ shL: 2.6, elL: 0.3, shR: 2.6, elR: 0.3, lean: -0.1 })],
          [0.5, pose({ shL: 0.5, elL: 0.2, shR: 0.4, elR: 0.2, lean: 0.25 })],
          [1, pose({ shL: 0.7, shR: 0.7, lean: 0.2 })],
        ]);
      case "shadowStep":
        return keyed(k, [
          [0, DODGE],
          [0.4, pose({ lean: -0.3, rootY: -0.2, hipL: -0.5, knL: -0.9, hipR: 0.8, knR: -0.7, shL: 1.5, shR: 1.5 })],
          [1, STANCE],
        ]);
      case "caltrops":
        return keyed(k, [
          [0, P.crouch],
          [0.7, pose({ rootY: -0.5, lean: 0.6, hipR: 1.2, knR: -1.2, shR: 1.3, elR: 1.4 }, P.crouch)],
          [1, STANCE],
        ]);
      case "flyingFan":
        return keyed(k, [
          [0, pose({ shR: 2.7, elR: 0.2, wpn: 0.2 })],
          [0.35, pose({ shR: 1.2, elR: 0.1, lean: 0.4, wpn: 0.2 })],
          [1, pose({ shR: 1.0, elR: 0.3, lean: 0.2 })],
        ]);
      case "sleeveHook":
        return keyed(k, [
          [0, pose({ shR: 2.8, elR: 0.1, wpn: 0.2 })],
          [0.4, pose({ shR: 0.9, elR: 0.3, lean: 0.35, wpn: 0.2 })],
          [1, pose({ shR: 1.1, elR: 0.6, lean: 0.2 })],
        ]);
      case "inkStorm":
        return pose({ spinY: act.t * 6, shR: 1.6, elR: 0.1, shL: 1.6, elL: 0.1, lean: 0.1, wpn: 0.1 });
      case "fanWave":
        return keyed(k, [
          [0, pose({ shR: 2.9, elR: 0.1, wpn: 0.1, lean: -0.2 })],
          [0.4, pose({ shR: 0.5, elR: 0.1, wpn: 0.1, lean: 0.4, hipR: 0.6, knR: -0.4, hipL: -0.5 })],
          [1, pose({ shR: 0.8, elR: 0.2, lean: 0.25 })],
        ]);
      default:
        return STANCE;
    }
  }

  private awakenPose(): Pose {
    switch (this.role) {
      case "spear":
        return pose({ shR: 3.14, elR: 0.05, wpn: 0.1, lean: -0.1, shL: 0.8 });
      case "fist":
        return pose({ shR: 0.8, elR: 1.6, shL: 0.5, elL: 1.5, lean: 0.25, rootY: -0.2 });
      case "dart":
        return pose({ shR: 3.0, elR: 0.6, shL: 2.8, elL: 0.4, lean: -0.1 });
      case "fan":
        return pose({ shR: 2.2, elR: 0, wpn: 0.2, shL: 2.0, elL: 0.1, lean: -0.1 });
      default:
        return AWAKEN;
    }
  }

  private roleScript(anchor: THREE.Vector3, f: number, plan: AwakenPlan, onEnd: () => void): void {
    this.runScriptNow({
      t: 0,
      end: plan.end,
      events: plan.events.map((e) => ({ at: e.at, fn: e.fn, done: false })),
      onEnd: () => {
        this.hooks.onTint(null);
        onEnd();
      },
    });
    this.director.play(anchor, f, plan.shots);
  }

  private startRoleAwaken(): void {
    const p = this.player;
    const f = p.facing;
    const anchor = p.pos.clone();
    const hemi0 = this.hemi.intensity;
    this.startAct("awaken", 99, 99);
    p.invuln = 99;
    this.hits = this.hits.filter((h) => !h.follow);
    sfx.awaken();
    vibrate(60);
    const cfg = ROLES[this.role];
    this.hooks.onTint(cfg.tint);
    this.hooks.onBanner({ kind: "clear", text: cfg.awaken.name });
    const plan =
      this.role === "spear" ? this.planSpear(anchor, f) : this.role === "fist" ? this.planFist(anchor, f) : this.role === "dart" ? this.planDart(anchor, f) : this.planFan(anchor, f);
    this.roleScript(anchor, f, plan, () => {
      if (this.player.act?.kind === "awaken") this.player.act = null;
      this.player.invuln = 0.8;
      this.hemi.intensity = hemi0;
    });
  }

  /** 龙啸九天：青龙从身后游到前方，咬中路上的敌人，最后枪尖刺穿画面 */
  private planSpear(anchor: THREE.Vector3, f: number): AwakenPlan {
    const p = this.player;
    const color = 0x7affd8;
    const inLine = (e: Enemy, reach: number) => {
      const d = (e.pos.x - p.pos.x) * f;
      return !e.dead && !e.boss && d > -3 && d < reach && Math.abs(e.pos.z - p.pos.z) < 5;
    };
    return {
      end: 3.6,
      shots: [
        { dur: 0.5, pos: [-1.2, 0.9, 3.2], look: [1, 1.2, 0], fov: 36 },
        { dur: 0.9, pos: [-6, 4, 9], toPos: [-3, 3, 11], look: [2, 2.4, 0], fov: 44 },
        { dur: 1.2, pos: [6, 5.5, 13], toPos: [11, 4, 12], look: [6, 2.6, 0], fov: 48 },
        { dur: 1.0, pos: [1.5, 1.4, 4.6], toPos: [0.8, 1.3, 3.4], look: [4, 1.2, 0], fov: 34 },
      ],
      events: [
        {
          at: 0.3,
          fn: () => {
            this.sparks.emit(this.tmp.set(p.pos.x + f, 1.4, p.pos.z), 80, color, { speed: 10, life: 0.7 });
            this.petal({ x: p.pos.x + f, y: 1.4, z: p.pos.z }, 30, color, 6, 1.2);
            this.arcFx({ x: p.pos.x + f * 0.8, y: 1.4, z: p.pos.z }, 2.4, color, 0.6, 0, 2.8);
          },
        },
        {
          at: 0.6,
          fn: () => {
            // 青龙从身后游出，穿过整个画面
            this.dragon(new THREE.Vector3(p.pos.x - 6 * f, 3.4, 0.4), f, color, 2.6, 16, 22);
          },
        },
        {
          at: 1.2,
          fn: () => {
            for (const e of [...this.enemies]) {
              if (!inLine(e, 18)) continue;
              this.damageEnemy(e, { dmg: 3.5 * this.atk(), kb: 6, up: 8, hitstop: 0.05, element: null, heavy: true, radial: true, color }, p.pos.x);
              this.petal({ x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z }, 16, color, 6, 0.9);
            }
            this.director.shake(0.3);
            sfx.slashHit(true);
          },
        },
        {
          at: 2.4,
          fn: () => {
            const x = p.pos.x + f * 4;
            this.explosion(x, p.pos.z, 3, color);
            this.line(this.tmp.set(x - f * 6, 1.3, p.pos.z).clone(), new THREE.Vector3(f, 0, 0), 12, 0.12, 0xdffcff, 0.5);
            this.aoe(this.tmp.set(x, 0, p.pos.z).clone(), 3, 6 * this.atk(), null);
            this.director.shake(1);
            this.hooks.onFlash("white");
            sfx.explode();
            vibrate(120);
          },
        },
      ],
    };
  }

  /** 罗汉伏魔：金身佛影浮现，金拳落下，震倒周围所有敌人 */
  private planFist(anchor: THREE.Vector3, f: number): AwakenPlan {
    const p = this.player;
    const gold = 0xffc83a;
    const landX = p.pos.x + f * 2.5;
    return {
      end: 3.6,
      shots: [
        { dur: 0.6, pos: [0.5, 1.8, 3.4], look: [0, 1.8, 0], fov: 40 },
        { dur: 0.9, pos: [-4, 0.8, 7], toPos: [-6, 0.9, 8], look: [2, 1.5, 0], fov: 34 },
        { dur: 1.2, pos: [2.5, 8, 6], toPos: [2.5, 5, 6], look: [2, 0, 0], fov: 42 },
        { dur: 0.9, pos: [4, 1.2, 6], toPos: [3, 1.2, 6], look: [0, 1.6, 0], fov: 30 },
      ],
      events: [
        {
          at: 0.2,
          fn: () => {
            this.fx.spawn({ geo: FXGEO.ring, color: gold, k: 0.9, pos: [p.pos.x - f * 1.2, 4.6, -6], scale: 2.2, scaleTo: 2.5, life: 3.4, opacity: 0.4, opacityTo: 0 });
            this.fx.spawn({ geo: FXGEO.sphere, color: gold, k: 0.9, additive: false, pos: [p.pos.x - f * 3, 7.5, -7], scale: 0.9, life: 3.4, opacity: 0.35, opacityTo: 0.1 });
            this.fx.spawn({ geo: FXGEO.sphere, color: gold, k: 0.9, additive: false, pos: [p.pos.x - f * 3, 4.6, -7], scale: [1.8, 2.6, 1], life: 3.4, opacity: 0.25, opacityTo: 0.08 });
          },
        },
        { at: 0.3, fn: () => this.sparks.emit(this.tmp.set(p.pos.x, 1.4, p.pos.z), 60, gold, { speed: 6, life: 0.6, up: 3 }) },
        {
          at: 0.6,
          fn: () => {
            // 金拳从高处落下，身后留下残影
            for (let i = 0; i < 4; i++) {
              this.fx.spawn({ geo: FXGEO.sphere, color: gold, k: 2.0, pos: [landX, 6.5 + i * 0.6, -1.5], scale: 0.55 - i * 0.05, life: 0.9, opacity: 0.8 - i * 0.2, opacityTo: 0, vel: [0, -6, 0], delay: i * 0.05 });
            }
          },
        },
        {
          at: 1.5,
          fn: () => {
            this.groundRing(landX, p.pos.z, 3.2, gold, 0.6);
            this.groundRing(landX, p.pos.z, 1.8, 0xffffff, 0.4);
            this.aoe(this.tmp.set(landX, 0, p.pos.z).clone(), 4.5, 4 * this.atk(), null);
            for (const e of [...this.enemies]) {
              if (e.dead || e.boss) continue;
              this.launch(e, sign(e.pos.x - landX) * 3 + f * 0.5, 7);
            }
            this.sparks.emit(this.tmp.set(landX, 0.4, p.pos.z), 140, gold, { speed: 12, life: 0.9, up: 4, gravity: 10 });
            this.dust(landX, p.pos.z, 30);
            this.director.shake(1.2);
            sfx.blast();
            vibrate(150);
          },
        },
        { at: 2.6, fn: () => this.petal({ x: p.pos.x, y: 1.2, z: p.pos.z }, 80, 0xffd27a, 8, 1.4) },
      ],
    };
  }

  /** 千机暗雨：满屏暗器从天而降，每一枚落地都会伤到附近的敌人 */
  private planDart(anchor: THREE.Vector3, f: number): AwakenPlan {
    const p = this.player;
    const events: AwakenPlan["events"] = [];
    for (let k = 0; k < 46; k++) {
      const t = 0.5 + k * 0.05;
      const x = p.pos.x + rand(-9, 12);
      const z = rand(-2.6, 2.6);
      events.push({ at: t, fn: () => this.dart(x, 14, z, 0, -24, 0, 0.55) });
      events.push({
        at: t + 0.55,
        fn: () => {
          for (const e of [...this.enemies]) {
            if (e.dead || e.boss || Math.hypot(e.pos.x - x, e.pos.z - z) > 1.2) continue;
            this.damageEnemy(e, { dmg: 1.2 * this.atk(), kb: 2, up: 0, hitstop: 0, element: null, heavy: false, color: 0xe8f0ff }, x);
          }
          this.sparks.emit(this.tmp.set(x, 0.2, z), 6, 0xe8f0ff, { speed: 3, life: 0.3 });
          if (k % 6 === 0) {
            this.fx.spawn({ geo: FXGEO.disk, color: 0x9adf6a, k: 1, additive: false, pos: [x, 0.05, z], rot: [-Math.PI / 2, 0, 0], scale: 1.6, life: 2.2, opacity: 0.35, opacityTo: 0 });
          }
        },
      });
    }
    events.push({
      at: 3.0,
      fn: () => {
        this.groundRing(p.pos.x, p.pos.z, 4, 0xe8f0ff, 0.5);
        this.aoe(this.tmp.set(p.pos.x, 0, p.pos.z).clone(), 3, 2 * this.atk(), null);
        this.hooks.onFlash("white");
        sfx.zap();
      },
    });
    return {
      end: 3.6,
      shots: [
        { dur: 0.8, pos: [-2, 6, 6], toPos: [-2, 8, 6], look: [2, 0, 0], fov: 46 },
        { dur: 1.0, pos: [0.5, 10, 3], toPos: [4, 11, 5], look: [3, 0, 0], fov: 50 },
        { dur: 1.0, pos: [4, 1.2, 10], toPos: [2, 1.6, 10], look: [4, 1.2, 0], fov: 36 },
        { dur: 0.8, pos: [-5, 2, 6], toPos: [-3, 2.5, 6], look: [1, 1, 0], fov: 38 },
      ],
      events,
    };
  }

  /** 满月风华：扇子展开成一轮满月，花瓣满天，月光照到的敌人被定住 */
  private planFan(anchor: THREE.Vector3, f: number): AwakenPlan {
    const p = this.player;
    const color = 0xfff4e0;
    const events: AwakenPlan["events"] = [];
    for (let i = 0; i < 7; i++) {
      events.push({
        at: 0.2 + i * 0.08,
        fn: () => {
          const a = (i / 7) * Math.PI * 2;
          this.fx.spawn({ geo: FXGEO.arc, color, k: 0.9, pos: [p.pos.x + Math.cos(a) * 1.8, p.pos.y + 1.6 + Math.sin(a) * 1.2, p.pos.z - 2.5], rot: [0, 0, a], scale: 1.2, life: 2.6, opacity: 0.5, opacityTo: 0.1, spin: [0, 0, 3], additive: false });
        },
      });
    }
    events.push({
      at: 0.7,
      fn: () => {
        this.fx.spawn({ geo: FXGEO.disk, color: 0xf4f8ff, k: 0.9, pos: [p.pos.x + f * 5, 6.2, -6], scale: 2.2, life: 3.6, opacity: 0.8, opacityTo: 0.4 });
        this.fx.spawn({ geo: FXGEO.ring, color: 0xf4f8ff, k: 1.2, pos: [p.pos.x + f * 5, 6.2, -5.9], scale: 4, scaleTo: 4.6, life: 3.6, opacity: 0.6, opacityTo: 0 });
      },
    });
    for (let t = 0.8; t < 3.2; t += 0.25) {
      events.push({ at: t, fn: () => this.petal({ x: p.pos.x + rand(-4, 4), y: rand(1, 4), z: rand(-2, 2) }, 14, 0xffc8d8, 3, 1.4) });
    }
    events.push({
      at: 1.6,
      fn: () => {
        for (const e of [...this.enemies]) {
          if (e.dead || e.boss || Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) > 10) continue;
          this.damageEnemy(e, { dmg: 1.5 * this.atk(), kb: 0, up: 0, hitstop: 0, element: null, heavy: false, color }, p.pos.x);
          this.freezeEnemy(e, 2);
          this.sparks.emit(this.tmp.set(e.pos.x, e.pos.y + 1, e.pos.z), 14, 0xcff4ff, { speed: 4, life: 0.5 });
        }
        sfx.freeze();
      },
    });
    events.push({
      at: 2.7,
      fn: () => {
        this.aoe(this.tmp.set(p.pos.x + f * 3, 0, p.pos.z).clone(), 6, 2 * this.atk(), null);
        this.groundRing(p.pos.x, p.pos.z, 3.5, color, 0.6);
        this.director.shake(0.6);
        sfx.blast();
      },
    });
    return {
      end: 3.6,
      shots: [
        { dur: 0.9, pos: [-2.5, 1.6, 3], toPos: [-1.8, 1.8, 2.6], look: [1.4, 1.5, 0], fov: 40 },
        { dur: 1.0, pos: [-5, 2.6, 10], toPos: [-4, 4.2, 12], look: [2, 3.6, -4], fov: 44 },
        { dur: 0.9, pos: [6, 6, 8], toPos: [3, 3.4, 9], look: [2, 4, -4], fov: 42 },
        { dur: 0.8, pos: [0, 1.2, 4], toPos: [-2, 1.1, 4], look: [1, 1.2, 0], fov: 40 },
      ],
      events,
    };
  }

  /** 当前持有的技能和强化（暂停菜单里的技能说明用） */
  loadout(): { id: SkillId; level: number; upgrades: string[] }[] {
    return this.slots.map((id) => ({ id, level: this.levels[id] ?? 0, upgrades: SKILLS[id].upgrades.filter((u) => this.upgrades.has(u.id)).map((u) => u.name) }));
  }
}
