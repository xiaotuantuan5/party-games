import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { sfx, vibrate } from "../sound";

/**
 * 星际穿梭：单人 3D 太空射击，纯前端运行。
 * 飞船在 z = 0 的平面上移动，陨石、敌机、子弹从远处（-z）飞过来。
 * 发光的东西用颜色值大于 1 的材质，配合辉光后期（bloom）产生霓虹效果；手机太卡时自动关掉辉光。
 */

export type SpacePower = "spread" | "rapid" | "shield";
type Drop = SpacePower | "heal";

export interface SpaceHud {
  score: number;
  hp: number;
  maxHp: number;
  wave: number;
  /** 连击倍率 */
  mult: number;
  boss: { hp: number; max: number } | null;
  powers: { kind: SpacePower; left: number; total: number }[];
}

export interface SpaceResult {
  score: number;
  wave: number;
  kills: number;
  seconds: number;
}

export interface SpaceBanner {
  kind: "boss" | "info" | "power";
  text: string;
}

export interface SpaceHooks {
  onHud: (hud: SpaceHud) => void;
  onBanner: (banner: SpaceBanner) => void;
  onGameOver: (result: SpaceResult) => void;
}

const MAX_HP = 5;
const POWER_TIME: Record<SpacePower, number> = { spread: 10, rapid: 8, shield: 8 };
/** 每一波打多久出现 Boss（秒） */
const BOSS_EVERY = 45;
const SPAWN_Z = -140;
const DESPAWN_Z = 12;
const CAMERA_DIST = 9;
const SHOT_SPEED = 95;
/** 连击：两次击杀间隔不超过这个时间（秒） */
const COMBO_WINDOW = 2;

const DROP_INFO: Record<Drop, { color: number; name: string }> = {
  heal: { color: 0x3cff8a, name: "🟢 修复装甲 +1" },
  shield: { color: 0x4aa8ff, name: "🔵 能量护盾" },
  spread: { color: 0xffd23c, name: "🟡 三向散射" },
  rapid: { color: 0xc86bff, name: "🟣 急速射击" },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pickOne = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;

/** 颜色值乘一个大于 1 的系数，辉光后期会让它发光 */
const glow = (color: number, intensity: number) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });

/** 用三角函数做的伪噪声把二十面体捏成坑坑洼洼的陨石。同一位置算出的值相同，所以面不会裂开。 */
function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) * Math.sin(v.z * 3.7 + seed * 0.7) * 0.3 +
      Math.sin(v.x * 7 + v.y * 5 + seed) * 0.07;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** 爆炸火花：一个大的粒子缓冲区循环使用，加法混合，颜色变黑就等于消失 */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private next = 0;

  constructor(private n: number) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.32,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.clear();
  }

  emit(at: THREE.Vector3, count: number, color: THREE.Color, speed: number, life: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      // 球面上均匀取一个方向
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.25 + Math.random() * 0.75);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([r * Math.cos(th) * s, r * Math.sin(th) * s, u * s], i * 3);
      const b = 0.6 + Math.random() * 0.8;
      this.base.set([color.r * b, color.g * b, color.b * b], i * 3);
      this.maxLife[i] = this.life[i] = life * (0.5 + Math.random() * 0.5);
    }
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - 1.8 * dt);
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
      for (let c = 0; c < 3; c++) {
        this.pos[i3 + c] = this.pos[i3 + c]! + this.vel[i3 + c]! * dt;
        this.vel[i3 + c] = this.vel[i3 + c]! * drag;
        this.col[i3 + c] = this.base[i3 + c]! * k;
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
}

/** 星空：每颗星是一条短线段，速度越快拉得越长，就有了“跃迁”的感觉 */
class Stars {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private xyz: Float32Array;

  constructor(private n: number) {
    this.pos = new Float32Array(n * 6);
    this.xyz = new Float32Array(n * 3);
    const col = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      this.respawn(i, rand(SPAWN_Z - 80, DESPAWN_Z));
      // 大部分偏白蓝，少数偏粉
      const c = Math.random() < 0.15 ? [1.6, 0.6, 1.4] : [0.8, 0.9, 1.5];
      const head = 0.6 + Math.random() * 0.9;
      col.set([c[0]! * head, c[1]! * head, c[2]! * head, 0, 0, 0], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
    );
    this.lines.frustumCulled = false;
  }

  private respawn(i: number, z: number): void {
    // 中间留出一块，不让星星直接糊在飞船上
    let x: number;
    let y: number;
    do {
      x = rand(-55, 55);
      y = rand(-35, 35);
    } while (Math.abs(x) < 5 && Math.abs(y) < 4);
    this.xyz.set([x, y, z], i * 3);
  }

  update(dt: number, speed: number): void {
    const len = 0.4 + speed * 0.07;
    for (let i = 0; i < this.n; i++) {
      let z = this.xyz[i * 3 + 2]! + speed * dt;
      if (z > DESPAWN_Z) {
        z -= DESPAWN_Z - (SPAWN_Z - 80);
        this.respawn(i, z);
      }
      this.xyz[i * 3 + 2] = z;
      const x = this.xyz[i * 3]!;
      const y = this.xyz[i * 3 + 1]!;
      this.pos.set([x, y, z, x, y, z - len], i * 6);
    }
    this.lines.geometry.attributes.position!.needsUpdate = true;
  }
}

interface Rock {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  r: number;
  hp: number;
  big: boolean;
  lava: boolean;
}

interface Enemy {
  group: THREE.Group;
  hp: number;
  t: number;
  holdZ: number;
  baseX: number;
  fireIn: number;
  mode: "approach" | "hold" | "dive";
}

interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
}

interface DropItem {
  mesh: THREE.Mesh;
  kind: Drop;
}

interface Boss {
  group: THREE.Group;
  ring: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  hp: number;
  max: number;
  t: number;
  entering: boolean;
  pattern: number;
  patternT: number;
  fireIn: number;
  spiral: number;
  flash: number;
}

interface Shock {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  max: number;
  grow: number;
}

/** Boss 每一波都新建一个，移除时把它独有的几何体和材质一起释放 */
function disposeObject(root: THREE.Object3D): void {
  root.removeFromParent();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

/** 简单的网格对象池：子弹每秒几十发，复用可以减少卡顿 */
class Pool {
  private free: THREE.Mesh[] = [];
  constructor(
    private scene: THREE.Scene,
    private geo: THREE.BufferGeometry,
    private mat: THREE.Material,
  ) {}
  get(): THREE.Mesh {
    const m = this.free.pop() ?? new THREE.Mesh(this.geo, this.mat);
    this.scene.add(m);
    return m;
  }
  release(m: THREE.Mesh): void {
    this.scene.remove(m);
    this.free.push(m);
  }
}

export class SpaceScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
  private clock = new THREE.Clock();
  private resizeObserver: ResizeObserver;

  // ---- 模型与材质 ----
  private ship!: THREE.Group;
  private flames: THREE.Mesh[] = [];
  private shield!: THREE.Mesh;
  private rockGeos = [0, 1, 2, 3, 4].map((s) => rockGeometry(s * 1.7 + 0.3));
  private rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7766, roughness: 0.92, metalness: 0.08, flatShading: true });
  private lavaMat = new THREE.MeshStandardMaterial({
    color: 0x4a2a20,
    emissive: new THREE.Color(0xff4a10),
    emissiveIntensity: 0.9,
    roughness: 0.8,
    flatShading: true,
  });
  private enemyParts = {
    body: new THREE.SphereGeometry(0.62, 18, 10),
    ring: new THREE.TorusGeometry(0.78, 0.07, 8, 32),
    dome: new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    bodyMat: new THREE.MeshStandardMaterial({ color: 0x30334a, metalness: 0.8, roughness: 0.3 }),
    ringMat: glow(0xff2a55, 3),
    domeMat: glow(0xff7ad0, 1.8),
  };
  private dropGeo = new THREE.OctahedronGeometry(0.42);
  private dropMats = Object.fromEntries(
    (Object.keys(DROP_INFO) as Drop[]).map((k) => [k, glow(DROP_INFO[k].color, 2.4)]),
  ) as Record<Drop, THREE.MeshBasicMaterial>;
  private shockGeo = new THREE.RingGeometry(0.85, 1, 48);
  private shotPool: Pool;
  private bulletPool: Pool;

  private particles = new Particles(3000);
  private stars = new Stars(800);

  // ---- 游戏状态 ----
  private state: "ready" | "playing" | "dying" | "over" = "ready";
  private paused = false;
  private shipPos = new THREE.Vector3();
  private shipVel = new THREE.Vector3();
  private target = new THREE.Vector2();
  private xRange = 2.5;
  private yRange = 2;
  private time = 0;
  private waveTime = 0;
  private wave = 1;
  private score = 0;
  private kills = 0;
  private hp = MAX_HP;
  private invuln = 0;
  private combo = 0;
  private comboT = 0;
  private powers: Record<SpacePower, number> = { spread: 0, rapid: 0, shield: 0 };
  private fireIn = 0;
  private fireSide = 1;
  private shotCount = 0;
  private rockIn = 1;
  private enemyIn = 6;
  private bossIncoming = 0;
  private rocks: Rock[] = [];
  private enemies: Enemy[] = [];
  private shots: Projectile[] = [];
  private bullets: Projectile[] = [];
  private drops: DropItem[] = [];
  private shocks: Shock[] = [];
  private boss: Boss | null = null;
  private dyingBoss: THREE.Group | null = null;
  private delayed: { at: number; fn: () => void }[] = [];
  private timeScale = 1;
  private slowFor = 0;
  private shake = 0;
  private hudIn = 0;

  // ---- 画质 ----
  private quality = 2;
  private frameSum = 0;
  private frameCount = 0;
  private warmup = 90;

  // ---- 输入 ----
  private keys = new Set<string>();
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(
    private container: HTMLElement,
    private hooks: SpaceHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.35, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.shotPool = new Pool(this.scene, new THREE.BoxGeometry(0.07, 0.07, 1.5), glow(0x55e6ff, 3.2));
    this.bulletPool = new Pool(this.scene, new THREE.SphereGeometry(0.2, 10, 8), glow(0xff3a5c, 3));

    this.setupWorld();
    this.ship = this.buildShip();
    this.scene.add(this.ship, this.particles.points, this.stars.lines);

    const canvas = this.renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.applyQuality();
    this.resize();
    this.renderer.setAnimationLoop(this.frame);

    // 开发时方便在控制台调试，比如 __space.waveTime = 44 直接叫出 Boss；生产构建会去掉
    if (import.meta.env.DEV) (window as unknown as { __space: SpaceScene }).__space = this;
  }

  // ================= 场景搭建 =================

  private setupWorld(): void {
    this.scene.background = new THREE.Color(0x04030c);
    this.scene.fog = new THREE.FogExp2(0x04030c, 0.0085);
    this.scene.add(new THREE.HemisphereLight(0x8fa0ff, 0x2a0830, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 10, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff4fd8, 1.2);
    rim.position.set(-6, -2, -8);
    // 镜头在飞船后上方，补一盏从镜头方向打过去的灯，机身才看得清
    const back = new THREE.DirectionalLight(0xbfd8ff, 1.3);
    back.position.set(0, 6, 12);
    this.scene.add(rim, back);

    // 远处的星球和它的大气光晕，不受雾影响
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(38, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x3b1f7a, emissive: new THREE.Color(0x1a0a40), roughness: 1, fog: false }),
    );
    planet.position.set(-70, -28, -260);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(41, 48, 32),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x7a3cff).multiplyScalar(0.9),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    halo.position.copy(planet.position);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(7, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0x5aa0c8, emissive: new THREE.Color(0x0a2a3a), roughness: 1, fog: false }),
    );
    moon.position.set(55, 30, -240);
    this.scene.add(planet, halo, moon);
  }

  private buildShip(): THREE.Group {
    const g = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 0.65, roughness: 0.28 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f45, metalness: 0.7, roughness: 0.35 });
    const cyan = glow(0x40e8ff, 2.6);

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.9, 8), hull);
    body.rotation.x = -Math.PI / 2;
    body.position.z = -0.15;
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), glow(0x7af0ff, 0.7));
    cockpit.scale.set(1, 0.7, 1.9);
    cockpit.position.set(0, 0.17, -0.25);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(1.15, 0.5);
    wingShape.lineTo(1.15, 0.85);
    wingShape.lineTo(0, 0.75);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: false });
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, dark);
      wing.rotation.x = Math.PI / 2;
      wing.scale.x = side;
      wing.position.set(0.12 * side, 0.03, -0.1);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), cyan);
      stripe.position.set(1.17 * side, 0.03, 0.55);
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), hull);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(0.55 * side, 0, 0.05);
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.5, 10), dark);
      engine.rotation.x = Math.PI / 2;
      engine.position.set(0.28 * side, -0.02, 0.75);
      const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), glow(0xff9a3c, 0.75));
      nozzle.position.set(0.28 * side, -0.02, 1.01);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.7, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xff7a2a).multiplyScalar(1.1),
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(0.28 * side, -0.02, 1.35);
      this.flames.push(flame);
      g.add(wing, stripe, gun, engine, nozzle, flame);
    }

    this.shield = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.25, 2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x4aa8ff).multiplyScalar(1.6),
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.shield.visible = false;

    g.add(body, cockpit, this.shield);
    return g;
  }

  private buildEnemy(): THREE.Group {
    const p = this.enemyParts;
    const g = new THREE.Group();
    const body = new THREE.Mesh(p.body, p.bodyMat);
    body.scale.set(1, 0.32, 1);
    const ring = new THREE.Mesh(p.ring, p.ringMat);
    ring.rotation.x = Math.PI / 2;
    const dome = new THREE.Mesh(p.dome, p.domeMat);
    dome.position.y = 0.1;
    g.add(body, ring, dome);
    g.rotation.x = 0.35;
    return g;
  }

  private buildBoss(): Boss {
    const g = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: 0x2b2440, metalness: 0.85, roughness: 0.3 });
    const coreMat = glow(0xff2ad4, 2.6);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), coreMat);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 0), armor);
    shell.scale.set(1, 1, 0.6);
    shell.position.z = -0.6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.28, 10, 48), armor);
    const ringGlow = new THREE.Mesh(new THREE.TorusGeometry(3, 0.08, 6, 64), glow(0xff3a8a, 3));
    ringGlow.position.z = 0.25;
    ring.add(ringGlow);
    // 环上一圈尖刺和灯
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3, 6), armor);
      spike.position.set(Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0);
      spike.rotation.z = a - Math.PI / 2;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glow(i % 2 ? 0xffd23c : 0xff3a5c, 3));
      lamp.position.set(Math.cos(a) * 3, Math.sin(a) * 3, 0.35);
      ring.add(spike, lamp);
    }
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 2.2), armor);
      pod.position.set(4.6 * side, 0, -0.4);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.1), glow(0xff3a5c, 3.5));
      eye.position.set(4.6 * side, 0, 0.72);
      g.add(pod, eye);
    }
    g.add(core, shell, ring);
    g.scale.setScalar(0.85);
    return { group: g, ring, coreMat, hp: 0, max: 0, t: 0, entering: true, pattern: 0, patternT: 0, fireIn: 1, spiral: 0, flash: 0 };
  }

  // ================= 对外接口 =================

  start(): void {
    this.reset();
    this.state = "playing";
    this.paused = false;
    this.hooks.onBanner({ kind: "info", text: "第 1 波" });
    this.emitHud();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
    this.drag = null;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.reset();
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.LineSegments) {
        geos.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => mats.add(m));
      }
    });
    [...this.rockGeos, this.dropGeo, this.shockGeo, this.enemyParts.body, this.enemyParts.ring, this.enemyParts.dome].forEach((g) => geos.add(g));
    [this.rockMat, this.lavaMat, this.enemyParts.bodyMat, this.enemyParts.ringMat, this.enemyParts.domeMat, ...Object.values(this.dropMats)].forEach((m) =>
      mats.add(m),
    );
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // ================= 主循环 =================

  private frame = (): void => {
    const realDt = Math.min(0.05, this.clock.getDelta());
    this.watchPerformance(realDt);
    if (this.paused) {
      this.render();
      return;
    }

    if (this.slowFor > 0) {
      this.slowFor -= realDt;
      this.timeScale = 0.28;
    } else {
      this.timeScale += (1 - this.timeScale) * Math.min(1, realDt * 3);
    }
    const dt = realDt * this.timeScale;
    this.time += dt;

    const difficulty = this.difficulty();
    this.stars.update(dt, this.state === "ready" ? 32 : 38 + difficulty * 5);

    for (const d of this.delayed.filter((d) => d.at <= this.time)) d.fn();
    this.delayed = this.delayed.filter((d) => d.at > this.time);

    if (this.state === "playing") {
      this.readInput(realDt);
      this.spawn(dt, difficulty);
      this.fire(dt);
      this.tickPowers(dt);
    }
    this.updateShip(dt);
    this.updateRocks(dt);
    this.updateEnemies(dt, difficulty);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updateDrops(dt);
    if (this.state === "playing") this.collide(dt);
    this.particles.update(dt);
    this.updateShocks(dt);
    this.updateCamera(realDt);

    this.hudIn -= realDt;
    if (this.state === "playing" && this.hudIn <= 0) this.emitHud();
    this.render();
  };

  private render(): void {
    if (this.quality >= 1) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** 平均帧时间太长就降一档画质：先降分辨率，再关掉辉光 */
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
    if (avg > 1 / 40 && this.quality > 0) {
      this.quality--;
      this.applyQuality();
      this.warmup = 30;
    }
  }

  private applyQuality(): void {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.quality === 2 ? Math.min(dpr, 1.75) : this.quality === 1 ? Math.min(dpr, 1.1) : 1);
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // 辉光用半分辨率就够了，省很多性能
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // 竖屏手机视野窄，把镜头拉宽一点
    this.camera.fov = this.camera.aspect < 0.8 ? 72 : 62;
    this.camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAMERA_DIST;
    this.xRange = halfH * this.camera.aspect * 0.8;
    this.yRange = Math.min(halfH * 0.5, 2.6);
  }

  private difficulty(): number {
    return this.wave - 1 + Math.min(this.waveTime, BOSS_EVERY) / BOSS_EVERY;
  }

  // ================= 输入 =================

  private onPointerDown = (e: PointerEvent): void => {
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  /** 相对拖动：手指不用压在飞船上，也不会挡住飞船 */
  private onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId || this.state !== "playing" || this.paused) return;
    const k = (this.xRange * 2.6) / Math.max(1, this.container.clientWidth);
    this.target.x = THREE.MathUtils.clamp(this.target.x + (e.clientX - d.x) * k, -this.xRange, this.xRange);
    this.target.y = THREE.MathUtils.clamp(this.target.y - (e.clientY - d.y) * k, -this.yRange, this.yRange);
    d.x = e.clientX;
    d.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.drag?.id === e.pointerId) this.drag = null;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.state !== "playing") return;
    const k = e.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(k)) {
      this.keys.add(k);
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private readInput(dt: number): void {
    const has = (...ks: string[]) => ks.some((k) => this.keys.has(k));
    const sx = (has("arrowright", "d") ? 1 : 0) - (has("arrowleft", "a") ? 1 : 0);
    const sy = (has("arrowup", "w") ? 1 : 0) - (has("arrowdown", "s") ? 1 : 0);
    const speed = this.xRange * 1.6;
    this.target.x = THREE.MathUtils.clamp(this.target.x + sx * speed * dt, -this.xRange, this.xRange);
    this.target.y = THREE.MathUtils.clamp(this.target.y + sy * speed * dt, -this.yRange, this.yRange);
  }

  // ================= 生成 =================

  private spawn(dt: number, d: number): void {
    if (this.boss || this.bossIncoming > 0) {
      if (this.bossIncoming > 0) {
        this.bossIncoming -= dt;
        if (this.bossIncoming <= 0) this.spawnBoss();
      }
      // Boss 战时零星来几块陨石
      this.rockIn -= dt;
      if (this.boss && this.rockIn <= 0) {
        this.spawnRock(d, false);
        this.rockIn = rand(2.2, 3.5);
      }
      return;
    }

    this.waveTime += dt;
    this.rockIn -= dt;
    if (this.rockIn <= 0) {
      this.spawnRock(d, Math.random() < 0.35);
      this.rockIn = Math.max(0.22, 0.95 - d * 0.13) * rand(0.6, 1.4);
    }
    if (this.time > 6) {
      this.enemyIn -= dt;
      if (this.enemyIn <= 0) {
        this.spawnEnemy(d);
        this.enemyIn = Math.max(1.8, 6.5 - d * 0.9) * rand(0.8, 1.2);
      }
    }
    if (this.waveTime >= BOSS_EVERY) {
      this.bossIncoming = 3;
      this.hooks.onBanner({ kind: "boss", text: "⚠ 警告：巨型战舰接近" });
      sfx.bossWarning();
      vibrate([80, 80, 80]);
    }
  }

  private spawnRock(d: number, big: boolean, at?: THREE.Vector3, vel?: THREE.Vector3): void {
    const r = big ? rand(1.25, 1.65) : rand(0.5, 0.8);
    const lava = Math.random() < 0.22;
    const mesh = new THREE.Mesh(pickOne(this.rockGeos), lava ? this.lavaMat : this.rockMat);
    mesh.scale.setScalar(r);
    if (at) {
      mesh.position.copy(at);
    } else if (Math.random() < 0.3) {
      // 一部分直接朝飞船当前位置飞过来，逼玩家躲
      mesh.position.set(this.shipPos.x + rand(-0.6, 0.6), this.shipPos.y + rand(-0.4, 0.4), SPAWN_Z);
    } else {
      mesh.position.set(rand(-this.xRange * 1.5, this.xRange * 1.5), rand(-this.yRange * 1.4, this.yRange * 1.4), SPAWN_Z);
    }
    mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    this.scene.add(mesh);
    const speed = (22 + d * 3.2 + rand(0, 8)) * (big ? 0.8 : 1);
    this.rocks.push({
      mesh,
      vel: vel ?? new THREE.Vector3(rand(-0.8, 0.8), rand(-0.4, 0.4), speed),
      spin: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)),
      r,
      hp: big ? 4 : 1,
      big,
      lava,
    });
  }

  private spawnEnemy(d: number): void {
    const group = this.buildEnemy();
    const baseX = rand(-this.xRange, this.xRange);
    group.position.set(baseX, rand(-this.yRange * 0.6, this.yRange), SPAWN_Z);
    this.scene.add(group);
    this.enemies.push({ group, hp: 3 + Math.floor(d / 2), t: 0, holdZ: rand(-48, -32), baseX, fireIn: rand(0.6, 1.4), mode: "approach" });
  }

  private spawnBoss(): void {
    const b = this.buildBoss();
    b.max = b.hp = 70 + 45 * (this.wave - 1);
    b.group.position.set(0, 0.5, SPAWN_Z - 20);
    this.scene.add(b.group);
    this.boss = b;
    this.emitHud();
  }

  private spawnDrop(at: THREE.Vector3, kind?: Drop): void {
    const k = kind ?? (this.hp < MAX_HP && Math.random() < 0.35 ? "heal" : pickOne<Drop>(["shield", "spread", "rapid"]));
    const mesh = new THREE.Mesh(this.dropGeo, this.dropMats[k]);
    // 掉落物放在飞船够得着的范围内
    mesh.position.set(
      THREE.MathUtils.clamp(at.x, -this.xRange, this.xRange),
      THREE.MathUtils.clamp(at.y, -this.yRange, this.yRange),
      at.z,
    );
    this.scene.add(mesh);
    this.drops.push({ mesh, kind: k });
  }

  private enemyFire(from: THREE.Vector3, vel: THREE.Vector3): void {
    const m = this.bulletPool.get();
    m.position.copy(from);
    this.bullets.push({ mesh: m, vel });
  }

  private aimAt(from: THREE.Vector3, speed: number, offsetX = 0, offsetY = 0): THREE.Vector3 {
    return new THREE.Vector3(this.shipPos.x + offsetX, this.shipPos.y + offsetY, 0).sub(from).normalize().multiplyScalar(speed);
  }

  // ================= 开火 =================

  private fire(dt: number): void {
    this.fireIn -= dt;
    if (this.fireIn > 0) return;
    this.fireIn = this.powers.rapid > 0 ? 0.075 : 0.16;
    this.fireSide = -this.fireSide;
    const shoot = (x: number, vx: number) => {
      const m = this.shotPool.get();
      m.position.set(this.shipPos.x + x, this.shipPos.y, this.shipPos.z - 0.9);
      m.rotation.set(0, Math.atan2(-vx, SHOT_SPEED), 0);
      this.shots.push({ mesh: m, vel: new THREE.Vector3(vx, 0, -SHOT_SPEED) });
    };
    if (this.powers.spread > 0) {
      shoot(0, 0);
      shoot(-0.3, -9);
      shoot(0.3, 9);
    } else {
      shoot(this.fireSide * 0.55, 0);
    }
    // 自动开火很密，隔一发响一次就够了
    if (this.shotCount++ % 2 === 0) sfx.laser();
  }

  private tickPowers(dt: number): void {
    for (const k of Object.keys(this.powers) as SpacePower[]) this.powers[k] = Math.max(0, this.powers[k] - dt);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
  }

  // ================= 更新各种物体 =================

  private updateShip(dt: number): void {
    const prev = this.shipPos.clone();
    if (this.state === "ready") {
      // 待机画面：飞船轻轻漂浮
      this.shipPos.set(Math.sin(this.time * 0.6) * 0.6, Math.sin(this.time * 1.1) * 0.25, 0);
    } else if (this.state === "playing") {
      const k = 1 - Math.exp(-dt * 14);
      this.shipPos.x += (this.target.x - this.shipPos.x) * k;
      this.shipPos.y += (this.target.y - this.shipPos.y) * k;
    }
    if (dt > 0) this.shipVel.copy(this.shipPos).sub(prev).divideScalar(dt);
    this.ship.position.copy(this.shipPos);
    // 左右移动时侧倾，上下移动时抬头低头
    const roll = THREE.MathUtils.clamp(-this.shipVel.x * 0.09, -0.8, 0.8);
    const pitch = THREE.MathUtils.clamp(this.shipVel.y * 0.05, -0.4, 0.4);
    this.ship.rotation.z += (roll - this.ship.rotation.z) * Math.min(1, dt * 10);
    this.ship.rotation.x += (pitch - this.ship.rotation.x) * Math.min(1, dt * 10);

    for (const f of this.flames) f.scale.set(1, 1 + Math.random() * 0.5, 1);
    if (this.invuln > 0) {
      this.invuln -= dt;
      this.ship.visible = this.state === "playing" ? Math.floor(this.invuln * 16) % 2 === 0 : this.ship.visible;
    } else if (this.state === "playing" || this.state === "ready") {
      this.ship.visible = true;
    }
    this.shield.visible = this.powers.shield > 0;
    if (this.shield.visible) {
      this.shield.rotation.y += dt * 1.5;
      this.shield.rotation.x += dt * 0.7;
      // 快到时间了闪烁提醒
      (this.shield.material as THREE.MeshBasicMaterial).opacity = this.powers.shield < 2 ? 0.2 + 0.3 * Math.abs(Math.sin(this.time * 12)) : 0.45;
    }
  }

  private updateRocks(dt: number): void {
    this.rocks = this.rocks.filter((r) => {
      r.mesh.position.addScaledVector(r.vel, dt);
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      r.mesh.rotation.z += r.spin.z * dt;
      if (r.mesh.position.z > DESPAWN_Z) {
        this.scene.remove(r.mesh);
        return false;
      }
      return true;
    });
  }

  private updateEnemies(dt: number, d: number): void {
    this.enemies = this.enemies.filter((e) => {
      e.t += dt;
      const p = e.group.position;
      e.group.rotation.y += dt * 2.5;
      if (e.mode === "approach") {
        p.z += 34 * dt;
        if (p.z >= e.holdZ) {
          e.mode = "hold";
          e.t = 0;
        }
      } else if (e.mode === "hold") {
        p.x = e.baseX + Math.sin(e.t * 1.4) * this.xRange * 0.6;
        e.fireIn -= dt;
        if (e.fireIn <= 0 && this.state === "playing") {
          this.enemyFire(p.clone(), this.aimAt(p, 19 + d * 1.5));
          e.fireIn = Math.max(0.7, 1.6 - d * 0.15);
        }
        if (e.t > 5.5) e.mode = "dive";
      } else {
        // 最后朝飞船冲过来
        p.z += 30 * dt;
        p.x += (this.shipPos.x - p.x) * Math.min(1, dt * 0.8);
        p.y += (this.shipPos.y - p.y) * Math.min(1, dt * 0.8);
      }
      if (p.z > DESPAWN_Z) {
        this.scene.remove(e.group);
        return false;
      }
      return true;
    });
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    if (!b) return;
    b.t += dt;
    const p = b.group.position;
    b.ring.rotation.z += dt * 0.8;
    b.group.rotation.z = Math.sin(b.t * 0.7) * 0.15;
    b.flash = Math.max(0, b.flash - dt * 6);
    b.coreMat.color.setHex(0xff2ad4).multiplyScalar(2.6).lerp(new THREE.Color(4, 4, 4), b.flash);

    if (b.entering) {
      p.z += (-40 - p.z) * Math.min(1, dt * 2);
      if (Math.abs(p.z + 40) < 0.6) {
        b.entering = false;
        this.hooks.onBanner({ kind: "boss", text: "击毁巨型战舰！" });
      }
      return;
    }
    p.x = Math.sin(b.t * 0.55) * this.xRange * 0.7;
    p.y = 0.6 + Math.sin(b.t * 0.8) * this.yRange * 0.4;
    if (this.state !== "playing") return;

    // 三种弹幕轮流来
    b.patternT += dt;
    if (b.patternT > 4.5) {
      b.patternT = 0;
      b.pattern = (b.pattern + 1) % 3;
      b.fireIn = 0.6;
    }
    b.fireIn -= dt;
    if (b.fireIn > 0) return;
    const from = p.clone().setZ(p.z + 2);
    const w = this.wave;
    if (b.pattern === 0) {
      // 扇形瞄准
      for (let i = -2; i <= 2; i++) this.enemyFire(from.clone(), this.aimAt(from, 21, i * 1.1));
      b.fireIn = Math.max(0.55, 1.05 - w * 0.06);
    } else if (b.pattern === 1) {
      // 一圈环形弹
      const n = 12 + Math.min(6, w);
      const off = Math.random() * Math.PI;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        this.enemyFire(from.clone(), new THREE.Vector3(Math.cos(a) * 3.2, Math.sin(a) * 3.2, 20));
      }
      b.fireIn = 1.4;
    } else {
      // 螺旋
      b.spiral += 0.55;
      for (const s of [0, Math.PI]) {
        const a = b.spiral + s;
        this.enemyFire(from.clone(), new THREE.Vector3(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 18));
      }
      b.fireIn = 0.11;
    }
  }

  private updateProjectiles(dt: number): void {
    this.shots = this.shots.filter((s) => {
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.mesh.position.z < SPAWN_Z - 10) {
        this.shotPool.release(s.mesh);
        return false;
      }
      return true;
    });
    this.bullets = this.bullets.filter((b) => {
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;
      if (p.z > DESPAWN_Z || Math.abs(p.x) > 40 || Math.abs(p.y) > 30) {
        this.bulletPool.release(b.mesh);
        return false;
      }
      return true;
    });
  }

  private updateDrops(dt: number): void {
    this.drops = this.drops.filter((d) => {
      d.mesh.position.z += 14 * dt;
      d.mesh.rotation.y += dt * 3;
      d.mesh.rotation.x += dt * 1.3;
      d.mesh.scale.setScalar(1 + Math.sin(this.time * 8) * 0.12);
      if (d.mesh.position.z > DESPAWN_Z) {
        this.scene.remove(d.mesh);
        return false;
      }
      return true;
    });
  }

  private updateShocks(dt: number): void {
    this.shocks = this.shocks.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        return false;
      }
      const k = 1 - s.life / s.max;
      s.mesh.scale.setScalar(0.3 + k * s.grow);
      s.mesh.material.opacity = (1 - k) * 0.9;
      return true;
    });
  }

  private updateCamera(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake;
    const cam = this.camera;
    const tx = this.shipPos.x * 0.35 + (Math.random() - 0.5) * s;
    const ty = 2.4 + this.shipPos.y * 0.3 + (Math.random() - 0.5) * s;
    cam.position.x += (tx - cam.position.x) * Math.min(1, dt * 8);
    cam.position.y += (ty - cam.position.y) * Math.min(1, dt * 8);
    cam.position.z = CAMERA_DIST;
    cam.lookAt(this.shipPos.x * 0.25, this.shipPos.y * 0.15 - 0.6, -20);
    // 镜头随飞船侧倾轻微旋转，速度感更强
    cam.rotation.z += -this.ship.rotation.z * 0.12;
  }

  // ================= 碰撞 =================

  /** 激光一帧走 1.5 个单位，用扫掠判断防止穿过小陨石 */
  private shotHits(s: Projectile, dt: number, at: THREE.Vector3, r: number): boolean {
    const p = s.mesh.position;
    const dx = p.x - at.x;
    const dy = p.y - at.y;
    if (dx * dx + dy * dy > (r + 0.18) ** 2) return false;
    const prevZ = p.z - s.vel.z * dt;
    return at.z >= p.z - r && at.z <= prevZ + r;
  }

  private nearShip(at: THREE.Vector3, r: number, depth = r): boolean {
    const p = this.shipPos;
    if (Math.abs(at.z - p.z) > depth + 0.5) return false;
    const dx = at.x - p.x;
    const dy = at.y - p.y;
    return dx * dx + dy * dy < (r + 0.45) ** 2;
  }

  private collide(dt: number): void {
    // 激光打陨石、敌机、Boss
    this.shots = this.shots.filter((s) => {
      for (const r of this.rocks) {
        if (r.hp > 0 && this.shotHits(s, dt, r.mesh.position, r.r)) {
          this.damageRock(r);
          this.shotPool.release(s.mesh);
          return false;
        }
      }
      for (const e of this.enemies) {
        if (e.hp > 0 && this.shotHits(s, dt, e.group.position, 0.85)) {
          this.damageEnemy(e);
          this.shotPool.release(s.mesh);
          return false;
        }
      }
      const b = this.boss;
      if (b && b.hp > 0 && !b.entering && this.shotHits(s, dt, b.group.position, 2.6)) {
        this.damageBoss(b, s.mesh.position);
        this.shotPool.release(s.mesh);
        return false;
      }
      return true;
    });
    this.rocks = this.rocks.filter((r) => {
      if (r.hp > 0) return true;
      this.scene.remove(r.mesh);
      return false;
    });
    this.enemies = this.enemies.filter((e) => {
      if (e.hp > 0) return true;
      this.scene.remove(e.group);
      return false;
    });

    // 东西撞到飞船
    for (const r of this.rocks) {
      if (this.nearShip(r.mesh.position, r.r * 0.85)) {
        r.hp = 0;
        this.explode(r.mesh.position, r.big ? 50 : 25, r.lava ? 0xff6a20 : 0xc8a888, r.big ? 14 : 9);
        this.scene.remove(r.mesh);
        this.hurt();
      }
    }
    this.rocks = this.rocks.filter((r) => r.hp > 0);
    for (const e of this.enemies) {
      if (this.nearShip(e.group.position, 0.75)) {
        e.hp = 0;
        this.explode(e.group.position, 50, 0xff3a6a, 14);
        this.scene.remove(e.group);
        this.hurt();
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    this.bullets = this.bullets.filter((b) => {
      if (this.state !== "playing" || !this.nearShip(b.mesh.position, 0.12, 0.3)) return true;
      this.particles.emit(b.mesh.position, 14, new THREE.Color(3, 0.5, 0.6), 7, 0.4);
      this.bulletPool.release(b.mesh);
      this.hurt();
      return false;
    });
    this.drops = this.drops.filter((d) => {
      if (!this.nearShip(d.mesh.position, 0.6)) return true;
      this.collect(d.kind);
      this.particles.emit(d.mesh.position, 30, new THREE.Color(DROP_INFO[d.kind].color).multiplyScalar(2.5), 6, 0.6);
      this.scene.remove(d.mesh);
      return false;
    });
  }

  private addKill(points: number): void {
    this.combo++;
    this.comboT = COMBO_WINDOW;
    this.kills++;
    this.score += points * this.mult();
  }

  private mult(): number {
    return Math.min(5, 1 + Math.floor(this.combo / 6));
  }

  private damageRock(r: Rock): void {
    r.hp--;
    const p = r.mesh.position;
    if (r.hp > 0) {
      sfx.hitRock();
      this.particles.emit(p, 6, new THREE.Color(1.6, 1.4, 1.1), 5, 0.25);
      return;
    }
    this.explode(p, r.big ? 60 : 24, r.lava ? 0xff6a20 : 0xd0b090, r.big ? 15 : 9);
    this.addKill(r.big ? 25 : 10);
    if (r.big) {
      // 大陨石碎成几块小的
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random();
        this.spawnRock(this.difficulty(), false, p.clone(), new THREE.Vector3(Math.cos(a) * 4, Math.sin(a) * 3, r.vel.z * 0.9));
      }
      if (Math.random() < 0.1) this.spawnDrop(p);
    }
  }

  private damageEnemy(e: Enemy): void {
    e.hp--;
    if (e.hp > 0) {
      sfx.hitRock();
      this.particles.emit(e.group.position, 8, new THREE.Color(3, 0.6, 1), 6, 0.3);
      return;
    }
    this.explode(e.group.position, 70, 0xff3a6a, 16);
    this.shock(e.group.position, 0xff5a8a, 5);
    this.addKill(50);
    if (Math.random() < 0.35) this.spawnDrop(e.group.position);
  }

  private damageBoss(b: Boss, at: THREE.Vector3): void {
    b.hp--;
    b.flash = 1;
    this.particles.emit(at, 5, new THREE.Color(3, 1, 2.6), 7, 0.3);
    if (b.hp % 4 === 0) sfx.hitRock();
    if (b.hp > 0) {
      this.hudIn = 0;
      return;
    }
    // Boss 被击毁：慢镜头加连环爆炸
    const p = b.group.position.clone();
    this.boss = null;
    this.score += 500 * this.wave;
    this.kills++;
    this.slowFor = 1.3;
    this.shake = 1.4;
    sfx.explode();
    vibrate([200, 80, 300]);
    for (let i = 0; i < 7; i++) {
      this.delayed.push({
        at: this.time + i * 0.12,
        fn: () => {
          const q = p.clone().add(new THREE.Vector3(rand(-3, 3), rand(-2, 2), rand(-1, 1)));
          this.explode(q, 90, pickOne([0xff2ad4, 0xffd23c, 0xff5a3c]), 22);
          this.shock(q, 0xff7ad8, 9);
        },
      });
    }
    this.dyingBoss = b.group;
    this.delayed.push({
      at: this.time + 0.9,
      fn: () => {
        disposeObject(b.group);
        this.dyingBoss = null;
      },
    });
    this.spawnDrop(p.clone().setX(p.x - 1), "heal");
    this.spawnDrop(p.clone().setX(p.x + 1));
    this.wave++;
    this.waveTime = 0;
    this.rockIn = 2.5;
    this.enemyIn = 7;
    this.hooks.onBanner({ kind: "info", text: `💥 战舰被击毁！+${500 * (this.wave - 1)}  第 ${this.wave} 波` });
    this.emitHud();
  }

  private collect(kind: Drop): void {
    sfx.powerup();
    if (kind === "heal") this.hp = Math.min(MAX_HP, this.hp + 1);
    else this.powers[kind] = POWER_TIME[kind];
    this.score += 20;
    this.hooks.onBanner({ kind: "power", text: DROP_INFO[kind].name });
    this.emitHud();
  }

  private hurt(): void {
    if (this.invuln > 0 || this.state !== "playing") return;
    if (this.powers.shield > 0) {
      // 护盾挡一下就碎
      this.powers.shield = 0;
      this.invuln = 0.8;
      this.explode(this.shipPos, 40, 0x4aa8ff, 10);
      sfx.shieldBreak();
      this.emitHud();
      return;
    }
    this.hp--;
    this.combo = 0;
    this.invuln = 1.6;
    this.shake = 0.9;
    vibrate(150);
    sfx.playerHit();
    this.particles.emit(this.shipPos, 30, new THREE.Color(3, 1.6, 0.6), 8, 0.5);
    this.emitHud();
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    this.state = "dying";
    this.ship.visible = false;
    this.slowFor = 1;
    this.shake = 1.5;
    sfx.explode();
    vibrate([300, 100, 500]);
    this.explode(this.shipPos, 160, 0xffa040, 18);
    this.explode(this.shipPos, 80, 0x40e8ff, 12);
    this.shock(this.shipPos, 0xffb060, 8);
    this.delayed.push({
      at: this.time + 1.1,
      fn: () => {
        this.state = "over";
        this.hooks.onGameOver({ score: this.score, wave: this.wave, kills: this.kills, seconds: Math.round(this.time) });
      },
    });
  }

  private explode(at: THREE.Vector3, count: number, color: number, speed: number): void {
    this.particles.emit(at, count, new THREE.Color(color).multiplyScalar(2.6), speed, 0.9);
    this.particles.emit(at, Math.ceil(count / 3), new THREE.Color(3, 3, 3), speed * 0.5, 0.35);
    if (count >= 50) sfx.rockBreak();
  }

  private shock(at: THREE.Vector3, color: number, grow: number): void {
    const mesh = new THREE.Mesh(
      this.shockGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(2.5),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.shocks.push({ mesh, life: 0.55, max: 0.55, grow });
  }

  private emitHud(): void {
    this.hudIn = 0.1;
    this.hooks.onHud({
      score: this.score,
      hp: this.hp,
      maxHp: MAX_HP,
      wave: this.wave,
      mult: this.mult(),
      boss: this.boss ? { hp: this.boss.hp, max: this.boss.max } : null,
      powers: (Object.keys(this.powers) as SpacePower[])
        .filter((k) => this.powers[k] > 0)
        .map((k) => ({ kind: k, left: this.powers[k], total: POWER_TIME[k] })),
    });
  }

  private reset(): void {
    for (const r of this.rocks) this.scene.remove(r.mesh);
    for (const e of this.enemies) this.scene.remove(e.group);
    for (const s of this.shots) this.shotPool.release(s.mesh);
    for (const b of this.bullets) this.bulletPool.release(b.mesh);
    for (const d of this.drops) this.scene.remove(d.mesh);
    for (const s of this.shocks) {
      this.scene.remove(s.mesh);
      s.mesh.material.dispose();
    }
    if (this.boss) disposeObject(this.boss.group);
    // 刚被击毁、还在播放爆炸的 Boss
    if (this.dyingBoss) disposeObject(this.dyingBoss);
    this.dyingBoss = null;
    this.rocks = [];
    this.enemies = [];
    this.shots = [];
    this.bullets = [];
    this.drops = [];
    this.shocks = [];
    this.boss = null;
    this.delayed = [];
    this.particles.clear();
    this.time = 0;
    this.waveTime = 0;
    this.wave = 1;
    this.score = 0;
    this.kills = 0;
    this.hp = MAX_HP;
    this.invuln = 0;
    this.combo = 0;
    this.comboT = 0;
    this.powers = { spread: 0, rapid: 0, shield: 0 };
    this.fireIn = 0;
    this.rockIn = 1;
    this.enemyIn = 6;
    this.bossIncoming = 0;
    this.timeScale = 1;
    this.slowFor = 0;
    this.shake = 0;
    this.target.set(0, 0);
    this.shipPos.set(0, 0, 0);
    this.ship.visible = true;
  }
}
