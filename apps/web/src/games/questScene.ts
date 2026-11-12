import * as THREE from "three";
import {
  QUEST_CRYSTALS,
  QUEST_FALL_Y,
  QUEST_GATE,
  QUEST_GOAL,
  QUEST_ISLANDS,
  QUEST_PLATES,
  QUEST_SLIMES,
  QUEST_SOLIDS,
  questSlimePos,
  type QuestMove,
  type QuestSolid,
  type QuestView,
} from "@party/shared";
import { sfx, vibrate } from "../sound";

/**
 * 秘境闯关的 3D 场景。
 *
 * 画风：卡通渲染（MeshToonMaterial + 三阶色带）+ 背面外扩描边，高饱和的天空、草地、浮空岛。
 * 所有模型都用基础几何体拼出来，不依赖外部美术资源。
 *
 * 玩法：自己的角色在本地做移动和碰撞（手感好、无延迟），定时把位置交给 hooks.onMove 发出去；
 * 其他人的角色收到位置后平滑插值。水晶、机关、结界、终点的状态以服务端下发的 QuestView 为准。
 */

export type QuestAirState = "ground" | "air" | "glide";

export interface QuestSceneHooks {
  onMove: (move: QuestMove) => void;
  /** 落地 / 起跳 / 滑翔状态变化，用来切换跳跃按钮的文字 */
  onAirState: (state: QuestAirState) => void;
  /** 掉出地图，开始回到检查点 */
  onFall: () => void;
}

export interface QuestScenePlayer {
  id: string;
  name: string;
  colorIndex: number;
}

/** 每个玩家的配色：衣服 / 头发 / 名字颜色 */
export const QUEST_PALETTE = [
  { cloth: 0xff7a59, hair: 0x6b3f2a, css: "#ff7a59" },
  { cloth: 0x4aa8ff, hair: 0x2e3a66, css: "#4aa8ff" },
  { cloth: 0xffc93c, hair: 0xf3efe6, css: "#f2b400" },
  { cloth: 0xb47cff, hair: 0x40305e, css: "#b47cff" },
  { cloth: 0x3cd68a, hair: 0x2a4a3a, css: "#26b874" },
  { cloth: 0xff6fb5, hair: 0xffd7e8, css: "#ff6fb5" },
];

// ---------- 手感参数 ----------
const RUN_SPEED = 6.2;
const GLIDE_SPEED = 7;
const GLIDE_FALL = 2;
const GRAVITY = 24;
const JUMP_V = 8.6;
const MAX_FALL = 26;
/** 角色碰撞半径 / 身高 */
const RADIUS = 0.35;
const HEIGHT = 1.6;
/** 低于这个高度差的台阶直接走上去 */
const STEP = 0.36;
/** 离开地面后这么久之内仍然可以起跳 */
const COYOTE = 0.12;
/** 落地前这么久按的跳跃也算数 */
const JUMP_BUFFER = 0.14;
const SEND_INTERVAL = 0.08;

const OUTLINE_COLOR = 0x2b2340;

// ---------- 小工具 ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** 三阶色带：亮面 / 中间调 / 暗面，卡通渲染的关键 */
function toonGradient(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
}

function textSprite(text: string, color: string, fontPx = 44): THREE.Sprite {
  const pad = 14;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `bold ${fontPx}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  const tex = canvasTexture(w, h, (c) => {
    c.font = measure.font;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineWidth = 9;
    c.strokeStyle = "rgba(43,35,64,0.85)";
    c.strokeText(text, w / 2, h / 2 + 2);
    c.fillStyle = color;
    c.fillText(text, w / 2, h / 2 + 2);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const scale = 0.0075;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

type Box = Extract<QuestSolid, { kind: "box" }>;
type Cyl = Extract<QuestSolid, { kind: "cyl" }>;

/** 角色的骨架：只需要能摆动的几个部位 */
interface Rig {
  root: THREE.Group;
  model: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  cape: THREE.Mesh;
  glider: THREE.Group;
  bubble: THREE.Sprite | null;
  bubbleLeft: number;
}

interface Avatar {
  id: string;
  rig: Rig;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  ry: number;
  targetRy: number;
  anim: QuestMove["anim"];
  phase: number;
  glideOpen: number;
  hasTarget: boolean;
}

interface CrystalFx {
  group: THREE.Group;
  collected: boolean;
  /** 被捡走后的消失动画进度，-1 表示还没被捡 */
  vanish: number;
}

export class QuestScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  private sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  private gradient = toonGradient();
  private glowTex = glowTexture();
  private mats = new Map<string, THREE.Material>();
  private outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  private resizeObserver: ResizeObserver;
  private clock = new THREE.Clock();
  private time = 0;
  private disposed = false;

  private sky!: THREE.Mesh;
  private clouds = new THREE.Group();
  private motes!: THREE.Points;
  private gateMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private gateRing!: THREE.Mesh;
  private gateFade = 1;
  private plateRings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private plateBeams: THREE.Mesh[] = [];
  private crystals: CrystalFx[] = [];
  private slimes: THREE.Group[] = [];
  private goalRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private goalBeam!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private goalCrystal!: THREE.Group;

  /** 只在前端参与碰撞的装饰：树干、神像底座 */
  private decorSolids: QuestSolid[] = [];

  // ---------- 状态 ----------
  private players: QuestScenePlayer[] = [];
  private me = "";
  private avatars = new Map<string, Avatar>();
  private gateOpen = false;
  private platesLit: boolean[] = QUEST_PLATES.map(() => false);
  private goalProgress = 0;
  private clockOffset = 0;
  private startedAt = Date.now();
  private frozen = false;

  // ---------- 本地角色 ----------
  private pos = new THREE.Vector3(...QUEST_ISLANDS[0]!.respawn);
  private vel = new THREE.Vector3();
  private ry = Math.PI;
  private grounded = true;
  private gliding = false;
  private sinceGround = 0;
  private sinceJump = 1;
  private jumpBuffer = 0;
  private knockCooldown = 0;
  private checkpoint = 0;
  private falling = -1;
  private airState: QuestAirState = "ground";
  private placed = false;
  private sendTimer = 0;
  private lastSent: QuestMove | null = null;
  private lastSentAt = 0;

  // ---------- 输入 ----------
  private stick = new THREE.Vector2();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0.32;
  private dist = 7.5;
  private camTarget = new THREE.Vector3();

  // ---------- 画质自适应 ----------
  private frameTimes: number[] = [];
  private lowQuality = false;

  constructor(
    private container: HTMLElement,
    private hooks: QuestSceneHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 卡通渲染不需要电影感的色调映射，保留原本的鲜艳颜色
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";

    this.scene.fog = new THREE.Fog(0xcdeeff, 70, 260);
    this.buildSky();
    this.buildLights();
    this.buildIslands();
    this.buildPillarsAndSteps();
    this.buildGate();
    this.buildPlates();
    this.buildCrystals();
    this.buildGoal();
    this.buildSlimes();
    this.buildClouds();
    this.buildMotes();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive: true });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.camTarget.copy(this.pos);
    this.renderer.setAnimationLoop(this.frame);
  }

  // =====================================================================
  // 材质
  // =====================================================================

  private toon(color: number, opts: { flat?: boolean; emissive?: number; opacity?: number } = {}): THREE.MeshToonMaterial {
    const key = `${color}-${opts.flat ? 1 : 0}-${opts.emissive ?? 0}-${opts.opacity ?? 1}`;
    let m = this.mats.get(key) as THREE.MeshToonMaterial | undefined;
    if (!m) {
      m = new THREE.MeshToonMaterial({
        color,
        gradientMap: this.gradient,
        emissive: opts.emissive ?? 0x000000,
        transparent: opts.opacity !== undefined,
        opacity: opts.opacity ?? 1,
      });
      // MeshToonMaterial 没有在类型里声明 flatShading，但着色器支持
      (m as THREE.MeshToonMaterial & { flatShading: boolean }).flatShading = !!opts.flat;
      this.mats.set(key, m);
    }
    return m;
  }

  /** 背面外扩描边：复制一份几何体，只画背面、稍微放大 */
  private outline<T extends THREE.Mesh>(mesh: T, scale = 1.06): T {
    const o = new THREE.Mesh(mesh.geometry, this.outlineMat);
    o.scale.setScalar(scale);
    o.raycast = () => {};
    mesh.add(o);
    return mesh;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  // =====================================================================
  // 场景搭建
  // =====================================================================

  private buildSky(): void {
    const sunDir = new THREE.Vector3(0.45, 0.35, -0.8).normalize();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f7dff) },
        mid: { value: new THREE.Color(0xaee0ff) },
        bottom: { value: new THREE.Color(0xfff4e2) },
        sunDir: { value: sunDir },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bottom, pow(-h, 0.45));
          float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (smoothstep(0.9975, 0.999, s) * 1.2 + pow(s, 10.0) * 0.28);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xe4f4ff, 0x9fcf7a, 1.25));
    this.sun.position.set(12, 24, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -18;
    cam.right = cam.top = 18;
    cam.near = 1;
    cam.far = 70;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
  }

  private buildIslands(): void {
    QUEST_ISLANDS.forEach((isl, idx) => {
      const g = new THREE.Group();
      g.position.set(isl.x, isl.top, isl.z);
      const r = isl.r;

      const grass = this.mesh(new THREE.CylinderGeometry(r, r * 0.98, 0.6, 48), this.toon(0x8ad85a));
      grass.position.y = -0.3;
      const dirt = this.mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.9, 1, 48), this.toon(0xd9a066));
      dirt.position.y = -1.1;

      // 岛的底部：倒过来的锥体，顶点随机扰动一下更像石头
      const rockGeo = new THREE.ConeGeometry(r * 0.9, r * 1.2, 11, 3);
      const rng = mulberry32(idx * 97 + 7);
      const p = rockGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y > r * 0.59) continue; // 顶面保持平整，和泥土层贴合
        const k = 1 + (rng() - 0.5) * 0.28;
        p.setXYZ(i, p.getX(i) * k, y + (rng() - 0.5) * 0.4, p.getZ(i) * k);
      }
      rockGeo.computeVertexNormals();
      const rock = this.mesh(rockGeo, this.toon(0xa58a78, { flat: true }));
      rock.rotation.x = Math.PI;
      rock.position.y = -1.6 - r * 0.6;
      g.add(grass, dirt, rock);
      this.scene.add(g);

      this.decorateIsland(isl.x, isl.top, isl.z, r, idx);
    });
  }

  /** 岛上随机摆树、石头、草丛和小花，避开中间的通路和机关 */
  private decorateIsland(cx: number, top: number, cz: number, r: number, seed: number): void {
    const rng = mulberry32(seed * 131 + 3);
    const keepClear = (x: number, z: number) => {
      if (Math.abs(x - cx) < 2.6) return true; // 中间的路
      if (QUEST_PLATES.some((p) => Math.hypot(p.x - x, p.z - z) < 2.4)) return true;
      if (Math.hypot(QUEST_GOAL.x - x, QUEST_GOAL.z - z) < QUEST_GOAL.r + 1.5) return true;
      if (QUEST_CRYSTALS.some((c) => Math.hypot(c.x - x, c.z - z) < 1.6)) return true;
      if (QUEST_SOLIDS.some((s) => s.kind === "box" && x > s.min[0] - 1.5 && x < s.max[0] + 1.5 && z > s.min[2] - 1.5 && z < s.max[2] + 1.5))
        return true;
      return false;
    };
    const spot = (minR: number, maxR: number) => {
      for (let k = 0; k < 20; k++) {
        const a = rng() * Math.PI * 2;
        const d = minR + rng() * (maxR - minR);
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        if (!keepClear(x, z)) return { x, z };
      }
      return null;
    };

    const trees = Math.round(r * 0.45);
    for (let i = 0; i < trees; i++) {
      const s = spot(r * 0.35, r * 0.85);
      if (s) this.addTree(s.x, top, s.z, 0.8 + rng() * 0.6, rng);
    }
    for (let i = 0; i < 4; i++) {
      const s = spot(r * 0.3, r * 0.92);
      if (!s) continue;
      const rock = this.outline(
        this.mesh(new THREE.DodecahedronGeometry(0.35 + rng() * 0.35, 0), this.toon(0xc6bdb3, { flat: true })),
        1.08,
      );
      rock.position.set(s.x, top + 0.15, s.z);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      this.scene.add(rock);
    }

    // 草丛和花用实例化，几百个也只有几次绘制调用
    const tuftGeo = new THREE.ConeGeometry(0.09, 0.42, 4);
    tuftGeo.translate(0, 0.2, 0);
    const tufts = new THREE.InstancedMesh(tuftGeo, this.toon(0x6cc244), 70);
    const flowerGeo = new THREE.SphereGeometry(0.09, 6, 4);
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshToonMaterial({ gradientMap: this.gradient }), 24);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const flowerColors = [0xffffff, 0xffe066, 0xff8fb8, 0xb79bff];
    for (let i = 0; i < tufts.count; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * r * 0.93;
      e.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
      const s = 0.7 + rng() * 0.7;
      m.compose(new THREE.Vector3(cx + Math.cos(a) * d, top, cz + Math.sin(a) * d), q.setFromEuler(e), new THREE.Vector3(s, s, s));
      tufts.setMatrixAt(i, m);
    }
    for (let i = 0; i < flowers.count; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * r * 0.9;
      m.makeTranslation(cx + Math.cos(a) * d, top + 0.12, cz + Math.sin(a) * d);
      flowers.setMatrixAt(i, m);
      flowers.setColorAt(i, new THREE.Color(flowerColors[i % flowerColors.length]!));
    }
    tufts.receiveShadow = flowers.receiveShadow = true;
    this.scene.add(tufts, flowers);
  }

  private addTree(x: number, y: number, z: number, s: number, rng: () => number): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    const trunk = this.outline(this.mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.5, 7), this.toon(0x9a6440)), 1.1);
    trunk.position.y = 0.75;
    g.add(trunk);
    const greens = [0x5cc24a, 0x7fd85b, 0x4fb04a];
    const blobs: [number, number, number, number][] = [
      [0, 1.9, 0, 0.95],
      [0.45, 1.6, 0.2, 0.65],
      [-0.4, 1.65, -0.2, 0.7],
      [0.05, 2.5, 0, 0.6],
    ];
    blobs.forEach(([bx, by, bz, br], i) => {
      const leaf = this.outline(this.mesh(new THREE.IcosahedronGeometry(br, 1), this.toon(greens[i % 3]!, { flat: true })), 1.07);
      leaf.position.set(bx, by, bz);
      leaf.rotation.set(rng(), rng(), rng());
      g.add(leaf);
    });
    g.rotation.y = rng() * Math.PI * 2;
    this.scene.add(g);
    this.decorSolids.push({ kind: "cyl", x, z, r: 0.28 * s, top: y + 2.4 * s, bottom: y - 1, look: "pillar" });
  }

  private buildPillarsAndSteps(): void {
    for (const s of QUEST_SOLIDS) {
      if (s.kind === "cyl" && s.look === "pillar") {
        const h = s.top - s.bottom;
        const col = this.outline(this.mesh(new THREE.CylinderGeometry(s.r, s.r * 0.8, h, 10), this.toon(0xc9bfb2, { flat: true })), 1.04);
        col.position.set(s.x, s.top - h / 2 - 0.15, s.z);
        const cap = this.mesh(new THREE.CylinderGeometry(s.r * 1.04, s.r * 1.02, 0.3, 20), this.toon(0x8ad85a));
        cap.position.set(s.x, s.top - 0.15, s.z);
        this.scene.add(col, cap);
      } else if (s.kind === "box") {
        if (s.look === "wood") this.addBridge(s);
        else if (s.look === "rune") this.addRunePillar(s);
        else this.addStoneStep(s);
      }
    }
  }

  private addStoneStep(s: Box): void {
    const [x0, y0, z0] = s.min;
    const [x1, y1, z1] = s.max;
    const w = x1 - x0;
    const d = z1 - z0;
    const h = y1 - y0;
    const body = this.outline(this.mesh(new THREE.BoxGeometry(w * 0.96, h - 0.25, d * 0.96), this.toon(0xbfb3a4, { flat: true })), 1.03);
    body.position.set((x0 + x1) / 2, y0 + (h - 0.25) / 2, (z0 + z1) / 2);
    const top = this.mesh(new THREE.BoxGeometry(w, 0.25, d), this.toon(0x8ad85a));
    top.position.set((x0 + x1) / 2, y1 - 0.125, (z0 + z1) / 2);
    this.scene.add(body, top);
  }

  private addBridge(s: Box): void {
    const [x0, , z0] = s.min;
    const [x1, y1, z1] = s.max;
    const g = new THREE.Group();
    const plankGeo = new THREE.BoxGeometry(x1 - x0, 0.22, 0.85);
    const woods = [this.toon(0xd29256), this.toon(0xc07f45)];
    let i = 0;
    for (let z = z1 - 0.45; z > z0; z -= 0.95) {
      const plank = this.mesh(plankGeo, woods[i++ % 2]!);
      plank.position.set((x0 + x1) / 2, y1 - 0.11, z);
      plank.rotation.y = (Math.sin(z * 7.3) * 0.03);
      g.add(plank);
    }
    // 两侧的绳子和桩子
    const postGeo = new THREE.CylinderGeometry(0.07, 0.08, 1, 6);
    const ropeMat = this.toon(0xf1e1b0);
    for (const x of [x0 + 0.1, x1 - 0.1]) {
      for (let z = z1 - 0.3; z > z0; z -= 3.5) {
        const post = this.mesh(postGeo, this.toon(0x8a5a36));
        post.position.set(x, y1 + 0.4, z);
        g.add(post);
      }
      const rope = this.mesh(new THREE.CylinderGeometry(0.03, 0.03, z1 - z0, 4), ropeMat, false);
      rope.rotation.x = Math.PI / 2;
      rope.position.set(x, y1 + 0.8, (z0 + z1) / 2);
      g.add(rope);
    }
    this.scene.add(g);
  }

  private addRunePillar(s: Box): void {
    const [x0, y0, z0] = s.min;
    const [x1, y1, z1] = s.max;
    const h = y1 - y0;
    const body = this.outline(this.mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), this.toon(0x7c8db5, { flat: true })), 1.04);
    body.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    const cap = this.outline(this.mesh(new THREE.OctahedronGeometry(0.55, 0), this.toon(0xffd36b, { emissive: 0x6a4a00 })), 1.08);
    cap.position.set((x0 + x1) / 2, y1 + 0.6, (z0 + z1) / 2);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0 + 0.02, h * 0.7, 0.12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7ff6ff) }),
    );
    stripe.position.set((x0 + x1) / 2, y0 + h * 0.55, z1 + 0.01);
    this.scene.add(body, cap, stripe);
  }

  private buildGate(): void {
    const [x0, y0, z0] = QUEST_GATE.min;
    const [x1, y1, z1] = QUEST_GATE.max;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { t: { value: 0 }, fade: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float t; uniform float fade; varying vec2 vUv;
        void main() {
          // 斜向流动的光纹 + 网格 + 边缘发光
          float bands = 0.5 + 0.5 * sin((vUv.y * 18.0 + vUv.x * 6.0) - t * 3.0);
          vec2 g = abs(fract(vUv * vec2(8.0, 9.0)) - 0.5);
          float grid = smoothstep(0.42, 0.5, max(g.x, g.y));
          float edge = smoothstep(0.35, 0.5, abs(vUv.x - 0.5)) + smoothstep(0.75, 1.0, vUv.y);
          float a = (0.18 + bands * 0.22 + grid * 0.35 + edge * 0.5) * fade;
          gl_FragColor = vec4(vec3(0.45, 0.95, 1.0) * a, a);
        }`,
    });
    this.gateMesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), mat);
    this.gateMesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.scene.add(this.gateMesh);

    this.gateRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.06, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true }),
    );
    this.gateRing.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.3, (z0 + z1) / 2 + 0.05);
    this.scene.add(this.gateRing);
  }

  private buildPlates(): void {
    for (const p of QUEST_PLATES) {
      const base = this.outline(this.mesh(new THREE.CylinderGeometry(1.2, 1.35, 0.14, 28), this.toon(0x8e9cc4, { flat: true })), 1.04);
      base.position.set(p.x, p.y + 0.02, p.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 0.98, 6, 1),
        new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, p.y + 0.1, p.z);
      // 提示用的光柱：结界打开前从机关上方升起
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.9, 7, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x7ff6ff,
          transparent: true,
          opacity: 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      beam.position.set(p.x, p.y + 3.5, p.z);
      this.scene.add(base, ring, beam);
      this.plateRings.push(ring);
      this.plateBeams.push(beam);
    }
  }

  private buildCrystals(): void {
    const geo = new THREE.OctahedronGeometry(0.32, 0);
    geo.scale(1, 1.55, 1);
    const mat = this.toon(0x9fe9ff, { emissive: 0x1d5f9a });
    const glow = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: 0x9fe9ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const c of QUEST_CRYSTALS) {
      const g = new THREE.Group();
      g.position.set(c.x, c.y + 0.95, c.z);
      const gem = this.outline(new THREE.Mesh(geo, mat), 1.14);
      const halo = new THREE.Sprite(glow);
      halo.scale.setScalar(1.6);
      g.add(halo, gem);
      this.scene.add(g);
      this.crystals.push({ group: g, collected: false, vanish: -1 });
    }
  }

  private buildGoal(): void {
    const { x, y, z, r } = QUEST_GOAL;
    const disk = this.outline(this.mesh(new THREE.CylinderGeometry(r + 0.1, r + 0.35, 0.3, 48), this.toon(0xf2eadb, { flat: true })), 1.02);
    disk.position.set(x, y + 0.15, z);
    this.decorSolids.push({ kind: "cyl", x, z, r: r + 0.2, top: y + 0.3, bottom: y - 1, look: "pillar" });

    this.goalRing = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.45, r - 0.1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.6 }),
    );
    this.goalRing.rotation.x = -Math.PI / 2;
    this.goalRing.position.set(x, y + 0.32, z);

    // 神像：底座 + 立柱 + 漂浮的大水晶
    const sx = x;
    const sz = z - r - 2;
    const pedestal = this.outline(this.mesh(new THREE.BoxGeometry(2.6, 1, 2.6), this.toon(0xe6dccb, { flat: true })), 1.03);
    pedestal.position.set(sx, y + 0.5, sz);
    const column = this.outline(this.mesh(new THREE.CylinderGeometry(0.55, 0.75, 4.2, 8), this.toon(0x8fa3d1, { flat: true })), 1.04);
    column.position.set(sx, y + 3.1, sz);
    const wingGeo = new THREE.ConeGeometry(0.5, 2.2, 4);
    for (const side of [-1, 1]) {
      const wing = this.outline(this.mesh(wingGeo, this.toon(0xffd36b, { emissive: 0x4a3200 })), 1.06);
      wing.position.set(sx + side * 1.05, y + 4.8, sz);
      wing.rotation.z = side * -0.9;
      this.scene.add(wing);
    }
    this.decorSolids.push({ kind: "box", min: [sx - 1.3, y - 1, sz - 1.3], max: [sx + 1.3, y + 5.2, sz + 1.3], look: "stone" });

    this.goalCrystal = new THREE.Group();
    this.goalCrystal.position.set(sx, y + 6.6, sz);
    const bigGeo = new THREE.OctahedronGeometry(0.75, 0);
    bigGeo.scale(1, 1.5, 1);
    const gem = this.outline(new THREE.Mesh(bigGeo, this.toon(0x8ff0ff, { emissive: 0x2a7fb0 })), 1.08);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xbff8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo.scale.setScalar(5);
    this.goalCrystal.add(halo, gem);

    // 远处就能看到的光柱，指引方向
    this.goalBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 120, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xbff8ff,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.goalBeam.position.set(sx, y + 66, sz);
    this.scene.add(disk, this.goalRing, pedestal, column, this.goalCrystal, this.goalBeam);
  }

  private buildSlimes(): void {
    const bodyGeo = new THREE.SphereGeometry(0.55, 20, 14);
    const eyeGeo = new THREE.SphereGeometry(0.075, 8, 6);
    const colors = [0x6fe07a, 0x6fc8ff, 0xffa65c];
    QUEST_SLIMES.forEach((_, i) => {
      const g = new THREE.Group();
      const body = this.outline(this.mesh(bodyGeo, this.toon(colors[i % colors.length]!, { opacity: 0.92 })), 1.06);
      body.position.y = 0.5;
      body.name = "body";
      const eyeMat = this.toon(OUTLINE_COLOR);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.scale.set(1, 1.5, 0.6);
        eye.position.set(side * 0.18, 0.62, 0.5);
        body.add(eye);
      }
      g.add(body);
      this.scene.add(g);
      this.slimes.push(g);
    });
  }

  private buildClouds(): void {
    const rng = mulberry32(42);
    const puffs: THREE.Matrix4[] = [];
    const addCloud = (x: number, y: number, z: number, s: number) => {
      const n = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const r = s * (0.6 + rng() * 0.7);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x + (i - n / 2) * s * 0.9 + rng() * s * 0.4, y + rng() * s * 0.4, z + (rng() - 0.5) * s * 1.2),
          new THREE.Quaternion(),
          new THREE.Vector3(r * 1.3, r * 0.8, r),
        );
        puffs.push(m);
      }
    };
    // 下方的云海
    for (let i = 0; i < 46; i++) addCloud(-70 + rng() * 140, -16 - rng() * 10, 30 - rng() * 170, 4 + rng() * 5);
    // 远处天上的云
    for (let i = 0; i < 14; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      addCloud(side * (45 + rng() * 60), 8 + rng() * 28, 20 - rng() * 160, 4 + rng() * 4);
    }
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), this.toon(0xffffff), puffs.length);
    puffs.forEach((m, i) => inst.setMatrixAt(i, m));
    this.clouds.add(inst);
    this.scene.add(this.clouds);
  }

  /** 空中飘着的光点 */
  private buildMotes(): void {
    const n = 220;
    const pos = new Float32Array(n * 3);
    const rng = mulberry32(9);
    for (let i = 0; i < n; i++) pos.set([-20 + rng() * 40, -4 + rng() * 16, 12 - rng() * 125], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: this.glowTex,
        color: 0xfff6c8,
        size: 0.35,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.motes);
  }

  // =====================================================================
  // 角色
  // =====================================================================

  private buildRig(colorIndex: number, name: string, isMe: boolean): Rig {
    const pal = QUEST_PALETTE[colorIndex % QUEST_PALETTE.length]!;
    const skin = this.toon(0xffe4d0);
    const cloth = this.toon(pal.cloth);
    const clothDark = this.toon(new THREE.Color(pal.cloth).multiplyScalar(0.75).getHex());
    const hair = this.toon(pal.hair);
    const dark = this.toon(0x3b3552);

    const root = new THREE.Group();
    const model = new THREE.Group();
    root.add(model);

    const limb = (r: number, len: number, mat: THREE.Material) => {
      const pivot = new THREE.Group();
      const m = this.outline(this.mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat), 1.12);
      m.position.y = -len / 2 - r * 0.5;
      pivot.add(m);
      return pivot;
    };

    const legL = limb(0.085, 0.3, dark);
    const legR = limb(0.085, 0.3, dark);
    legL.position.set(-0.11, 0.5, 0);
    legR.position.set(0.11, 0.5, 0);

    const torso = this.outline(this.mesh(new THREE.CapsuleGeometry(0.2, 0.28, 4, 12), cloth), 1.06);
    torso.position.y = 0.8;
    // 双面材质单独建，不要改到共用的材质缓存
    const skirt = this.mesh(
      new THREE.ConeGeometry(0.31, 0.36, 12, 1, true),
      new THREE.MeshToonMaterial({ color: clothDark.color, gradientMap: this.gradient, side: THREE.DoubleSide }),
    );
    skirt.position.y = 0.6;
    const belt = this.mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16), this.toon(0xffd36b));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.72;

    const armL = limb(0.06, 0.26, cloth);
    const armR = limb(0.06, 0.26, cloth);
    armL.position.set(-0.26, 1.0, 0);
    armR.position.set(0.26, 1.0, 0);

    // 头：大头身比例，Q 版
    const head = this.outline(this.mesh(new THREE.SphereGeometry(0.33, 22, 16), skin), 1.05);
    head.position.y = 1.36;
    const hairBack = this.outline(this.mesh(new THREE.SphereGeometry(0.35, 22, 16), hair), 1.05);
    hairBack.scale.set(1.02, 1.05, 0.95);
    hairBack.position.set(0, 1.39, -0.06);
    const hairTop = this.mesh(new THREE.SphereGeometry(0.355, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), hair);
    hairTop.position.set(0, 1.39, 0.01);
    hairTop.rotation.x = 0.35;
    const bangGeo = new THREE.ConeGeometry(0.09, 0.26, 5);
    for (const [bx, rz] of [
      [-0.16, 0.35],
      [0, 0],
      [0.16, -0.35],
    ] as const) {
      const bang = this.mesh(bangGeo, hair, false);
      bang.position.set(bx, 1.55, 0.25);
      bang.rotation.set(Math.PI + 0.35, 0, rz);
      model.add(bang);
    }
    // 呆毛
    const ahoge = this.mesh(new THREE.ConeGeometry(0.04, 0.28, 4), hair, false);
    ahoge.position.set(0.03, 1.8, 0.02);
    ahoge.rotation.z = -0.5;

    const eyeGeo = new THREE.SphereGeometry(0.055, 10, 8);
    const hiGeo = new THREE.SphereGeometry(0.018, 6, 4);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeMat = this.toon(OUTLINE_COLOR);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.scale.set(0.85, 1.35, 0.5);
      eye.position.set(side * 0.12, 1.33, 0.29);
      const hi = new THREE.Mesh(hiGeo, white);
      hi.position.set(side * 0.12 + 0.02, 1.37, 0.315);
      model.add(eye, hi);
    }

    // 披风 / 围巾，用玩家颜色区分
    const capeGeo = new THREE.PlaneGeometry(0.42, 0.62, 1, 4);
    capeGeo.translate(0, -0.31, 0);
    const cape = new THREE.Mesh(
      capeGeo,
      new THREE.MeshToonMaterial({ color: pal.cloth, gradientMap: this.gradient, side: THREE.DoubleSide }),
    );
    cape.position.set(0, 1.08, -0.2);
    cape.castShadow = true;

    // 风之翼：两片三角翼
    const glider = new THREE.Group();
    glider.position.set(0, 1.95, -0.05);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(1.3, 0.25);
    wingShape.lineTo(1.1, -0.15);
    wingShape.lineTo(0, -0.55);
    wingShape.closePath();
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    const wingMat = new THREE.MeshToonMaterial({ color: 0xfaf6ee, gradientMap: this.gradient, side: THREE.DoubleSide });
    const trimMat = new THREE.MeshBasicMaterial({ color: pal.cloth, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, wingMat);
      wing.rotation.x = -Math.PI / 2;
      wing.scale.x = side;
      const trim = new THREE.Mesh(wingGeo, trimMat);
      trim.scale.set(0.45, 0.45, 1);
      trim.position.z = 0.01;
      wing.add(trim);
      glider.add(wing);
    }
    glider.visible = false;

    model.add(legL, legR, torso, skirt, belt, armL, armR, head, hairBack, hairTop, ahoge, cape, glider);

    const label = textSprite(isMe ? `★ ${name}` : name, pal.css === "#f2b400" ? "#ffe066" : pal.css);
    label.position.y = 2.25;
    root.add(label);

    return { root, model, legL, legR, armL, armR, cape, glider, bubble: null, bubbleLeft: 0 };
  }

  private animateRig(a: Avatar, dt: number, speed: number): void {
    const { rig } = a;
    const t = this.time;
    const glide = a.anim === 3;
    a.glideOpen = clamp(a.glideOpen + (glide ? dt * 5 : -dt * 6), 0, 1);
    rig.glider.visible = a.glideOpen > 0.01;
    rig.glider.scale.set(a.glideOpen, 1, 0.4 + a.glideOpen * 0.6);

    let legSwing = 0;
    let armSwing = 0;
    let armLift = 0;
    let bob = 0;
    let lean = 0;
    let legBend = 0;
    if (a.anim === 1) {
      a.phase += dt * (6 + speed * 1.6);
      legSwing = Math.sin(a.phase) * 0.9;
      armSwing = -Math.sin(a.phase) * 0.8;
      bob = Math.abs(Math.sin(a.phase)) * 0.07;
      lean = 0.12;
    } else if (a.anim === 2) {
      legBend = 0.5;
      armLift = -1.1;
    } else if (glide) {
      armLift = -2.9;
      lean = 0.35;
      legSwing = Math.sin(t * 3) * 0.12;
    } else {
      bob = Math.sin(t * 2.2) * 0.015;
      armSwing = Math.sin(t * 2.2) * 0.05;
    }
    const k = damp(14, dt);
    rig.legL.rotation.x += (legSwing - legBend - rig.legL.rotation.x) * k;
    rig.legR.rotation.x += (-legSwing + legBend * 0.4 - rig.legR.rotation.x) * k;
    rig.armL.rotation.x += (armSwing + armLift - rig.armL.rotation.x) * k;
    rig.armR.rotation.x += (-armSwing + armLift - rig.armR.rotation.x) * k;
    rig.armL.rotation.z = -0.15;
    rig.armR.rotation.z = 0.15;
    rig.model.position.y = bob;
    rig.model.rotation.x += (lean - rig.model.rotation.x) * k;
    // 披风随速度飘起来
    const flutter = 0.25 + Math.min(speed, 7) * 0.12 + Math.sin(t * 9 + a.phase) * 0.06 + (a.anim >= 2 ? 0.5 : 0);
    rig.cape.rotation.x += (flutter - rig.cape.rotation.x) * k;

    if (rig.bubble) {
      rig.bubbleLeft -= dt;
      rig.bubble.position.y = 2.75 + Math.sin(t * 6) * 0.05;
      if (rig.bubbleLeft <= 0) {
        rig.root.remove(rig.bubble);
        rig.bubble.material.map?.dispose();
        rig.bubble.material.dispose();
        rig.bubble = null;
      }
    }
  }

  // =====================================================================
  // 外部接口
  // =====================================================================

  setPlayers(players: QuestScenePlayer[], me: string): void {
    this.me = me;
    this.players = players;
    const ids = new Set(players.map((p) => p.id));
    for (const [id, a] of this.avatars) {
      if (!ids.has(id)) {
        this.scene.remove(a.rig.root);
        this.avatars.delete(id);
      }
    }
    for (const p of players) {
      if (this.avatars.has(p.id)) continue;
      const rig = this.buildRig(p.colorIndex, p.name, p.id === me);
      this.scene.add(rig.root);
      this.avatars.set(p.id, {
        id: p.id,
        rig,
        pos: new THREE.Vector3(),
        target: new THREE.Vector3(),
        ry: Math.PI,
        targetRy: Math.PI,
        anim: 0,
        phase: 0,
        glideOpen: 0,
        hasTarget: false,
      });
    }
  }

  /** 用服务端视图同步关卡状态 */
  applyView(v: QuestView): void {
    this.startedAt = v.startedAt;
    this.clockOffset = v.serverNow - Date.now();
    this.frozen = v.phase === "ended";

    // 第一次拿到位置时把自己放到出生点（或重连前的位置）
    const mine = v.positions[this.me];
    if (!this.placed && mine) {
      this.placed = true;
      this.pos.set(mine.x, Math.max(mine.y, QUEST_FALL_Y + 1), mine.z);
      this.ry = mine.ry;
      this.camTarget.copy(this.pos);
      this.yaw = 0;
      // 重连回来时恢复检查点
      QUEST_ISLANDS.forEach((isl, i) => {
        if (mine.z < isl.z + isl.r) this.checkpoint = Math.max(this.checkpoint, i);
      });
    }
    for (const [id, m] of Object.entries(v.positions)) {
      const a = this.avatars.get(id);
      if (a && id !== this.me && !a.hasTarget) this.remoteMove(id, m);
    }

    v.crystals.forEach((owner, i) => {
      const c = this.crystals[i];
      if (!c || !owner || c.collected) return;
      c.collected = true;
      c.vanish = 0;
    });

    const lit = v.plates.map((p) => p !== null || v.gateOpen);
    lit.forEach((on, i) => {
      if (on && !this.platesLit[i] && !v.gateOpen) sfx.plate();
    });
    this.platesLit = lit;
    this.gateOpen = v.gateOpen;
    this.goalProgress = v.order.length ? v.inGoal.length / v.order.length : 0;
  }

  remoteMove(id: string, m: QuestMove): void {
    if (id === this.me) return;
    const a = this.avatars.get(id);
    if (!a) return;
    a.target.set(m.x, m.y, m.z);
    // 第一次出现或者瞬移（回检查点）时直接放过去
    if (!a.hasTarget || a.pos.distanceTo(a.target) > 8) a.pos.copy(a.target);
    a.hasTarget = true;
    a.targetRy = m.ry;
    a.anim = m.anim;
  }

  /** 在某个角色头顶冒一个表情 */
  showEmote(id: string, emoji: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    if (a.rig.bubble) a.rig.root.remove(a.rig.bubble);
    const s = textSprite(emoji, "#ffffff", 72);
    s.scale.multiplyScalar(0.9);
    a.rig.root.add(s);
    a.rig.bubble = s;
    a.rig.bubbleLeft = 2.2;
  }

  /** 摇杆输入：x 向右，y 向前，长度不超过 1 */
  setStick(x: number, y: number): void {
    this.stick.set(x, y);
    if (this.stick.lengthSq() > 1) this.stick.normalize();
  }

  rotateCamera(dx: number, dy: number): void {
    this.yaw -= dx * 0.008;
    this.pitch = clamp(this.pitch + dy * 0.005, -0.05, 1.1);
  }

  /** 跳跃键：地上起跳；空中打开风之翼；滑翔时收起 */
  pressJump(): void {
    if (this.frozen || this.falling >= 0) return;
    if (this.grounded || this.sinceGround < COYOTE) {
      this.jump();
    } else if (!this.gliding && this.sinceJump > 0.18) {
      this.gliding = true;
      sfx.glide(true);
    } else if (this.gliding) {
      this.gliding = false;
      sfx.glide(false);
    } else {
      this.jumpBuffer = JUMP_BUFFER;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.renderer.domElement.removeEventListener("wheel", this.onWheel);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry);
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    });
    this.gradient.dispose();
    this.glowTex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // =====================================================================
  // 输入
  // =====================================================================

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (k === " ") {
      e.preventDefault();
      if (!e.repeat) this.pressJump();
      return;
    }
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      e.preventDefault();
      this.keys.add(k);
    }
    if (k === "q") this.yaw += 0.15;
    if (k === "e") this.yaw -= 0.15;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => {
    this.keys.clear();
    this.stick.set(0, 0);
  };

  private onWheel = (e: WheelEvent) => {
    this.dist = clamp(this.dist + e.deltaY * 0.01, 4, 13);
  };

  private inputVector(): THREE.Vector2 {
    if (this.stick.lengthSq() > 0.0001) return this.stick.clone();
    const v = new THREE.Vector2();
    if (this.keys.has("w") || this.keys.has("arrowup")) v.y += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) v.y -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) v.x += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) v.x -= 1;
    if (v.lengthSq() > 1) v.normalize();
    return v;
  }

  // =====================================================================
  // 物理：圆柱体角色 vs 方块 / 圆柱地形
  // =====================================================================

  private solids(): QuestSolid[] {
    const list = [...QUEST_SOLIDS, ...this.decorSolids];
    if (!this.gateOpen) list.push(QUEST_GATE);
    return list;
  }

  /** 脚下最高的可站立面。只考虑顶面不高于 maxY 的实体 */
  private ground(x: number, z: number, maxY: number, solids: QuestSolid[]): { y: number; solid: QuestSolid | null } {
    let best = -Infinity;
    let hit: QuestSolid | null = null;
    const edge = RADIUS * 0.45; // 站在边缘时允许半只脚悬空
    for (const s of solids) {
      let top: number;
      if (s.kind === "box") {
        if (x < s.min[0] - edge || x > s.max[0] + edge || z < s.min[2] - edge || z > s.max[2] + edge) continue;
        top = s.max[1];
      } else {
        if (Math.hypot(x - s.x, z - s.z) > s.r + edge) continue;
        top = s.top;
      }
      if (top <= maxY && top > best) {
        best = top;
        hit = s;
      }
    }
    return { y: best, solid: hit };
  }

  /** 把角色从墙里推出来（只处理高出脚面一个台阶以上的实体） */
  private pushOut(p: THREE.Vector3, solids: QuestSolid[]): void {
    for (const s of solids) {
      const top = s.kind === "box" ? s.max[1] : s.top;
      const bottom = s.kind === "box" ? s.min[1] : s.bottom;
      if (top <= p.y + STEP || bottom >= p.y + HEIGHT) continue;
      if (s.kind === "box") {
        const cx = clamp(p.x, s.min[0], s.max[0]);
        const cz = clamp(p.z, s.min[2], s.max[2]);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= RADIUS) continue;
        if (d > 1e-5) {
          p.x = cx + (dx / d) * RADIUS;
          p.z = cz + (dz / d) * RADIUS;
        } else {
          // 圆心已经在方块里：从最近的一边推出去
          const pen = [p.x - s.min[0], s.max[0] - p.x, p.z - s.min[2], s.max[2] - p.z];
          const i = pen.indexOf(Math.min(...pen));
          if (i === 0) p.x = s.min[0] - RADIUS;
          else if (i === 1) p.x = s.max[0] + RADIUS;
          else if (i === 2) p.z = s.min[2] - RADIUS;
          else p.z = s.max[2] + RADIUS;
        }
      } else {
        const dx = p.x - s.x;
        const dz = p.z - s.z;
        const d = Math.hypot(dx, dz);
        const min = s.r + RADIUS;
        if (d >= min) continue;
        const nx = d > 1e-5 ? dx / d : 0;
        const nz = d > 1e-5 ? dz / d : 1;
        p.x = s.x + nx * min;
        p.z = s.z + nz * min;
      }
    }
  }

  private jump(): void {
    this.vel.y = JUMP_V;
    this.grounded = false;
    this.gliding = false;
    this.sinceGround = COYOTE;
    this.sinceJump = 0;
    this.jumpBuffer = 0;
    sfx.hop();
  }

  private stepLocal(dt: number, slimeTime: number): void {
    const solids = this.solids();
    const input = this.frozen || this.falling >= 0 ? new THREE.Vector2() : this.inputVector();

    // 摄像机坐标系下的方向 → 世界坐标
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let tx = (rx * input.x + fx * input.y) * (this.gliding ? GLIDE_SPEED : RUN_SPEED);
    let tz = (rz * input.x + fz * input.y) * (this.gliding ? GLIDE_SPEED : RUN_SPEED);
    if (this.gliding && input.lengthSq() < 0.01) {
      // 滑翔时不推摇杆也会缓慢向前飘
      tx = Math.sin(this.ry) * 2.5;
      tz = Math.cos(this.ry) * 2.5;
    }
    const accel = this.grounded ? 16 : this.gliding ? 3.5 : 5;
    const k = Math.min(1, accel * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    this.vel.y -= GRAVITY * dt;
    if (this.gliding && this.vel.y < -GLIDE_FALL) this.vel.y += (-GLIDE_FALL - this.vel.y) * Math.min(1, 7 * dt);
    this.vel.y = Math.max(this.vel.y, -MAX_FALL);

    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pushOut(this.pos, solids);

    const nextY = prevY + this.vel.y * dt;
    // 用上一帧的高度找地面：下落再快也不会穿过薄的桥面；比脚高一个台阶以内的面可以直接踩上去
    const g = this.ground(this.pos.x, this.pos.z, prevY + STEP, solids);
    const wasGrounded = this.grounded;
    const landingVy = this.vel.y;
    if (this.vel.y <= 0 && nextY <= g.y) {
      this.pos.y = g.y;
      this.vel.y = 0;
      this.grounded = true;
      if (this.gliding) sfx.glide(false);
      this.gliding = false;
      if (!wasGrounded && landingVy < -7) sfx.land();
      if (this.jumpBuffer > 0) this.jump();
    } else if (wasGrounded && this.vel.y <= 0 && prevY > g.y && prevY - g.y < STEP) {
      // 走下小台阶时贴地，不要每次都腾空
      this.pos.y = g.y;
      this.vel.y = 0;
    } else {
      this.pos.y = nextY;
      this.grounded = false;
    }

    if (this.grounded) {
      this.sinceGround = 0;
      // 站在哪座岛上就把检查点记在哪
      if (g.solid && g.solid.kind === "cyl" && g.solid.look === "island") {
        const idx = QUEST_ISLANDS.findIndex((i) => i.x === (g.solid as Cyl).x && i.z === (g.solid as Cyl).z);
        if (idx > this.checkpoint) this.checkpoint = idx;
      }
    } else {
      this.sinceGround += dt;
    }
    this.sinceJump += dt;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.knockCooldown = Math.max(0, this.knockCooldown - dt);

    // 被史莱姆撞到弹开
    if (this.knockCooldown <= 0 && this.falling < 0) {
      for (let i = 0; i < QUEST_SLIMES.length; i++) {
        const s = questSlimePos(i, slimeTime);
        const dx = this.pos.x - s.x;
        const dz = this.pos.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.95 && Math.abs(this.pos.y - s.y) < 1.1) {
          const nx = d > 1e-4 ? dx / d : 0;
          const nz = d > 1e-4 ? dz / d : 1;
          this.vel.set(nx * 10, 7, nz * 10);
          this.grounded = false;
          this.gliding = false;
          this.knockCooldown = 0.8;
          sfx.boing();
          vibrate(40);
          break;
        }
      }
    }

    // 面朝移动方向
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.6 && !this.frozen) this.ry = angleLerp(this.ry, Math.atan2(this.vel.x, this.vel.z), damp(12, dt));

    // 掉出地图：先继续掉一会儿（顺便让服务端记一次），再回检查点
    if (this.falling < 0 && this.pos.y < QUEST_FALL_Y) {
      this.falling = 0;
      this.hooks.onFall();
      sfx.fall();
      vibrate([60, 40, 60]);
    }
    if (this.falling >= 0) {
      this.falling += dt;
      if (this.falling > 0.7) {
        const [x, y, z] = QUEST_ISLANDS[this.checkpoint]!.respawn;
        this.pos.set(x, y + 0.5, z);
        this.vel.set(0, 0, 0);
        this.gliding = false;
        this.grounded = false;
        this.falling = -1;
        this.yaw = 0;
      }
    }

    const air: QuestAirState = this.grounded ? "ground" : this.gliding ? "glide" : "air";
    if (air !== this.airState) {
      this.airState = air;
      this.hooks.onAirState(air);
    }
  }

  private localAnim(): QuestMove["anim"] {
    if (this.grounded) return Math.hypot(this.vel.x, this.vel.z) > 0.6 ? 1 : 0;
    return this.gliding ? 3 : 2;
  }

  private maybeSend(dt: number): void {
    this.sendTimer += dt;
    if (this.sendTimer < SEND_INTERVAL || this.frozen) return;
    this.sendTimer = 0;
    const m: QuestMove = { x: this.pos.x, y: this.pos.y, z: this.pos.z, ry: this.ry, anim: this.localAnim() };
    const last = this.lastSent;
    const now = this.time;
    const moved =
      !last ||
      Math.abs(last.x - m.x) + Math.abs(last.y - m.y) + Math.abs(last.z - m.z) > 0.02 ||
      Math.abs(last.ry - m.ry) > 0.05 ||
      last.anim !== m.anim;
    if (moved || now - this.lastSentAt > 1) {
      this.lastSent = m;
      this.lastSentAt = now;
      this.hooks.onMove(m);
    }
  }

  // =====================================================================
  // 每帧
  // =====================================================================

  private frame = () => {
    if (this.disposed) return;
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    this.adaptQuality(raw);
    const slimeTime = (Date.now() + this.clockOffset - this.startedAt) / 1000;

    if (this.placed) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
      for (let i = 0; i < steps; i++) this.stepLocal(dt / steps, slimeTime);
      this.maybeSend(dt);
    }

    // 自己的角色直接用本地状态，其他人插值
    for (const a of this.avatars.values()) {
      let speed: number;
      if (a.id === this.me) {
        a.pos.copy(this.pos);
        a.ry = this.ry;
        a.anim = this.localAnim();
        speed = Math.hypot(this.vel.x, this.vel.z);
        a.rig.root.visible = this.placed;
      } else {
        const before = a.pos.clone();
        a.pos.lerp(a.target, damp(10, dt));
        a.ry = angleLerp(a.ry, a.targetRy, damp(10, dt));
        speed = before.distanceTo(a.pos) / Math.max(dt, 1e-3);
        a.rig.root.visible = a.hasTarget;
      }
      a.rig.root.position.copy(a.pos);
      a.rig.model.rotation.y = a.ry;
      this.animateRig(a, dt, speed);
    }

    this.updateWorld(dt, slimeTime);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private updateWorld(dt: number, slimeTime: number): void {
    const t = this.time;

    this.crystals.forEach((c, i) => {
      if (c.vanish >= 0) {
        if (c.vanish > 1) {
          c.group.visible = false;
          return;
        }
        c.vanish += dt * 2.5;
        c.group.scale.setScalar(1 + c.vanish * 1.5);
        c.group.position.y += dt * 3;
        c.group.rotation.y += dt * 12;
        return;
      }
      c.group.rotation.y = t * 1.6 + i;
      c.group.position.y = QUEST_CRYSTALS[i]!.y + 0.95 + Math.sin(t * 2.4 + i) * 0.12;
    });

    // 结界：打开后慢慢消失
    this.gateFade += ((this.gateOpen ? 0 : 1) - this.gateFade) * damp(2.5, dt);
    this.gateMesh.material.uniforms.t!.value = t;
    this.gateMesh.material.uniforms.fade!.value = this.gateFade;
    this.gateMesh.visible = this.gateFade > 0.02;
    this.gateRing.visible = this.gateFade > 0.02;
    this.gateRing.rotation.z = t * 0.8;
    this.gateRing.scale.setScalar(1 + (1 - this.gateFade) * 2);
    (this.gateRing.material as THREE.MeshBasicMaterial).opacity = this.gateFade;

    this.plateRings.forEach((ring, i) => {
      const lit = this.platesLit[i];
      ring.material.color.setHex(lit ? 0xffd36b : 0x7ff6ff);
      ring.rotation.z = t * (lit ? 2 : 0.5);
      ring.material.opacity = lit ? 1 : 0.55 + Math.sin(t * 3) * 0.25;
      const beam = this.plateBeams[i]!;
      beam.visible = !this.gateOpen;
      (beam.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0xffd36b : 0x7ff6ff);
    });

    this.slimes.forEach((g, i) => {
      const p = questSlimePos(i, slimeTime);
      const next = questSlimePos(i, slimeTime + 0.05);
      const hop = Math.abs(Math.sin(slimeTime * 4.5 + i));
      g.position.set(p.x, p.y + hop * 0.45, p.z);
      g.rotation.y = Math.atan2(next.x - p.x, next.z - p.z);
      const body = g.getObjectByName("body")!;
      const squash = 1 - (1 - hop) * 0.25;
      body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    });

    this.goalCrystal.rotation.y = t * 0.9;
    this.goalCrystal.position.y = QUEST_GOAL.y + 6.6 + Math.sin(t * 1.5) * 0.25;
    this.goalRing.material.opacity = 0.45 + this.goalProgress * 0.5 + Math.sin(t * 3) * 0.08;
    this.goalRing.rotation.z = t * 0.3;
    this.goalBeam.material.opacity = 0.18 + this.goalProgress * 0.25;

    this.clouds.position.x = Math.sin(t * 0.03) * 6;
    this.motes.position.y = Math.sin(t * 0.4) * 0.4;
    this.motes.rotation.y = Math.sin(t * 0.05) * 0.02;
  }

  private updateCamera(dt: number): void {
    // 跟随目标稍微滞后，跳跃时镜头不那么晃
    const target = this.pos.clone();
    target.y += 1.3;
    this.camTarget.x += (target.x - this.camTarget.x) * damp(10, dt);
    this.camTarget.z += (target.z - this.camTarget.z) * damp(10, dt);
    this.camTarget.y += (target.y - this.camTarget.y) * damp(this.grounded ? 8 : 3, dt);
    if (this.falling >= 0) this.camTarget.y = Math.max(this.camTarget.y, QUEST_FALL_Y + 4);

    const d = this.gliding ? this.dist + 1.5 : this.dist;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.camTarget.x + Math.sin(this.yaw) * cp * d,
      this.camTarget.y + Math.sin(this.pitch) * d + 0.6,
      this.camTarget.z + Math.cos(this.yaw) * cp * d,
    );
    this.camera.lookAt(this.camTarget);
    this.sky.position.copy(this.camera.position);

    // 阴影相机跟着角色走，只覆盖附近一小块，省性能
    this.sun.position.set(this.pos.x + 12, this.pos.y + 24, this.pos.z + 6);
    this.sun.target.position.copy(this.pos);
  }

  /** 连续一段时间帧率过低就降低分辨率、关掉阴影 */
  private adaptQuality(raw: number): void {
    if (this.lowQuality) return;
    this.frameTimes.push(raw);
    if (this.frameTimes.length < 120) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 35) {
      this.lowQuality = true;
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
      this.resize();
    }
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 竖屏手机视野放宽一点
    this.camera.fov = w < h ? 68 : 55;
    this.camera.updateProjectionMatrix();
  }
}
