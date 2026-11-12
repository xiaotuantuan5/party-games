import * as THREE from "three";

/**
 * 古风场景：山门、竹林、古寺庭院、藏经楼、血煞大殿。
 * 背景用 canvas 画的水墨山水，前景是几何体。花瓣和飘叶用 InstancedMesh 一次画完。
 */

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 地面边长（足够让镜头在任何角度都看不到边） */
const FLOOR_SIZE = 320;
/** 水墨天幕的半径 */
const DOME_RADIUS = 120;
/** 中景远山的数量 */
const HILL_COUNT = 48;

// ================= 花瓣 / 飘叶 =================

/** 一次绘制几百片花瓣。ambient 的会一直飘，burst 的是技能炸出来的，会慢慢消失 */
export class Petals {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private ang: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private ambient: Uint8Array;
  private next = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  density = 1;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.ang = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.ambient = new Uint8Array(n);
    const geo = new THREE.PlaneGeometry(0.16, 0.1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) {
      this.mesh.setColorAt(i, this.color.set(0xffb7c5));
      this.pos[i * 3 + 1] = -99;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 环境里一直飘的花瓣或飘叶，从顶部落下，落到地面后从顶部重新出现 */
  seedAmbient(count: number, color: number, box: { x0: number; x1: number; z0: number; z1: number; top: number }): void {
    this.color.set(color);
    for (let k = 0; k < count && k < this.n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.ambient[i] = 1;
      this.pos.set([rand(box.x0, box.x1), rand(0, box.top), rand(box.z0, box.z1)], i * 3);
      this.vel.set([0, -rand(0.3, 0.7), 0], i * 3);
      this.ang.set([rand(0, 6), rand(0, 6), rand(0, 6)], i * 3);
      this.spin.set([rand(-2, 2), rand(-2, 2), rand(-3, 3)], i * 3);
      this.life[i] = 1e9;
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 技能炸出来的花瓣，向四周飞散后慢慢消失 */
  burst(at: { x: number; y: number; z: number }, count: number, color: number, speed: number, life: number): void {
    this.color.set(color);
    const total = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < total; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.ambient[i] = 0;
      this.pos.set([at.x + rand(-0.2, 0.2), at.y + rand(-0.2, 0.2), at.z + rand(-0.2, 0.2)], i * 3);
      const s = speed * rand(0.4, 1);
      const th = rand(0, Math.PI * 2);
      const u = rand(-0.6, 0.8);
      this.vel.set([Math.cos(th) * s, u * s + 1.5, Math.sin(th) * s * 0.6], i * 3);
      this.ang.set([rand(0, 6), rand(0, 6), rand(0, 6)], i * 3);
      this.spin.set([rand(-10, 10), rand(-10, 10), rand(-10, 10)], i * 3);
      this.life[i] = life * rand(0.6, 1);
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 把一串点当作花瓣的路径（比如龙身、扇子轨迹）上撒花瓣，用来做华丽的拖尾 */
  trail(points: THREE.Vector3[], color: number, life: number): void {
    for (const p of points) this.burst(p, 1, color, 0.6, life);
  }

  update(dt: number, wind = 0): void {
    const box = this.dummy;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      if (this.ambient[i]) {
        this.pos[i3] = this.pos[i3]! + (wind + Math.sin(this.ang[i3 + 1]! + this.spin[i3 + 2]! * 0) * 0.3) * dt;
        this.pos[i3 + 1] = this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt;
        this.pos[i3 + 2] = this.pos[i3 + 2]! + Math.cos(this.ang[i3]!) * 0.1 * dt;
        if (this.pos[i3 + 1]! < -0.05) this.pos[i3 + 1] = rand(4, 7);
        this.ang[i3] = this.ang[i3]! + this.spin[i3]! * dt;
        this.ang[i3 + 1] = this.ang[i3 + 1]! + this.spin[i3 + 1]! * dt;
        this.ang[i3 + 2] = this.ang[i3 + 2]! + this.spin[i3 + 2]! * dt;
      } else if (this.life[i]! > 0) {
        this.life[i] = this.life[i]! - dt;
        const drag = Math.max(0, 1 - 1.6 * dt);
        this.vel[i3] = this.vel[i3]! * drag;
        this.vel[i3 + 1] = this.vel[i3 + 1]! * drag - 3 * dt;
        this.vel[i3 + 2] = this.vel[i3 + 2]! * drag;
        this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
        this.pos[i3 + 1] = this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt;
        this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
        this.ang[i3] = this.ang[i3]! + this.spin[i3]! * dt;
        this.ang[i3 + 1] = this.ang[i3 + 1]! + this.spin[i3 + 1]! * dt;
        this.ang[i3 + 2] = this.ang[i3 + 2]! + this.spin[i3 + 2]! * dt;
        if (this.life[i]! <= 0 || this.pos[i3 + 1]! < -0.05) {
          this.life[i] = 0;
          this.pos[i3 + 1] = -99;
        }
      } else continue;
      const s = this.life[i]! > 0 && this.life[i]! < 0.3 ? this.life[i]! / 0.3 : 1;
      box.position.set(this.pos[i3]!, this.pos[i3 + 1]!, this.pos[i3 + 2]!);
      box.rotation.set(this.ang[i3]!, this.ang[i3 + 1]!, this.ang[i3 + 2]!);
      box.scale.setScalar(s);
      box.updateMatrix();
      this.mesh.setMatrixAt(i, box.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

// ================= 水墨全景 =================

/**
 * 环绕一圈的水墨山水：2048×512，左右首尾相接（山脊用整数倍频率的正弦叠加，保证拼缝处没有断开）。
 * 天色按房间变，山门和竹林偏青灰，血煞大殿偏血红。
 */
function panorama(room: number): THREE.CanvasTexture {
  const W = 2048;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  // 白天的天色：顶部偏蓝，靠近地平线泛白。血煞大殿是傍晚前的红霞
  const palette =
    room === 4
      ? ["#c85a50", "#f0a082", "#ffe6cc"]
      : room === 1
        ? ["#7fb6dc", "#c4e2ee", "#eef6e6"]
        : ["#6aaee6", "#bfe3f5", "#f4f9f2"];
  const sky = g.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, palette[0]!);
  sky.addColorStop(0.7, palette[1]!);
  sky.addColorStop(1, palette[2]!);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // 太阳与光晕，放在画面的右上方
  const halo = g.createRadialGradient(1500, 110, 30, 1500, 110, 300);
  halo.addColorStop(0, "rgba(255,246,220,0.85)");
  halo.addColorStop(1, "rgba(255,246,220,0)");
  g.fillStyle = halo;
  g.fillRect(1150, 0, 700, 430);
  g.fillStyle = "rgba(255,250,236,0.98)";
  g.beginPath();
  g.arc(1500, 110, 46, 0, Math.PI * 2);
  g.fill();

  // 几朵白云，水墨风格的扁圆叠加
  const cloud = (x: number, y: number, s: number) => {
    g.fillStyle = "rgba(255,255,255,0.88)";
    for (const [dx, dy, r] of [
      [0, 0, 26],
      [30, -8, 32],
      [64, 0, 24],
      [-28, 6, 18],
    ] as const) {
      g.beginPath();
      g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      g.fill();
    }
  };
  cloud(260, 120, 1.4);
  cloud(820, 80, 1.1);
  cloud(1100, 180, 1.3);
  cloud(1800, 230, 1.0);

  // 远处的雾带，让层次之间有呼吸感
  for (const [y, a] of [
    [250, 0.3],
    [300, 0.22],
    [360, 0.14],
  ] as const) {
    const mist = g.createLinearGradient(0, y - 30, 0, y + 30);
    mist.addColorStop(0, "rgba(240,248,250,0)");
    mist.addColorStop(0.5, `rgba(240,248,250,${a})`);
    mist.addColorStop(1, "rgba(240,248,250,0)");
    g.fillStyle = mist;
    g.fillRect(0, y - 30, W, 60);
  }

  // 层层叠叠的山脊：越远越浅、越淡，越近越深、越绿；每层用整数倍频率保证首尾相接
  const ridge = (x: number, k: number, phase: number) => Math.sin((2 * Math.PI * k * x) / W + phase);
  const ridgeColors = ["rgba(164,200,206,0.92)", "rgba(120,166,160,0.94)", "rgba(84,130,112,0.96)", "rgba(58,100,84,1)"];
  for (let layer = 0; layer < 4; layer++) {
    const base = 300 + layer * 52;
    const ph = layer * 1.7;
    g.fillStyle = ridgeColors[layer]!;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y =
        base -
        ridge(x, 3, ph) * 30 -
        ridge(x, 7, ph * 2) * 16 -
        ridge(x, 19, ph * 3) * 6 -
        (layer % 2) * 8;
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }

  // 各场景的剪影，放在画面的几个固定角度上
  if (room === 0) {
    // 山门后的飞檐，朱红偏深
    g.fillStyle = "rgba(150,60,50,0.9)";
    for (const x of [300, 1400]) {
      g.beginPath();
      g.moveTo(x - 160, 300);
      g.quadraticCurveTo(x, 250, x + 160, 300);
      g.lineTo(x + 128, 318);
      g.lineTo(x - 128, 318);
      g.closePath();
      g.fill();
    }
  } else if (room === 1) {
    // 竹林剪影，青绿色
    g.fillStyle = "rgba(60,110,72,0.9)";
    for (let x = 0; x < W; x += 22) {
      g.fillRect(x + ((x * 37) % 9), 170 + ((x * 53) % 60), 6, 340);
    }
  } else if (room === 2) {
    // 古塔，灰褐色
    g.fillStyle = "rgba(110,96,84,0.92)";
    g.fillRect(990, 150, 84, 362);
    for (let i = 0; i < 5; i++) {
      g.fillRect(975 - i * 4, 170 + i * 60, 114 + i * 8, 14);
    }
  } else if (room === 4) {
    // 佛像剪影，在朝霞里
    g.fillStyle = "rgba(120,50,50,0.9)";
    g.beginPath();
    g.arc(1024, 220, 60, 0, Math.PI * 2);
    g.fill();
    g.fillRect(964, 270, 120, 160);
    g.beginPath();
    g.moveTo(812, H);
    g.quadraticCurveTo(1024, 250, 1236, H);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** 水面的涟漪纹理，用来做远处的河或湖 */
function waterTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3f8fb0";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(230,250,255,0.35)";
  g.lineWidth = 2;
  for (let i = 0; i < 90; i++) {
    const y = (i * 37) % 512;
    const x = (i * 83) % 512;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 30, y - 4, x + 60, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function tileFloor(room: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  const base = room === 4 ? "#a86a66" : room === 3 ? "#b89a72" : room === 1 ? "#9ab08a" : "#c9c2b2";
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(60,50,40,0.35)";
  g.lineWidth = 4;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  for (let i = 0; i < 200; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.12)";
    g.fillRect(Math.random() * 256, Math.random() * 256, 6, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ================= 场景 =================

export interface Theme {
  petals: Petals;
  /** 每帧调用，让灯笼晃动、旗子飘动、花瓣落下 */
  update(dt: number, t: number): void;
  dispose(): void;
  fog: number;
  sky: number;
  ground: number;
  hemi: number;
  /** 血煞大殿的血池，用来做脉动 */
  pulse: THREE.Object3D[];
  /** 雾的起止距离，户外远一些，室内近一些 */
  fogNear: number;
  fogFar: number;
}

const PALETTE = {
  red: 0xb8222a,
  lacquer: 0x4a1418,
  wood: 0x3a2818,
  stone: 0x55554f,
  bamboo: 0x2f6a42,
  paper: 0xf0e4c4,
  lantern: 0xffa04a,
  gold: 0xe0b050,
};

/** 在 group 里搭好当前房间的场景，返回句柄用来每帧动画和释放 */
export function buildTheme(group: THREE.Group, room: number, width: number, doorMat: THREE.Material): Theme {
  const owned: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T): T => {
    owned.push(o);
    return o;
  };
  const add = (o: THREE.Object3D) => group.add(o);
  const box = (w: number, h: number, d: number, color: number, emissive = 0) => {
    const m = track(new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive: new THREE.Color(color).multiplyScalar(emissive) }));
    return new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), m);
  };
  const glowMat = (color: number, k: number) => track(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false }));
  const lights: THREE.PointLight[] = [];
  const pulse: THREE.Object3D[] = [];
  const sway: { obj: THREE.Object3D; base: number; amp: number; speed: number }[] = [];
  const bob: { obj: THREE.Object3D; base: number; amp: number; speed: number }[] = [];

  const outdoor = room <= 2;
  const cx = width / 2;

  // 地面：石板或木地板，足够大，第三人称镜头绕着转也不露边
  const floorTex = tileFloor(room);
  floorTex.repeat.set(FLOOR_SIZE / 4, FLOOR_SIZE / 4);
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE)),
    track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0.02 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, 0);
  add(floor);

  // 环绕一圈的水墨山水天幕：镜头怎么转都能看到远山和天色
  const pano = track(panorama(room));
  const dome = new THREE.Mesh(
    track(new THREE.CylinderGeometry(DOME_RADIUS, DOME_RADIUS, 72, 96, 1, true)),
    track(new THREE.MeshBasicMaterial({ map: pano, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false })),
  );
  dome.position.set(cx, 18, 0);
  add(dome);

  // 中景远山：一圈低多边形山体，雾会把远处的淡掉，形成层次
  const hills = track(new THREE.InstancedMesh(
    track(new THREE.ConeGeometry(1, 1, 7, 1)),
    track(new THREE.MeshStandardMaterial({ color: outdoor ? 0x6e9080 : 0x9a9488, roughness: 1, metalness: 0 })),
    HILL_COUNT,
  ));
  const hillDummy = new THREE.Object3D();
  for (let i = 0; i < HILL_COUNT; i++) {
    const a = (i / HILL_COUNT) * Math.PI * 2 + rand(-0.05, 0.05);
    const r = 92 + rand(-6, 8);
    const w = rand(12, 22);
    const h = rand(14, 30);
    hillDummy.position.set(cx + Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r);
    hillDummy.scale.set(w, h, w);
    hillDummy.rotation.set(0, rand(0, Math.PI), 0);
    hillDummy.updateMatrix();
    hills.setMatrixAt(i, hillDummy.matrix);
  }
  hills.instanceMatrix.needsUpdate = true;
  add(hills);

  // 户外的水面：放在场地身后，镜头能看到远处的河或湖
  if (outdoor) {
    const waterTex = track(waterTexture());
    waterTex.repeat.set(FLOOR_SIZE / 16, 3);
    const water = new THREE.Mesh(
      track(new THREE.PlaneGeometry(FLOOR_SIZE, 52)),
      track(new THREE.MeshStandardMaterial({ map: waterTex, color: 0xd8f0f8, roughness: 0.16, metalness: 0.3 })),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, 0.02, -35);
    add(water);
  }

  const lantern = (x: number, y: number, z: number, color: number, k = 1) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(track(new THREE.SphereGeometry(0.34, 14, 10)), glowMat(color, 2.2 * k));
    body.scale.set(1, 1.3, 1);
    const cap = box(0.5, 0.06, 0.5, PALETTE.lacquer);
    cap.position.y = 0.5;
    const base = box(0.5, 0.06, 0.5, PALETTE.lacquer);
    base.position.y = -0.5;
    g.add(body, cap, base);
    g.position.set(x, y, z);
    add(g);
    const light = new THREE.PointLight(color, 7 * k, 12, 1.6);
    light.position.set(x, y, z + 0.4);
    add(light);
    lights.push(light);
    bob.push({ obj: g, base: y, amp: 0.08, speed: 1.4 + Math.random() });
    return g;
  };

  const banner = (x: number, z: number, h: number, color: number) => {
    const m = track(new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9, emissive: new THREE.Color(color).multiplyScalar(0.12) }));
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(0.5, h, 1, 4)), m);
    mesh.position.set(x, h / 2 + 0.2, z);
    add(mesh);
    sway.push({ obj: mesh, base: 0, amp: 0.12, speed: 1.6 });
    return mesh;
  };

  const incense = (x: number, z: number) => {
    const burner = box(0.5, 0.45, 0.5, PALETTE.stone);
    burner.position.set(x, 0.23, z);
    add(burner);
    const tip = new THREE.Mesh(track(new THREE.ConeGeometry(0.05, 0.25, 6)), glowMat(0xff9040, 2.5));
    tip.position.set(x, 0.6, z);
    add(tip);
    sway.push({ obj: tip, base: 0.6, amp: 0.02, speed: 9 });
  };

  if (room === 0) {
    // 山门：石阶、朱红门楼、两侧石灯
    for (let i = 0; i < 4; i++) {
      const step = box(width + 10, 0.2, 1.4, PALETTE.stone);
      step.position.set(width / 2, 0.1 + i * 0.1, -4.5 + i * 0.3);
      add(step);
    }
    for (const x of [width * 0.18, width * 0.82]) {
      for (const z of [-4.6, -3.8]) {
        const pillar = box(0.6, 5, 0.6, PALETTE.red);
        pillar.position.set(x, 2.5, z);
        add(pillar);
      }
    }
    const roof = box(width * 0.7, 0.5, 2.2, PALETTE.lacquer);
    roof.position.set(width / 2, 5.4, -4.2);
    add(roof);
    lantern(width * 0.18, 3.6, -4.2, PALETTE.lantern);
    lantern(width * 0.82, 3.6, -4.2, PALETTE.lantern);
    lantern(width * 0.5, 3.0, -5.6, PALETTE.lantern, 0.7);
    banner(width * 0.36, -5.5, 2.6, PALETTE.red);
    banner(width * 0.64, -5.5, 2.6, PALETTE.red);
    // 石灯笼
    for (const x of [6, width - 8]) {
      const base = box(0.5, 1.2, 0.5, PALETTE.stone);
      base.position.set(x, 0.6, 3.6);
      add(base);
      lantern(x, 1.7, 3.6, PALETTE.lantern, 0.6);
    }
  } else if (room === 1) {
    // 竹林：很多细竹竿，前后分层，月光透过来
    const stalkGeo = track(new THREE.CylinderGeometry(0.09, 0.11, 1, 6));
    const stalkMat = track(new THREE.MeshStandardMaterial({ color: PALETTE.bamboo, roughness: 0.7 }));
    const count = 70;
    const inst = new THREE.InstancedMesh(stalkGeo, stalkMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const front = i % 5 === 0;
      const h = rand(6, 9);
      dummy.position.set(rand(-2, width + 2), h / 2 - 0.2, front ? rand(3.6, 5.2) : rand(-7, -4.6));
      dummy.scale.set(1, h, 1);
      dummy.rotation.set(rand(-0.03, 0.03), 0, rand(-0.03, 0.03));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    add(inst);
    // 林间小径上的石板和一座亭子
    const pavilion = box(3, 0.4, 2.4, PALETTE.wood);
    pavilion.position.set(width * 0.6, 0.9, -3.4);
    add(pavilion);
    for (const dx of [-1.3, 1.3]) {
      const post = box(0.2, 2.4, 0.2, PALETTE.lacquer);
      post.position.set(width * 0.6 + dx, 2.1, -3.4);
      add(post);
    }
    lantern(width * 0.6, 3.2, -3.4, PALETTE.lantern, 0.6);
    lights.push(Object.assign(new THREE.PointLight(0xa8c8ff, 6, 18, 1.2), { position: new THREE.Vector3(width * 0.3, 8, -2) }));
    add(lights[lights.length - 1]!);
  } else if (room === 2) {
    // 古寺庭院：石灯笼、香炉、经幡、两侧的佛殿台阶
    for (const x of [4, width * 0.35, width * 0.65, width - 4]) {
      const base = box(0.6, 1.6, 0.6, PALETTE.stone);
      base.position.set(x, 0.8, -4);
      add(base);
      lantern(x, 2.2, -4, PALETTE.lantern, 0.8);
      incense(x + 0.9, -3.4);
    }
    for (const x of [width * 0.2, width * 0.8]) banner(x, -5.2, 3.6, 0xc8a050);
    const hall = box(width * 0.6, 3, 2, PALETTE.wood);
    hall.position.set(width / 2, 1.5, -7);
    add(hall);
    const roof = box(width * 0.66, 0.4, 3, PALETTE.lacquer);
    roof.position.set(width / 2, 3.2, -7);
    add(roof);
  } else if (room === 3) {
    // 藏经楼：木柱、书架、蜡烛
    for (let x = 2; x < width; x += 6) {
      const pillar = box(0.5, 6, 0.5, PALETTE.wood);
      pillar.position.set(x, 3, -4.2);
      add(pillar);
    }
    for (let x = 4; x < width - 2; x += 5) {
      const shelf = box(2.6, 3, 0.8, PALETTE.lacquer);
      shelf.position.set(x, 1.5, -6.2);
      add(shelf);
      for (let r = 0; r < 3; r++) {
        const book = box(2.2, 0.08, 0.5, [0x7a2a2a, 0x2a4a6a, 0x6a6a2a][r]!);
        book.position.set(x, 0.6 + r * 0.9, -5.7);
        add(book);
      }
    }
    for (const x of [width * 0.3, width * 0.7]) {
      const candle = box(0.16, 0.6, 0.16, PALETTE.paper);
      candle.position.set(x, 0.3, -2.8);
      add(candle);
      const flame = new THREE.Mesh(track(new THREE.ConeGeometry(0.07, 0.2, 6)), glowMat(0xffc060, 3));
      flame.position.set(x, 0.7, -2.8);
      add(flame);
      sway.push({ obj: flame, base: 0.7, amp: 0.03, speed: 11 });
      lights.push(Object.assign(new THREE.PointLight(0xffb060, 5, 9, 1.8), { position: new THREE.Vector3(x, 1.2, -2.6) }));
      add(lights[lights.length - 1]!);
    }
  } else {
    // 血煞大殿：红色帷幔、佛像剪影、血池
    for (let x = 1; x < width; x += 4) {
      const curtain = banner(x, -6.5, 6, 0x6a0c14);
      curtain.position.y = 3.2;
      curtain.material && ((curtain.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x200004));
    }
    const pool = new THREE.Mesh(track(new THREE.CircleGeometry(3.2, 40)), glowMat(0x8a0a14, 1.1));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(width * 0.5, 0.03, 0.4);
    add(pool);
    pulse.push(pool);
    for (const x of [6, width - 6]) {
      lantern(x, 3.4, -3, 0xff3a2a, 1.1);
    }
    const throne = box(2.8, 3.4, 1.6, PALETTE.lacquer);
    throne.position.set(width - 2.4, 1.7, -4.5);
    add(throne);
  }

  // 右端的出口（血煞大殿没有出口）
  if (room !== 4) {
    const portal = new THREE.Mesh(track(new THREE.PlaneGeometry(4.6, 4.2)), doorMat);
    portal.rotation.y = -Math.PI / 2;
    portal.position.set(width + 0.6, 2.1, 0);
    add(portal);
    const frame = box(0.5, 4.6, 6.4, PALETTE.lacquer);
    frame.position.set(width + 0.9, 2.3, 0);
    add(frame);
  }

  // 白天：环境光偏亮，雾是淡蓝色的空气
  const hemi = room === 3 ? 1.3 : 1.6;
  const fog = room === 4 ? 0xf0c8b8 : room === 3 ? 0xd8e0e4 : 0xcfe6f4;
  const sky = room === 4 ? 0xffe4cc : 0xdcf0ff;
  const ground = room === 4 ? 0xb89a84 : 0xd8ccb0;

  const petals = track(new Petals(260));
  const petalColor = room === 4 ? 0xff3a4a : room === 1 ? 0xbfe6a0 : room === 3 ? 0xd8c890 : 0xf4b8c8;
  petals.seedAmbient(room === 1 ? 110 : 150, petalColor, { x0: -2, x1: width + 2, z0: -4, z1: 4, top: 7 });
  add(petals.mesh);

  return {
    petals,
    fog,
    fogNear: outdoor ? 60 : 30,
    fogFar: outdoor ? 200 : 110,
    sky,
    ground,
    hemi,
    pulse,
    update(dt: number, t: number) {
      for (const b of bob) b.obj.position.y = b.base + Math.sin(t * b.speed) * b.amp;
      for (const s of sway) {
        if (s.speed > 5) s.obj.scale.set(1, 1 + Math.sin(t * s.speed) * 0.2, 1);
        else s.obj.rotation.z = Math.sin(t * s.speed) * s.amp;
      }
      for (const l of lights) l.intensity = (l.userData.base ??= l.intensity) * (0.9 + Math.sin(t * 13 + l.position.x) * 0.1);
      for (const p of pulse) p.scale.setScalar(1 + Math.sin(t * 2) * 0.04);
      petals.update(dt, Math.sin(t * 0.3) * 0.4);
    },
    dispose() {
      for (const o of owned) o.dispose();
      petals.dispose();
      group.clear();
    },
  };
}
