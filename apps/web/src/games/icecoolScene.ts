import * as THREE from "three";
import {
  IC_D,
  IC_DOORS,
  IC_MAX_SPEED,
  IC_PENGUIN_R,
  IC_ROOMS,
  IC_W,
  IC_WALL_H,
  IC_WALL_T,
  IC_WALLS,
  IcecoolSim,
  type IcFlick,
  type IcPiece,
  type IcShot,
  type IcSimEvent,
} from "@party/shared";

/**
 * 冰企鹅的 3D 场景。俯视角看整个企鹅学校，企鹅位置平时完全由服务端下发；
 * 有人弹企鹅时，用和服务端同一套物理（IcecoolSim）从“弹之前”的位置重放一遍，最后对齐服务端结果。
 */

export interface IcSceneHooks {
  onFlick: (flick: IcFlick) => void;
  onAimChange: (power: number | null) => void;
  onSimEvent: (e: IcSimEvent, shot: IcShot) => void;
  onSettled: () => void;
}

export interface IcSceneState {
  pieces: IcPiece[];
  me: string;
  catcherId: string;
  currentId: string;
  colors: Record<string, string>;
  names: Record<string, string>;
  /** 每扇门上还挂着谁的鱼 */
  fishOnDoors: Map<number, string[]>;
  /** 我要抓的鱼在哪几扇门 */
  myDoors: number[];
  canAim: boolean;
  spin: number;
}

/** 从企鹅身边拉多远算满力 */
const MAX_PULL = 7;
const MIN_PULL = 0.8;
const GRAB_RADIUS = 3.2;
const SIM_STEP = 1 / 120;

const OX = -IC_W / 2;
const OZ = -IC_D / 2;

interface PenguinRig {
  group: THREE.Group;
  body: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  cap: THREE.Group;
  label: THREE.Sprite;
  color: string;
  name: string;
  heading: number;
  /** 上一帧的位置，用来算朝向和摇摆 */
  last: THREE.Vector2;
  wobble: number;
}

function makeFloorTexture(): THREE.CanvasTexture {
  const S = 40; // 每单位多少像素
  const c = document.createElement("canvas");
  c.width = IC_W * S;
  c.height = IC_D * S;
  const g = c.getContext("2d")!;
  const tints = ["#e6f6ff", "#eef9ff", "#e3f2fb", "#eaf7ff", "#e1f4fd", "#edf8ff"];
  IC_ROOMS.forEach((r, i) => {
    g.fillStyle = tints[i % tints.length]!;
    g.fillRect(r.x0 * S, r.z0 * S, (r.x1 - r.x0) * S, (r.z1 - r.z0) * S);
  });
  // 冰面上的划痕
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const len = 20 + Math.random() * 90;
    const a = Math.random() * Math.PI;
    g.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.4})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(140,200,235,${0.05 + Math.random() * 0.08})`;
    g.beginPath();
    g.ellipse(Math.random() * c.width, Math.random() * c.height, 30 + Math.random() * 80, 10 + Math.random() * 30, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold ${S * 1.15}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  g.fillStyle = "rgba(60,120,170,0.28)";
  for (const r of IC_ROOMS) g.fillText(r.name, ((r.x0 + r.x1) / 2) * S, ((r.z0 + r.z1) / 2) * S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = `bold 34px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const w = Math.min(250, g.measureText(text).width + 28);
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.beginPath();
  g.roundRect((256 - w) / 2, 6, w, 52, 26);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = "#1d2433";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(3.4, 0.85, 1);
  sprite.position.y = 2.9;
  sprite.renderOrder = 10;
  return sprite;
}

function makeFish(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, emissive: color, emissiveIntensity: 0.25 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 10), mat);
  body.scale.set(1.5, 0.75, 0.45);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 3), mat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.6;
  tail.scale.set(1, 1, 0.35);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  eye.position.set(0.28, 0.06, 0.13);
  g.add(body, tail, eye);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export class IcecoolScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private board = new THREE.Group();
  private penguins = new Map<string, PenguinRig>();
  private fishGroups = new Map<number, THREE.Group>();
  private mats = new Map<number, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  private aimArrow: THREE.Group;
  private aimShaft: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private aimHead: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private dots: THREE.InstancedMesh;
  private clock = new THREE.Clock();
  private time = 0;
  private resizeObserver: ResizeObserver;
  private state: IcSceneState | null = null;
  private fishKey = "";

  private sim: IcecoolSim | null = null;
  private simShot: IcShot | null = null;
  private simAcc = 0;
  private poppingFish: { mesh: THREE.Object3D; t: number }[] = [];
  private pendingFish: { playerId: string; door: number }[] = [];

  private aiming: { pointerId: number; pull: THREE.Vector2 } | null = null;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(
    private container: HTMLElement,
    private hooks: IcSceneHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.board.position.set(OX, 0, OZ);
    this.scene.add(this.board);
    this.buildWorld();

    this.aimShaft = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 0.32), new THREE.MeshBasicMaterial({ color: 0x27ae60, transparent: true, opacity: 0.9 }));
    this.aimHead = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 16), this.aimShaft.material);
    this.aimHead.rotation.z = -Math.PI / 2;
    this.aimArrow = new THREE.Group();
    this.aimArrow.add(this.aimShaft, this.aimHead);
    this.aimArrow.position.y = 0.12;
    this.aimArrow.visible = false;
    this.board.add(this.aimArrow);

    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
      24,
    );
    this.dots.count = 0;
    this.board.add(this.dots);

    const canvas = this.renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.handleDown);
    canvas.addEventListener("pointermove", this.handleMove);
    canvas.addEventListener("pointerup", this.handleUp);
    canvas.addEventListener("pointercancel", this.handleCancel);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.frame);
  }

  private buildWorld(): void {
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x7aa6c2, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-8, 26, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -20;
    sc.right = sc.top = 20;
    sc.near = 1;
    sc.far = 70;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    // 盒子底座
    const base = new THREE.Mesh(new THREE.BoxGeometry(IC_W + 2, 1, IC_D + 2), new THREE.MeshStandardMaterial({ color: 0x2b5c8a, roughness: 0.8 }));
    base.position.set(IC_W / 2, -0.51, IC_D / 2);
    base.receiveShadow = true;
    this.board.add(base);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(IC_W, IC_D),
      new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.18, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(IC_W / 2, 0, IC_D / 2);
    floor.receiveShadow = true;
    this.board.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf6efe2, roughness: 0.75 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x5aa0d0, roughness: 0.5 });
    for (const w of IC_WALLS) {
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len + IC_WALL_T, IC_WALL_H, IC_WALL_T), wallMat);
      mesh.position.set((w.ax + w.bx) / 2, IC_WALL_H / 2, (w.az + w.bz) / 2);
      mesh.rotation.y = -Math.atan2(w.bz - w.az, w.bx - w.ax);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len + IC_WALL_T + 0.04, 0.14, IC_WALL_T + 0.08), capMat);
      cap.position.y = IC_WALL_H / 2 + 0.07;
      mesh.add(cap);
      this.board.add(mesh);
    }

    // 门：两边加高的门柱，地上铺一块门垫
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3d7fb8, roughness: 0.4 });
    const postGeo = new THREE.CylinderGeometry(IC_WALL_T * 0.62, IC_WALL_T * 0.7, IC_WALL_H + 0.7, 16);
    for (const d of IC_DOORS) {
      for (const [x, z] of [
        [d.ax, d.az],
        [d.bx, d.bz],
      ] as const) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, (IC_WALL_H + 0.7) / 2, z);
        post.castShadow = true;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(IC_WALL_T * 0.75, 16, 10), postMat);
        ball.position.y = (IC_WALL_H + 0.7) / 2;
        post.add(ball);
        this.board.add(post);
      }
      const mat = new THREE.Mesh(
        new THREE.PlaneGeometry(d.vertical ? 2.2 : 3.2, d.vertical ? 3.2 : 2.2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
      );
      mat.rotation.x = -Math.PI / 2;
      mat.position.set(d.x, 0.02, d.z);
      this.board.add(mat);
      this.mats.set(d.id, mat);
      const fish = new THREE.Group();
      fish.position.set(d.x, 2.3, d.z);
      this.board.add(fish);
      this.fishGroups.set(d.id, fish);
    }
  }

  private makePenguin(id: string, color: string, name: string): PenguinRig {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2a3c, roughness: 0.45 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff9f1c, roughness: 0.5 });
    const tint = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });

    const trunk = new THREE.Mesh(new THREE.SphereGeometry(IC_PENGUIN_R, 24, 18), dark);
    trunk.scale.set(1, 1.15, 0.95);
    trunk.position.y = IC_PENGUIN_R * 1.08;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(IC_PENGUIN_R * 0.8, 20, 14), white);
    belly.scale.set(0.85, 1.05, 0.6);
    belly.position.set(0, IC_PENGUIN_R * 0.98, IC_PENGUIN_R * 0.45);
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(IC_PENGUIN_R * 0.78, 0.13, 10, 24), tint);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = IC_PENGUIN_R * 1.42;
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 12), orange);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, IC_PENGUIN_R * 1.62, IC_PENGUIN_R * 0.9);
    body.add(trunk, belly, scarf, beak);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), white);
      eye.position.set(s * 0.27, IC_PENGUIN_R * 1.8, IC_PENGUIN_R * 0.72);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      pupil.position.set(0, 0, 0.1);
      eye.add(pupil);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6), orange);
      foot.scale.set(1, 0.35, 1.4);
      foot.position.set(s * 0.35, 0.07, 0.35);
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), dark);
      wing.scale.set(0.35, 1.3, 0.8);
      wing.position.set(s * IC_PENGUIN_R * 0.95, IC_PENGUIN_R * 1.05, 0);
      wing.rotation.z = s * 0.25;
      body.add(eye, foot, wing);
    }
    body.traverse((o) => (o.castShadow = true));

    // 学士帽：当老师的人戴
    const cap = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.09, 1.25), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.32, 16), board.material);
    crown.position.y = -0.18;
    const tassel = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd23f }));
    tassel.position.set(0.55, -0.2, 0.55);
    cap.add(board, crown, tassel);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = IC_PENGUIN_R * 2.25;
    cap.traverse((o) => (o.castShadow = true));
    body.add(cap);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(IC_PENGUIN_R * 1.05, IC_PENGUIN_R * 1.35, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    const label = makeLabel(name, color);
    group.add(label);
    this.board.add(group);
    const rig: PenguinRig = { group, body, ring, cap, label, color, name, heading: 0, last: new THREE.Vector2(), wobble: 0 };
    this.penguins.set(id, rig);
    return rig;
  }

  /** 收到新的游戏状态。重放动画进行中时只更新标记，位置等动画播完再对齐 */
  setState(st: IcSceneState): void {
    this.state = st;
    const ids = new Set(st.pieces.map((p) => p.id));
    for (const [id, rig] of this.penguins) {
      if (!ids.has(id)) {
        this.board.remove(rig.group);
        this.penguins.delete(id);
      }
    }
    for (const p of st.pieces) {
      let rig = this.penguins.get(p.id);
      const color = st.colors[p.id] ?? "#888";
      const name = st.names[p.id] ?? "?";
      if (rig && (rig.color !== color || rig.name !== name)) {
        this.board.remove(rig.group);
        this.penguins.delete(p.id);
        rig = undefined;
      }
      if (!rig) {
        rig = this.makePenguin(p.id, color, name);
        rig.group.position.set(p.x, 0, p.z);
        rig.last.set(p.x, p.z);
        // 一开始都朝着镜头
        rig.heading = 0;
      }
      rig.cap.visible = p.id === st.catcherId;
      if (!this.sim) rig.group.position.set(p.x, 0, p.z);
    }
    if (!this.sim) this.syncFish();
    if (!st.canAim) this.cancelAim();
  }

  private syncFish(): void {
    const st = this.state;
    if (!st) return;
    const key = JSON.stringify([...st.fishOnDoors.entries()]) + st.myDoors.join(",");
    if (key === this.fishKey) return;
    this.fishKey = key;
    for (const d of IC_DOORS) {
      const group = this.fishGroups.get(d.id)!;
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      group.clear();
      const owners = st.fishOnDoors.get(d.id) ?? [];
      owners.forEach((owner, i) => {
        const f = makeFish(st.colors[owner] ?? "#888");
        const off = (i - (owners.length - 1) / 2) * 0.75;
        if (d.vertical) f.position.z = off;
        else f.position.x = off;
        f.userData.owner = owner;
        f.userData.phase = i * 0.7 + d.id;
        group.add(f);
      });
      const mat = this.mats.get(d.id)!;
      const mine = st.myDoors.includes(d.id) && owners.includes(st.me);
      mat.material.color.set(st.colors[st.me] ?? "#fff");
      mat.material.opacity = mine ? 0.45 : 0;
      mat.userData.mine = mine;
    }
  }

  /** 播放一次弹射：从 shot.before 开始用同样的物理重放 */
  playShot(shot: IcShot): void {
    this.cancelAim();
    for (const p of shot.before) {
      const rig = this.penguins.get(p.id);
      if (rig) {
        rig.group.position.set(p.x, 0, p.z);
        rig.last.set(p.x, p.z);
      }
    }
    this.sim = new IcecoolSim(shot.before, shot.shooterId, shot.flick);
    this.simShot = shot;
    this.simAcc = 0;
    this.pendingFish = [...shot.fish];
  }

  get playing(): boolean {
    return this.sim !== null;
  }

  private finishSim(): void {
    this.sim = null;
    this.simShot = null;
    this.pendingFish = [];
    // 对齐服务端的最终结果
    if (this.state) {
      for (const p of this.state.pieces) this.penguins.get(p.id)?.group.position.set(p.x, 0, p.z);
    }
    this.fishKey = "";
    this.syncFish();
    this.hooks.onSettled();
  }

  /** 镜头摆在长边朝屏幕长边的方向，整个棋盘都能装进去 */
  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const portrait = aspect < 1.1;
    const tilt = 0.5;
    const halfV = (portrait ? IC_W : IC_D) / 2 + 1.6;
    const halfH = (portrait ? IC_D : IC_W) / 2 + 1.6;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max((halfV * Math.cos(tilt)) / t, halfH / (t * aspect)) + 3;
    const dir = portrait ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, 1);
    this.camera.position.copy(dir.multiplyScalar(Math.sin(tilt) * dist)).setY(Math.cos(tilt) * dist);
    this.camera.lookAt(0, 0, 0);
  }

  private frame = (): void => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    if (this.sim) {
      this.simAcc += dt;
      while (this.simAcc >= SIM_STEP && this.sim && !this.sim.done) {
        this.simAcc -= SIM_STEP;
        for (const e of this.sim.step()) this.handleSimEvent(e);
      }
      if (this.sim) {
        for (const b of this.sim.bodies) this.penguins.get(b.id)?.group.position.set(b.x, 0, b.z);
        if (this.sim.done) this.finishSim();
      }
    }

    const st = this.state;
    for (const [id, rig] of this.penguins) {
      const p = rig.group.position;
      const dx = p.x - rig.last.x;
      const dz = p.z - rig.last.y;
      const moved = Math.hypot(dx, dz);
      if (moved > 0.002) {
        const target = Math.atan2(dx, dz);
        let diff = target - rig.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        rig.heading += diff * Math.min(1, dt * 10);
        rig.wobble = Math.min(1, rig.wobble + moved * 0.6);
      }
      rig.wobble *= Math.max(0, 1 - dt * 2.5);
      rig.last.set(p.x, p.z);
      rig.body.rotation.y = rig.heading;
      // 滑的时候左右摇摆，停下来轻轻呼吸
      rig.body.rotation.z = Math.sin(this.time * 14) * 0.18 * rig.wobble;
      rig.body.scale.y = 1 + Math.sin(this.time * 2.4 + p.x) * 0.015;
      const current = st && id === st.currentId && !this.sim;
      rig.ring.material.opacity = current ? 0.55 + Math.sin(this.time * 5) * 0.35 : 0.35;
      rig.ring.scale.setScalar(current ? 1 + Math.sin(this.time * 5) * 0.06 : 1);
    }

    for (const [, group] of this.fishGroups) {
      for (const f of group.children) {
        if (f.userData.popping) continue;
        const ph = (f.userData.phase as number) ?? 0;
        f.position.y = Math.sin(this.time * 2.2 + ph) * 0.15;
        f.rotation.y = this.time * 1.2 + ph;
      }
    }
    for (const [, mat] of this.mats) {
      if (mat.userData.mine) mat.material.opacity = 0.32 + Math.sin(this.time * 3) * 0.16;
    }
    this.poppingFish = this.poppingFish.filter((f) => {
      f.t += dt;
      f.mesh.position.y += dt * 3;
      f.mesh.scale.setScalar(Math.max(0.01, 1 + f.t * 2 - f.t * f.t * 6));
      if (f.t > 0.6) {
        f.mesh.parent?.remove(f.mesh);
        return false;
      }
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  };

  private handleSimEvent(e: IcSimEvent): void {
    const shot = this.simShot;
    if (!shot) return;
    if (e.kind === "door") {
      const i = this.pendingFish.findIndex((f) => f.playerId === e.pieceId && f.door === e.door);
      if (i >= 0) {
        this.pendingFish.splice(i, 1);
        const group = this.fishGroups.get(e.door);
        const fish = group?.children.find((c) => c.userData.owner === e.pieceId && !c.userData.popping);
        if (fish) {
          fish.userData.popping = true;
          this.poppingFish.push({ mesh: fish, t: 0 });
        }
      }
    }
    this.hooks.onSimEvent(e, shot);
  }

  // ---------- 拉弹弓瞄准 ----------

  private boardPoint(e: PointerEvent): THREE.Vector2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, hit)) return null;
    return new THREE.Vector2(hit.x - OX, hit.z - OZ);
  }

  private myPiece(): IcPiece | null {
    const st = this.state;
    if (!st) return null;
    return st.pieces.find((p) => p.id === st.me) ?? null;
  }

  private handleDown = (e: PointerEvent): void => {
    if (!this.state?.canAim || this.sim || this.aiming) return;
    const me = this.myPiece();
    const pt = this.boardPoint(e);
    if (!me || !pt) return;
    if (Math.hypot(pt.x - me.x, pt.y - me.z) > GRAB_RADIUS) return;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.aiming = { pointerId: e.pointerId, pull: new THREE.Vector2() };
    this.updateAim(pt);
  };

  private handleMove = (e: PointerEvent): void => {
    if (!this.aiming || e.pointerId !== this.aiming.pointerId) return;
    const pt = this.boardPoint(e);
    if (pt) this.updateAim(pt);
  };

  private handleUp = (e: PointerEvent): void => {
    if (!this.aiming || e.pointerId !== this.aiming.pointerId) return;
    const flick = this.currentFlick();
    this.cancelAim();
    if (flick) this.hooks.onFlick(flick);
  };

  private handleCancel = (): void => this.cancelAim();

  private cancelAim(): void {
    if (!this.aiming) return;
    this.aiming = null;
    this.aimArrow.visible = false;
    this.dots.count = 0;
    this.hooks.onAimChange(null);
  }

  private currentFlick(): IcFlick | null {
    if (!this.aiming || !this.state) return null;
    const len = this.aiming.pull.length();
    if (len < MIN_PULL) return null;
    const power = Math.min(1, len / MAX_PULL);
    const speed = 3 + power * (IC_MAX_SPEED - 3);
    const dir = this.aiming.pull.clone().normalize();
    return { vx: dir.x * speed, vz: dir.y * speed, spin: this.state.spin };
  }

  private updateAim(pt: THREE.Vector2): void {
    const me = this.myPiece();
    if (!this.aiming || !me) return;
    // 弹弓：往反方向拉
    const pull = new THREE.Vector2(me.x - pt.x, me.z - pt.y);
    if (pull.length() > MAX_PULL) pull.setLength(MAX_PULL);
    this.aiming.pull = pull;
    const len = pull.length();
    const flick = this.currentFlick();
    if (!flick) {
      this.aimArrow.visible = false;
      this.dots.count = 0;
      this.hooks.onAimChange(0);
      return;
    }
    const power = Math.min(1, len / MAX_PULL);
    const arrowLen = 1.6 + power * 4.5;
    this.aimArrow.visible = true;
    this.aimArrow.position.set(me.x, 0.15, me.z);
    this.aimArrow.rotation.y = -Math.atan2(pull.y, pull.x);
    this.aimShaft.scale.x = arrowLen - 0.9;
    this.aimShaft.position.x = IC_PENGUIN_R + (arrowLen - 0.9) / 2;
    this.aimHead.position.x = IC_PENGUIN_R + arrowLen - 0.45;
    this.aimShaft.material.color.setHSL(0.33 - power * 0.33, 0.8, 0.48);
    this.hooks.onAimChange(power);

    // 预览前一小段路线（只算自己，不算别的企鹅），能看出拐弯和撞墙
    const st = this.state!;
    const sim = new IcecoolSim([{ id: st.me, x: me.x, z: me.z }], st.me, flick);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 1; i <= 60 && !sim.done && n < 24; i++) {
      sim.step();
      if (i % 3 === 0) {
        const b = sim.bodies[0]!;
        m.makeTranslation(b.x, 0.15, b.z);
        this.dots.setMatrixAt(n++, m);
      }
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handleDown);
    canvas.removeEventListener("pointermove", this.handleMove);
    canvas.removeEventListener("pointerup", this.handleUp);
    canvas.removeEventListener("pointercancel", this.handleCancel);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material & { map?: THREE.Texture | null };
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    canvas.remove();
  }
}
