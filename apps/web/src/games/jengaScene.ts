import * as CANNON from "cannon-es";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { jengaLayerRisk, type JengaCollapse, type JengaLayers, type JengaLogEntry, type JengaSlot } from "@party/shared";

/**
 * 层层叠的 3D 场景（three.js）。
 * 平时木块位置完全由服务端下发的 layers 决定，这里只负责动画；
 * 塔倒的时候才交给 cannon-es 做物理模拟，让木块真实地散落一地（只是视觉效果，各端看到的大致相同）。
 */

/** 木块尺寸，比例接近真实层层叠（1.5 × 2.5 × 7.5 cm） */
const L = 3;
const H = 0.6;
const W = 1;
const GAP = 0.04;

export interface JengaSceneHooks {
  onPick: (blockId: number | null) => void;
  onSlide: () => void;
  onPlace: () => void;
  onCollapse: () => void;
}

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

interface Segment extends Pose {
  dur: number;
}

interface Track {
  segs: Segment[];
  idx: number;
  elapsed: number;
  from: Pose;
  onDone?: () => void;
}

/** 由 id 算出的固定伪随机数，让每根木块有一点点不同的偏移和颜色，所有人看到的一样 */
function hash01(id: number, salt: number): number {
  const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const longAxis = (layer: number) => (layer % 2 === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1));

function slotPose(slot: JengaSlot, blockId: number): Pose {
  const off = (slot.pos - 1) * (W + GAP);
  const y = slot.layer * H + H / 2;
  const even = slot.layer % 2 === 0;
  // 沿长边方向的小偏移和一点点偏转，看起来更像手搭的
  const slide = (hash01(blockId, 1) - 0.5) * 0.16;
  const yaw = (hash01(blockId, 2) - 0.5) * 0.016;
  const pos = even ? new THREE.Vector3(slide, y, off) : new THREE.Vector3(off, y, slide);
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (even ? 0 : Math.PI / 2) + yaw, 0));
  return { pos, quat };
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 用 canvas 画几张木纹贴图，所有木块共用 */
function makeWoodTextures(): THREE.CanvasTexture[] {
  return [0, 1, 2, 3].map((v) => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e3b77a";
    g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 26; i++) {
      const y0 = Math.random() * c.height;
      const amp = 1.5 + Math.random() * 3;
      const freq = 0.01 + Math.random() * 0.03;
      const phase = Math.random() * 10 + v;
      g.strokeStyle = `rgba(${120 + Math.random() * 40}, ${70 + Math.random() * 30}, 30, ${0.12 + Math.random() * 0.22})`;
      g.lineWidth = 0.6 + Math.random() * 1.8;
      g.beginPath();
      for (let x = 0; x <= c.width; x += 4) {
        const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.7) * amp * 0.3;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // 偶尔来个木节
    if (v % 2 === 1) {
      const kx = 60 + Math.random() * 140;
      const ky = 16 + Math.random() * 32;
      for (let r = 9; r > 1; r -= 2) {
        g.strokeStyle = `rgba(110, 60, 25, ${0.15 + (9 - r) * 0.04})`;
        g.beginPath();
        g.ellipse(kx, ky, r * 1.8, r, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  });
}

export class JengaScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private tower = new THREE.Group();
  private geometry = new RoundedBoxGeometry(L, H, W, 2, 0.05);
  private textures = makeWoodTextures();
  private meshes = new Map<number, THREE.Mesh<RoundedBoxGeometry, THREE.MeshStandardMaterial>>();
  /** 每根木块“应该在”的位置（服务端状态），动画结束后回到这里 */
  private base = new Map<number, Pose & { layer: number }>();
  private tracks = new Map<number, Track>();
  private clock = new THREE.Clock();
  private time = 0;
  private lastSeq: number | null = null;
  private towerHeight = 0;
  private sway = 0;

  private selected: number | null = null;
  private selectedSide = 1;
  private tremble = 0;
  private pickable: (blockId: number) => boolean = () => false;

  private world: CANNON.World | null = null;
  private bodies = new Map<number, CANNON.Body>();
  private physicsTime = 0;
  private resizeObserver: ResizeObserver;
  private pointerDown: { x: number; y: number; t: number } | null = null;

  constructor(
    private container: HTMLElement,
    private hooks: JengaSceneHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.camera.position.set(15, 13, 17);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 5, 0);
    this.controls.update();

    this.setupWorld();
    this.scene.add(this.tower);

    const canvas = this.renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.frame);
  }

  private setupWorld(): void {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a3020, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(10, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -14;
    cam.right = cam.top = 14;
    cam.near = 1;
    cam.far = 60;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.6);
    rim.position.set(-12, 8, -10);
    this.scene.add(rim);

    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 0.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x2f5d4a, roughness: 0.95 }),
    );
    table.position.y = -0.3;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 哪些木块可以点选（轮到自己且符合规则） */
  setPickable(fn: (blockId: number) => boolean): void {
    this.pickable = fn;
  }

  setSelected(blockId: number | null): void {
    if (this.selected !== null) this.meshes.get(this.selected)?.material.emissive.setHex(0x000000);
    this.selected = blockId;
    if (blockId === null) return;
    const mesh = this.meshes.get(blockId);
    const b = this.base.get(blockId);
    if (!mesh || !b) return;
    mesh.material.emissive.setHex(0x664400);
    this.selectedSide = this.sideTowardCamera(b.layer);
  }

  /** 抽木块小游戏进行中时，选中的木块跟着指针抖动。amount 0~1 */
  setTremble(amount: number): void {
    this.tremble = amount;
  }

  /** 把木块往靠近镜头的那一侧抽出来，看得更清楚 */
  private sideTowardCamera(layer: number): number {
    return this.camera.position.dot(longAxis(layer)) >= 0 ? 1 : -1;
  }

  private mesh(blockId: number): THREE.Mesh<RoundedBoxGeometry, THREE.MeshStandardMaterial> {
    let m = this.meshes.get(blockId);
    if (m) return m;
    const tint = new THREE.Color().setHSL(0.08 + hash01(blockId, 3) * 0.03, 0.45 + hash01(blockId, 4) * 0.2, 0.62 + hash01(blockId, 5) * 0.12);
    m = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({
        map: this.textures[blockId % this.textures.length],
        color: tint,
        roughness: 0.7,
        metalness: 0,
      }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.blockId = blockId;
    this.meshes.set(blockId, m);
    this.tower.add(m);
    return m;
  }

  /** 收到新的游戏状态：第一次直接摆好，之后根据新事件播放动画 */
  sync(layers: JengaLayers, log: JengaLogEntry[], collapse: JengaCollapse | null): void {
    const first = this.lastSeq === null;
    const fresh = first ? [] : log.filter((e) => e.seq > this.lastSeq!);
    this.lastSeq = Math.max(this.lastSeq ?? 0, log.at(-1)?.seq ?? 0);

    // 先记下本次抽出的木块的起点，再更新所有木块的目标位置
    const starts = new Map<number, Pose>();
    for (const e of fresh) {
      if (e.blockId === undefined) continue;
      this.finishTrack(e.blockId);
      const m = this.meshes.get(e.blockId);
      if (m) starts.set(e.blockId, { pos: m.position.clone(), quat: m.quaternion.clone() });
    }

    layers.forEach((slots, layer) =>
      slots.forEach((id, pos) => {
        if (id === null) return;
        const pose = slotPose({ layer, pos }, id);
        this.base.set(id, { ...pose, layer });
        const m = this.mesh(id);
        if (first) {
          m.position.copy(pose.pos);
          m.quaternion.copy(pose.quat);
        }
      }),
    );
    this.towerHeight = layers.length * H;
    let fragility = 0;
    for (let i = 0; i < layers.length - 1; i++) fragility += jengaLayerRisk(layers[i]!);
    this.sway = Math.min(0.012, fragility * 0.01);

    if (first) {
      this.controls.target.y = Math.max(3, this.towerHeight * 0.5);
      if (collapse) {
        // 刷新页面时塔已经倒了：直接模拟到散落的结果
        const pose = slotPose({ layer: collapse.layer, pos: collapse.pos }, collapse.blockId);
        const m = this.mesh(collapse.blockId);
        m.position.copy(pose.pos);
        m.quaternion.copy(pose.quat);
        this.startPhysics(collapse, true);
      }
      return;
    }

    for (const e of fresh) {
      if (e.kind === "pull" && e.blockId !== undefined && e.from && e.to) {
        this.animatePull(e.blockId, e.from, starts.get(e.blockId));
      } else if (e.kind === "collapse" && collapse) {
        this.animateCollapse(collapse, starts.get(collapse.blockId));
      }
    }
  }

  private finishTrack(blockId: number): void {
    const t = this.tracks.get(blockId);
    if (!t) return;
    const last = t.segs.at(-1)!;
    const m = this.meshes.get(blockId)!;
    m.position.copy(last.pos);
    m.quaternion.copy(last.quat);
    this.tracks.delete(blockId);
    t.onDone?.();
  }

  private animatePull(blockId: number, from: JengaSlot, start?: Pose): void {
    if (this.selected === blockId) this.setSelected(null);
    const target = this.base.get(blockId)!;
    const fromPose = slotPose(from, blockId);
    const side = this.sideTowardCamera(from.layer);
    const out = fromPose.pos.clone().addScaledVector(longAxis(from.layer), side * L * 1.15);
    const lift = Math.max(this.towerHeight, target.pos.y) + 2.5;
    const up = out.clone().setY(lift);
    const above = target.pos.clone().setY(target.pos.y + 1.2);

    const m = this.mesh(blockId);
    this.hooks.onSlide();
    this.tracks.set(blockId, {
      from: start ?? { pos: m.position.clone(), quat: m.quaternion.clone() },
      idx: 0,
      elapsed: 0,
      segs: [
        { pos: out, quat: fromPose.quat, dur: 0.9 },
        { pos: up, quat: fromPose.quat, dur: 0.5 },
        { pos: above, quat: target.quat, dur: 0.6 },
        { pos: target.pos, quat: target.quat, dur: 0.25 },
      ],
      onDone: () => this.hooks.onPlace(),
    });
  }

  private animateCollapse(c: JengaCollapse, start?: Pose): void {
    this.setSelected(null);
    const fromPose = slotPose({ layer: c.layer, pos: c.pos }, c.blockId);
    const side = this.sideTowardCamera(c.layer);
    const m = this.mesh(c.blockId);
    this.hooks.onSlide();
    // 抽到一半，塔撑不住了
    this.tracks.set(c.blockId, {
      from: start ?? { pos: m.position.clone(), quat: m.quaternion.clone() },
      idx: 0,
      elapsed: 0,
      segs: [{ pos: fromPose.pos.clone().addScaledVector(longAxis(c.layer), side * 1.3), quat: fromPose.quat, dur: 0.55 }],
      onDone: () => this.startPhysics(c, false),
    });
  }

  private startPhysics(c: JengaCollapse, instant: boolean): void {
    if (this.world) return;
    this.tower.rotation.set(0, 0, 0);
    this.tracks.clear();

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -110, 0) });
    world.allowSleep = true;
    (world.solver as CANNON.GSSolver).iterations = 12;
    world.defaultContactMaterial.friction = 0.45;
    world.defaultContactMaterial.restitution = 0.08;
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);

    const dir = new CANNON.Vec3(Math.cos(c.angle), 0, Math.sin(c.angle));
    const shape = new CANNON.Box(new CANNON.Vec3(L / 2 - 0.01, H / 2 - 0.004, W / 2 - 0.012));
    for (const [id, m] of this.meshes) {
      const body = new CANNON.Body({ mass: 1, shape, linearDamping: 0.05, angularDamping: 0.1 });
      body.sleepSpeedLimit = 0.3;
      body.position.set(m.position.x, m.position.y, m.position.z);
      body.quaternion.set(m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w);
      const layer = Math.floor(m.position.y / H);
      if (layer >= c.layer) {
        // 抽空的那层往上整体朝一个方向倾倒，越高越快
        const k = (layer - c.layer + 1) / Math.max(1, this.towerHeight / H - c.layer);
        const v = dir.scale(4 + k * 10);
        body.velocity.set(v.x + (Math.random() - 0.5) * 1.5, -1 - Math.random() * 2, v.z + (Math.random() - 0.5) * 1.5);
        body.angularVelocity.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
      }
      world.addBody(body);
      this.bodies.set(id, body);
    }
    this.world = world;
    this.physicsTime = 0;

    if (instant) {
      for (let i = 0; i < 480; i++) world.step(1 / 60);
      this.copyPhysics();
      this.physicsTime = Infinity;
    } else {
      this.hooks.onCollapse();
    }
  }

  private copyPhysics(): void {
    for (const [id, body] of this.bodies) {
      const m = this.meshes.get(id)!;
      m.position.set(body.position.x, body.position.y, body.position.z);
      m.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    }
  }

  private frame = (): void => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    // 镜头对准塔的中部，塔变高时跟着慢慢抬高
    const targetY = this.world ? 2 : Math.max(3, this.towerHeight * 0.5);
    this.controls.target.y += (targetY - this.controls.target.y) * Math.min(1, dt * 2);
    this.controls.update();

    if (this.world) {
      if (this.physicsTime < 8) {
        this.world.step(1 / 60, dt, 3);
        this.physicsTime += dt;
        this.copyPhysics();
      }
    } else {
      // 塔被抽空的地方越多晃得越明显
      this.tower.rotation.x = this.sway * Math.sin(this.time * 1.3);
      this.tower.rotation.z = this.sway * Math.cos(this.time * 1.05);
      this.updateTracks(dt);
      this.updateRest(dt);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updateTracks(dt: number): void {
    for (const [id, t] of this.tracks) {
      const m = this.meshes.get(id)!;
      t.elapsed += dt;
      let seg = t.segs[t.idx]!;
      while (t.elapsed >= seg.dur) {
        t.elapsed -= seg.dur;
        t.from = { pos: seg.pos, quat: seg.quat };
        t.idx++;
        if (t.idx >= t.segs.length) break;
        seg = t.segs[t.idx]!;
      }
      if (t.idx >= t.segs.length) {
        m.position.copy(seg.pos);
        m.quaternion.copy(seg.quat);
        this.tracks.delete(id);
        t.onDone?.();
        continue;
      }
      const k = easeInOut(t.elapsed / seg.dur);
      m.position.lerpVectors(t.from.pos, seg.pos, k);
      m.quaternion.slerpQuaternions(t.from.quat, seg.quat, k);
    }
  }

  /** 没在动画中的木块平滑回到目标位置；选中的木块微微抽出来，小游戏时跟着抖 */
  private updateRest(dt: number): void {
    const k = Math.min(1, dt * 12);
    for (const [id, m] of this.meshes) {
      if (this.tracks.has(id)) continue;
      const b = this.base.get(id);
      if (!b) continue;
      const target = b.pos.clone();
      if (id === this.selected) {
        target.addScaledVector(longAxis(b.layer), this.selectedSide * 0.45);
        if (this.tremble > 0) {
          const a = this.tremble * 0.06;
          target.x += Math.sin(this.time * 53) * a;
          target.z += Math.cos(this.time * 47) * a;
          target.y += Math.sin(this.time * 61) * a * 0.3;
        }
      }
      m.position.lerp(target, k);
      m.quaternion.slerp(b.quat, k);
    }
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  /** 区分“点一下”和“拖动旋转”：移动很少、时间很短才算点选 */
  private handlePointerUp = (e: PointerEvent): void => {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || this.world) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 500) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects([...this.meshes.values()], false)[0];
    const id = hit ? (hit.object.userData.blockId as number) : null;
    this.hooks.onPick(id !== null && this.pickable(id) ? id : null);
  };

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.textures.forEach((t) => t.dispose());
    this.renderer.dispose();
    canvas.remove();
  }
}
