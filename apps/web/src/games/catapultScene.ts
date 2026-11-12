import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  CF_ARENA,
  CF_BLOCK,
  CF_CELL,
  CF_COLS,
  CF_GRAVITY,
  CF_ROWS,
  CF_SOLDIER_HALF,
  CF_STONE_R,
  cfBuildBodies,
  cfFrame,
  cfLaunchPoint,
  cfLaunchVelocity,
  type CfAim,
  type CfBody,
  type CfBuild,
  type CfFrame,
  type CfShot,
} from "@party/shared";
import { CatapultSim, cfSoldierDown } from "@party/shared/catapult-sim";

/**
 * 投石大战的 3D 场景。平时物体位置完全由服务端下发；
 * 有人发射时，用和服务端同一套物理从“发射前”的状态重放一遍，播完再平滑对齐服务端的结果。
 */

export interface CfSceneHooks {
  onImpact: (kind: "ground" | "block" | "soldier", speed: number) => void;
  onSoldierDown: (owner: string) => void;
  onSettled: () => void;
}

const SIM_STEP = 1 / 60;
const TRAIL_MAX = 200;

interface Rig {
  obj: THREE.Object3D;
  def: CfBody;
}

/** 由数字算出的固定伪随机数，装饰物的位置所有人看到的一样 */
function hash01(n: number, salt: number): number {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function makeStoneTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9c2b4";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) {
    const v = 150 + Math.random() * 80;
    g.fillStyle = `rgba(${v},${v - 6},${v - 18},${0.25 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  // 砖缝
  g.strokeStyle = "rgba(90,80,65,0.55)";
  g.lineWidth = 3;
  g.strokeRect(2, 2, 124, 124);
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(128, 64);
  g.moveTo(64, 0);
  g.lineTo(64, 64);
  g.moveTo(32, 64);
  g.lineTo(32, 128);
  g.moveTo(96, 64);
  g.lineTo(96, 128);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(256, 256, 30, 256, 256, 256);
  grad.addColorStop(0, "#9ccc65");
  grad.addColorStop(0.8, "#7cb342");
  grad.addColorStop(1, "#5d8f2f");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2500; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? "rgba(70,120,30,0.25)" : "rgba(190,230,120,0.2)";
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 3 + Math.random() * 4);
  }
  // 中间的土路
  g.fillStyle = "rgba(170,140,90,0.35)";
  g.beginPath();
  g.ellipse(256, 256, 60, 60, 0, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSoldier(color: string): THREE.Group {
  const g = new THREE.Group();
  const H = CF_SOLDIER_HALF.y;
  const W = CF_SOLDIER_HALF.x;
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.3, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b2f2f, roughness: 0.8 });
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.75, W * 0.8, H * 0.7, 10), dark);
  legs.position.y = -H + H * 0.35;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.85, W, H * 0.8, 12), cloth);
  body.position.y = -H + H * 0.7 + H * 0.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(W * 0.72, 14, 10), skin);
  head.position.y = H - W * 0.95;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(W * 0.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  helmet.position.y = head.position.y + W * 0.08;
  const plume = new THREE.Mesh(new THREE.ConeGeometry(W * 0.25, W * 0.8, 8), cloth);
  plume.position.y = helmet.position.y + W * 0.9;
  const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, H * 2.3, 6), dark);
  spear.position.set(W * 1.2, 0, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 6), metal);
  tip.position.y = H * 1.2;
  spear.add(tip);
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.75, W * 0.75, 0.04, 14), cloth);
  shield.rotation.x = Math.PI / 2;
  shield.position.set(-W * 0.4, 0, W * 0.95);
  g.add(legs, body, head, helmet, plume, spear, shield);
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

interface CatapultRig {
  group: THREE.Group;
  arm: THREE.Group;
  frame: CfFrame;
  swing: number;
  yaw: number;
}

const ARM_REST = -1.15;
const ARM_FIRE = 0.35;

function makeCatapult(color: string): { group: THREE.Group; arm: THREE.Group } {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8d5a2b, roughness: 0.85 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x5d3a1a, roughness: 0.9 });
  const flagMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 2.6), wood);
    rail.position.set(s * 0.7, 0.45, 0);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.18), wood);
    post.position.set(s * 0.7, 1.5, 0.1);
    post.rotation.x = -0.08;
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.9, 0.14), darkWood);
    brace.position.set(s * 0.7, 1.15, -0.55);
    brace.rotation.x = 0.55;
    group.add(rail, post, brace);
    for (const z of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 16), darkWood);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(s * 0.88, 0.42, z * 0.95);
      group.add(wheel);
    }
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 10), darkWood);
  axle.rotation.z = Math.PI / 2;
  axle.position.y = 2.5;
  const stop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.18), wood);
  stop.position.set(0, 2.55, 0.35);
  group.add(axle, stop);

  // 投石臂绕横轴转：静止时往后倒，发射时甩到前面
  const arm = new THREE.Group();
  arm.position.y = 2.5;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.4, 0.16), wood);
  beam.position.y = 1.2;
  const bucket = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), darkWood);
  bucket.position.y = 2.9;
  bucket.rotation.x = Math.PI / 2;
  const weight = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x6d6d6d, roughness: 0.6 }));
  weight.position.y = -0.55;
  arm.add(beam, bucket, weight);
  arm.rotation.x = ARM_REST;
  group.add(arm);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), darkWood);
  pole.position.set(-0.9, 1.6, -1.2);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), flagMat);
  flag.position.set(-0.5, 2.4, -1.2);
  group.add(pole, flag);
  group.traverse((o) => (o.castShadow = true));
  return { group, arm };
}

export class CatapultScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private blockGeo = new RoundedBoxGeometry(CF_BLOCK, CF_BLOCK, CF_BLOCK, 2, 0.06);
  private stoneTex = makeStoneTexture();
  private blockMats = new Map<string, THREE.MeshStandardMaterial>();
  private rigs = new Map<number, Rig>();
  private plots = new THREE.Group();
  private catapults = new Map<string, CatapultRig>();
  private stone: THREE.Mesh;
  private trail: THREE.Points;
  private trailPos: Float32Array;
  private trailN = 0;
  private arc: THREE.InstancedMesh;
  private dust: { mesh: THREE.Mesh; t: number }[] = [];
  private fading: { obj: THREE.Object3D; t: number }[] = [];
  private clock = new THREE.Clock();
  private time = 0;
  private resizeObserver: ResizeObserver;

  private order: string[] = [];
  private colors: Record<string, string> = {};
  private me = "";
  private homeTarget = new THREE.Vector3(0, 1, 0);

  private sim: CatapultSim | null = null;
  private simShot: CfShot | null = null;
  private simAcc = 0;
  private downNotified = new Set<number>();
  private settle: { from: Map<number, { p: THREE.Vector3; q: THREE.Quaternion }>; t: number } | null = null;
  private finalBodies: CfBody[] = [];

  constructor(
    private container: HTMLElement,
    private hooks: CfSceneHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.camera.position.set(0, 14, 26);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.target.set(0, 1, 0);

    this.buildWorld();
    this.scene.add(this.plots);

    this.stone = new THREE.Mesh(
      new THREE.SphereGeometry(CF_STONE_R, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x5a5550, roughness: 0.9, flatShading: true }),
    );
    this.stone.castShadow = true;
    this.stone.visible = false;
    this.scene.add(this.stone);

    this.trailPos = new Float32Array(TRAIL_MAX * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ color: 0xfff3c4, size: 0.18, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    this.arc = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
      40,
    );
    this.arc.count = 0;
    this.arc.frustumCulled = false;
    this.scene.add(this.arc);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.frame);
  }

  private buildWorld(): void {
    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x5d7a3a, 1.2));
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.3);
    sun.position.set(14, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -24;
    sc.right = sc.top = 24;
    sc.near = 1;
    sc.far = 80;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(CF_ARENA + 4, 64), new THREE.MeshStandardMaterial({ map: makeGrassTexture(), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const cliff = new THREE.Mesh(
      new THREE.CylinderGeometry(CF_ARENA + 4, CF_ARENA + 1, 3, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 }),
    );
    cliff.position.y = -1.5;
    this.scene.add(cliff);

    // 场地外圈的树和石头，只是装饰
    const trunk = new THREE.MeshStandardMaterial({ color: 0x6d4c2f });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7d2c, roughness: 0.9, flatShading: true });
    const rock = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 1, flatShading: true });
    for (let i = 0; i < 46; i++) {
      const a = hash01(i, 1) * Math.PI * 2;
      const r = 21 + hash01(i, 2) * (CF_ARENA - 19);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (hash01(i, 3) < 0.7) {
        const s = 0.8 + hash01(i, 4) * 0.9;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.2 * s, 1 * s, 6), trunk);
        t.position.set(x, 0.5 * s, z);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 2.2 * s, 7), leaf);
        crown.position.y = 1.5 * s;
        t.add(crown);
        t.traverse((o) => (o.castShadow = true));
        this.scene.add(t);
      } else {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + hash01(i, 5) * 0.6), rock);
        m.position.set(x, 0.2, z);
        m.rotation.set(hash01(i, 6) * 3, hash01(i, 7) * 3, 0);
        m.castShadow = true;
        this.scene.add(m);
      }
    }
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private blockMat(owner: string): THREE.MeshStandardMaterial {
    let m = this.blockMats.get(owner);
    if (m) return m;
    const tint = new THREE.Color(this.colors[owner] ?? "#999").lerp(new THREE.Color(0xffffff), 0.72);
    m = new THREE.MeshStandardMaterial({ map: this.stoneTex, color: tint, roughness: 0.85 });
    this.blockMats.set(owner, m);
    return m;
  }

  private rig(def: CfBody): Rig {
    let r = this.rigs.get(def.id);
    if (r && r.def.owner === def.owner && r.def.kind === def.kind) return r;
    if (r) this.scene.remove(r.obj);
    let obj: THREE.Object3D;
    if (def.kind === "block") {
      const mesh = new THREE.Mesh(this.blockGeo, this.blockMat(def.owner));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      obj = mesh;
    } else {
      obj = makeSoldier(this.colors[def.owner] ?? "#999");
    }
    this.scene.add(obj);
    r = { obj, def };
    this.rigs.set(def.id, r);
    return r;
  }

  private place(def: CfBody): void {
    const r = this.rig(def);
    r.def = def;
    r.obj.position.set(def.p[0], def.p[1], def.p[2]);
    r.obj.quaternion.set(def.q[0], def.q[1], def.q[2], def.q[3]);
    r.obj.visible = true;
  }

  /** 场上的人和地块：每人一块地、一台投石机 */
  setPlayers(order: string[], colors: Record<string, string>, me: string): void {
    const key = order.join(",");
    if (key === this.order.join(",") && me === this.me) return;
    this.order = order;
    this.colors = colors;
    this.me = me;
    this.plots.clear();
    for (const [, c] of this.catapults) this.scene.remove(c.group);
    this.catapults.clear();
    const n = order.length;
    order.forEach((id, seat) => {
      const frame = cfFrame(seat, n);
      const yaw = Math.atan2(frame.fx, frame.fz);
      const plot = new THREE.Mesh(
        new THREE.BoxGeometry(CF_COLS * CF_CELL + 1.2, 0.08, CF_ROWS * CF_CELL + 1.2),
        new THREE.MeshStandardMaterial({ color: 0xa7865a, roughness: 1 }),
      );
      plot.position.set(frame.x, 0.0, frame.z);
      plot.rotation.y = yaw;
      plot.receiveShadow = true;
      const border = new THREE.Mesh(
        new THREE.BoxGeometry(CF_COLS * CF_CELL + 1.6, 0.06, CF_ROWS * CF_CELL + 1.6),
        new THREE.MeshStandardMaterial({ color: colors[id] ?? "#999", roughness: 0.8 }),
      );
      border.position.set(frame.x, -0.005, frame.z);
      border.rotation.y = yaw;
      this.plots.add(border, plot);

      const { group, arm } = makeCatapult(colors[id] ?? "#999");
      const lp = cfLaunchPoint(frame);
      group.position.set(lp.x - frame.fx * 0.4, 0, lp.z - frame.fz * 0.4);
      group.rotation.y = yaw;
      this.scene.add(group);
      this.catapults.set(id, { group, arm, frame, swing: -1, yaw: 0 });
    });
  }

  private myFrame(): CfFrame | null {
    return this.catapults.get(this.me)?.frame ?? null;
  }

  /** 镜头放到自己投石机后上方，看向场地中央 */
  resetCamera(focusPlot = false): void {
    const f = this.myFrame();
    if (!f) return;
    if (focusPlot) {
      this.homeTarget.set(f.x, 1.2, f.z);
      this.camera.position.set(f.x - f.fx * 7 + f.fz * 3, 6.5, f.z - f.fz * 7 - f.fx * 3);
    } else {
      this.homeTarget.set(f.x * 0.25, 1, f.z * 0.25);
      this.camera.position.set(f.x - f.fx * 9, 10, f.z - f.fz * 9);
    }
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
  }

  /** 搭建阶段：只显示自己正在搭的城堡 */
  setPreview(build: CfBuild | null): void {
    const f = this.myFrame();
    const bodies = f && build ? cfBuildBodies(this.me, f, build, 0) : [];
    this.showOnly(bodies);
  }

  /** 对战阶段：没在播放动画时直接摆到服务端的位置 */
  setBodies(bodies: CfBody[]): void {
    this.finalBodies = bodies;
    if (this.sim || this.settle) return;
    this.showOnly(bodies);
  }

  private showOnly(bodies: CfBody[]): void {
    const keep = new Set(bodies.map((b) => b.id));
    for (const [id, r] of this.rigs) {
      if (!keep.has(id)) {
        this.scene.remove(r.obj);
        this.rigs.delete(id);
      }
    }
    for (const b of bodies) this.place(b);
  }

  /** 瞄准预览：显示前 40% 的飞行路线，并把投石机转过去 */
  setAim(aim: CfAim | null): void {
    const c = this.catapults.get(this.me);
    if (!aim || !c) {
      this.arc.count = 0;
      return;
    }
    c.yaw = (aim.yaw * Math.PI) / 180;
    const p = cfLaunchPoint(c.frame);
    const v = cfLaunchVelocity(c.frame, aim);
    // 落地时间：p.y + vy t - g t² / 2 = 0
    const T = (v[1] + Math.sqrt(v[1] * v[1] + 2 * CF_GRAVITY * p.y)) / CF_GRAVITY;
    const n = 16;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const t = ((i + 1) / n) * T * 0.4;
      m.makeTranslation(p.x + v[0] * t, p.y + v[1] * t - 0.5 * CF_GRAVITY * t * t, p.z + v[2] * t);
      this.arc.setMatrixAt(i, m);
    }
    this.arc.count = n;
    this.arc.instanceMatrix.needsUpdate = true;
  }

  get playing(): boolean {
    return this.sim !== null || this.settle !== null;
  }

  playShot(shot: CfShot): void {
    this.arc.count = 0;
    this.settle = null;
    this.showOnly(shot.before);
    const sim = new CatapultSim(shot.before, shot.from, shot.vel);
    sim.onImpact = (speed, kind) => {
      this.hooks.onImpact(kind, speed);
      this.puff(new THREE.Vector3(sim.stone.position.x, Math.max(0.2, sim.stone.position.y), sim.stone.position.z));
    };
    this.sim = sim;
    this.simShot = shot;
    this.simAcc = 0;
    this.downNotified.clear();
    this.trailN = 0;
    this.stone.visible = true;
    this.stone.position.set(...shot.from);
    const c = this.catapults.get(shot.shooterId);
    if (c) {
      c.swing = 0;
      c.yaw = (shot.aim.yaw * Math.PI) / 180;
    }
  }

  private puff(at: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.35 + Math.random() * 0.3, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xd8c8a8, transparent: true, opacity: 0.8, roughness: 1 }),
      );
      m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.6, (Math.random() - 0.5) * 1.2));
      this.scene.add(m);
      this.dust.push({ mesh: m, t: 0 });
    }
  }

  private finishSim(): void {
    const sim = this.sim!;
    this.sim = null;
    this.simShot = null;
    this.stone.visible = false;
    this.trailN = 0;
    this.trail.geometry.setDrawRange(0, 0);
    // 服务端结果里没有的就是阵亡的士兵（或者飞出场地的砖），慢慢沉下去消失
    const final = new Map(this.finalBodies.map((b) => [b.id, b]));
    const from = new Map<number, { p: THREE.Vector3; q: THREE.Quaternion }>();
    for (const { def } of sim.bodies) {
      const r = this.rigs.get(def.id);
      if (!r) continue;
      if (final.has(def.id)) from.set(def.id, { p: r.obj.position.clone(), q: r.obj.quaternion.clone() });
      else {
        this.rigs.delete(def.id);
        this.fading.push({ obj: r.obj, t: 0 });
      }
    }
    this.settle = { from, t: 0 };
  }

  private frame = (): void => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    if (this.sim) {
      const sim = this.sim;
      this.simAcc += dt;
      let steps = 0;
      while (this.simAcc >= SIM_STEP && !sim.done && steps++ < 4) {
        this.simAcc -= SIM_STEP;
        sim.step();
      }
      for (const { def, body } of sim.bodies) {
        const r = this.rigs.get(def.id);
        if (!r) continue;
        r.obj.position.set(body.position.x, body.position.y, body.position.z);
        r.obj.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
      // 士兵倒下的那一刻提示一下（只提示服务端判定阵亡的）
      const shot = this.simShot!;
      for (const k of shot.killed) {
        if (this.downNotified.has(k.id)) continue;
        const b = sim.bodies.find((x) => x.def.id === k.id);
        if (!b) continue;
        const snap: CfBody = {
          ...b.def,
          p: [b.body.position.x, b.body.position.y, b.body.position.z],
          q: [b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w],
        };
        if (cfSoldierDown(snap)) {
          this.downNotified.add(k.id);
          this.hooks.onSoldierDown(k.owner);
        }
      }
      if (sim.stoneGone) this.stone.visible = false;
      else {
        this.stone.position.set(sim.stone.position.x, sim.stone.position.y, sim.stone.position.z);
        this.stone.quaternion.set(sim.stone.quaternion.x, sim.stone.quaternion.y, sim.stone.quaternion.z, sim.stone.quaternion.w);
        if (this.trailN < TRAIL_MAX) {
          this.trailPos.set([sim.stone.position.x, sim.stone.position.y, sim.stone.position.z], this.trailN * 3);
          this.trailN++;
          this.trail.geometry.attributes.position!.needsUpdate = true;
          this.trail.geometry.setDrawRange(0, this.trailN);
        }
      }
      // 镜头跟着石弹走
      const focus = sim.stoneGone ? this.homeTarget : this.stone.position;
      this.controls.target.lerp(focus, Math.min(1, dt * 2.5));
      if (sim.done) this.finishSim();
    } else if (this.settle) {
      this.settle.t += dt;
      const k = Math.min(1, this.settle.t / 0.35);
      for (const b of this.finalBodies) {
        const r = this.rigs.get(b.id);
        const from = this.settle.from.get(b.id);
        if (!r) continue;
        const p = new THREE.Vector3(...b.p);
        const q = new THREE.Quaternion(...b.q);
        if (from) {
          r.obj.position.lerpVectors(from.p, p, k);
          r.obj.quaternion.slerpQuaternions(from.q, q, k);
        } else {
          r.obj.position.copy(p);
          r.obj.quaternion.copy(q);
        }
      }
      this.controls.target.lerp(this.homeTarget, Math.min(1, dt * 2.5));
      if (k >= 1) {
        this.settle = null;
        this.showOnly(this.finalBodies);
        this.hooks.onSettled();
      }
    } else {
      this.controls.target.lerp(this.homeTarget, Math.min(1, dt * 1.5));
    }
    this.controls.update();

    for (const [, c] of this.catapults) {
      if (c.swing >= 0) {
        c.swing += dt;
        // 先猛地甩出去，再慢慢收回来
        const t = c.swing;
        c.arm.rotation.x = t < 0.18 ? ARM_REST + (ARM_FIRE - ARM_REST) * (t / 0.18) : ARM_FIRE + (ARM_REST - ARM_FIRE) * Math.min(1, (t - 0.6) / 1.2) * Number(t > 0.6);
        if (t > 1.8) c.swing = -1;
      }
      const baseYaw = Math.atan2(c.frame.fx, c.frame.fz);
      c.group.rotation.y += (baseYaw - c.yaw - c.group.rotation.y) * Math.min(1, dt * 6);
    }

    this.dust = this.dust.filter((d) => {
      d.t += dt;
      d.mesh.position.y += dt * 0.8;
      d.mesh.scale.setScalar(1 + d.t * 2);
      (d.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.8 - d.t);
      if (d.t > 0.8) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
    this.fading = this.fading.filter((f) => {
      f.t += dt;
      f.obj.position.y -= dt * 0.6;
      f.obj.scale.setScalar(Math.max(0.01, 1 - f.t / 1.2));
      if (f.t > 1.2) {
        this.scene.remove(f.obj);
        return false;
      }
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material & { map?: THREE.Texture | null };
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.stoneTex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
