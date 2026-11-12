import * as CANNON from "cannon-es";
import { CF_ARENA, CF_BLOCK, CF_GRAVITY, CF_SOLDIER_HALF, CF_STONE_R, type CfBody } from "./catapult.js";

/**
 * 投石大战的物理模拟。服务端和前端用同一份代码、同样的输入（发射前的物体 + 初速度）各跑一遍：
 * 服务端的结果说了算，前端只是用来播放动画，播完再对齐到服务端下发的最终位置。
 */

const STEP = 1 / 60;
type Kind = "ground" | "block" | "soldier";
const MAX_TIME = 6.5;
const STONE_LIFE = 1.6;
/** 每步乘的阻尼系数（固定常数，保证各端一致） */
const LIN_DAMP = 0.997;
const ANG_DAMP = 0.985;
const STONE_ROLL = 0.97;
const CALM_V = 0.25;
const CALM_W = 0.6;
const CALM_TIME = 0.3;

export interface CfSimResult {
  /** 留在场上的物体（不含阵亡的士兵），位置已经取整 */
  bodies: CfBody[];
  /** 阵亡的士兵 */
  killed: CfBody[];
}

const round = (v: number, k: number) => Math.round(v * k) / k;

/** 士兵算阵亡：倒下（倾斜超过约 45°）、比原来的位置低了半格以上、或者飞出场地 */
export function cfSoldierDown(b: CfBody): boolean {
  const [x, y, z] = b.p;
  const [qx, , qz] = b.q;
  const upY = 1 - 2 * (qx * qx + qz * qz);
  if (upY < 0.7) return true;
  if (b.baseY !== undefined && y < b.baseY - CF_BLOCK * 0.5) return true;
  return Math.abs(x) > CF_ARENA || Math.abs(z) > CF_ARENA || y < -2;
}

export class CatapultSim {
  readonly world: CANNON.World;
  readonly bodies: { def: CfBody; body: CANNON.Body }[] = [];
  readonly stone: CANNON.Body;
  /** 石弹第一次碰到东西的回调，用来放音效 */
  onImpact: ((speed: number, kind: Kind) => void) | null = null;
  time = 0;
  done = false;
  /** 石弹第一次碰到东西的时间；滚一会儿就碎掉移走，不然它会一直滚 */
  private impactAt: number | null = null;
  stoneGone = false;
  private calmFor = 0;

  constructor(start: CfBody[], from: [number, number, number], vel: [number, number, number]) {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -CF_GRAVITY, 0) });
    world.allowSleep = true;
    (world.solver as CANNON.GSSolver).iterations = 10;
    world.defaultContactMaterial.friction = 0.5;
    world.defaultContactMaterial.restitution = 0.1;
    this.world = world;

    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    // 直接写四元数，不用三角函数：不同浏览器的 sin / cos 末位可能不一样，会让模拟结果分叉
    ground.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    world.addBody(ground);
    const kinds = new Map<CANNON.Body, Kind>([[ground, "ground"]]);

    const blockShape = new CANNON.Box(new CANNON.Vec3(CF_BLOCK / 2, CF_BLOCK / 2, CF_BLOCK / 2));
    const soldierShape = new CANNON.Box(new CANNON.Vec3(CF_SOLDIER_HALF.x, CF_SOLDIER_HALF.y, CF_SOLDIER_HALF.z));
    for (const def of start) {
      const soldier = def.kind === "soldier";
      const body = new CANNON.Body({
        mass: soldier ? 0.35 : 1,
        shape: soldier ? soldierShape : blockShape,
        // cannon 自带的阻尼用 Math.pow(1 - 阻尼, dt) 计算，非整数次幂在不同浏览器上末位可能不一样，
        // 所以设成 0（pow(1, x) 一定是 1），在 step() 里自己乘固定系数
        linearDamping: 0,
        angularDamping: 0,
      });
      body.sleepSpeedLimit = 0.15;
      body.sleepTimeLimit = 0.4;
      body.position.set(def.p[0], def.p[1], def.p[2]);
      body.quaternion.set(def.q[0], def.q[1], def.q[2], def.q[3]);
      kinds.set(body, def.kind);
      world.addBody(body);
      this.bodies.push({ def, body });
    }

    const stone = new CANNON.Body({ mass: 5, shape: new CANNON.Sphere(CF_STONE_R), linearDamping: 0, angularDamping: 0 });
    stone.position.set(from[0], from[1], from[2]);
    stone.velocity.set(vel[0], vel[1], vel[2]);
    stone.sleepSpeedLimit = 0.2;
    stone.sleepTimeLimit = 0.4;
    let hit = false;
    stone.addEventListener("collide", (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      if (hit) return;
      hit = true;
      this.impactAt = this.time;
      const kind = kinds.get(e.body) ?? "ground";
      this.onImpact?.(Math.abs(e.contact.getImpactVelocityAlongNormal()), kind);
    });
    world.addBody(stone);
    this.stone = stone;
  }

  step(): void {
    if (this.done) return;
    this.world.step(STEP);
    for (const { body } of this.bodies) {
      if (body.sleepState === CANNON.Body.SLEEPING) continue;
      body.velocity.scale(LIN_DAMP, body.velocity);
      body.angularVelocity.scale(ANG_DAMP, body.angularVelocity);
    }
    if (!this.stoneGone) this.stone.angularVelocity.scale(STONE_ROLL, this.stone.angularVelocity);
    this.time += STEP;
    if (!this.stoneGone && this.impactAt !== null && this.time - this.impactAt > STONE_LIFE) {
      this.world.removeBody(this.stone);
      this.stoneGone = true;
    }
    if (this.time >= MAX_TIME) {
      this.done = true;
      return;
    }
    // 石弹碎掉后，所有东西都静止下来（或者掉出场地）持续一小会儿就提前结束。
    // 不只看 cannon 的睡眠状态：站在砖上的小士兵会有极小的抖动，一直进不了睡眠
    if (!this.stoneGone) return;
    const calm = this.bodies.every(({ body: b }) => {
      if (b.sleepState === CANNON.Body.SLEEPING) return true;
      if (b.position.y < -2 || Math.abs(b.position.x) > CF_ARENA || Math.abs(b.position.z) > CF_ARENA) return true;
      return b.velocity.lengthSquared() < CALM_V * CALM_V && b.angularVelocity.lengthSquared() < CALM_W * CALM_W;
    });
    this.calmFor = calm ? this.calmFor + STEP : 0;
    if (this.calmFor >= CALM_TIME) this.done = true;
  }

  run(): void {
    while (!this.done) this.step();
  }

  /** 当前各物体的状态（不取整，前端动画用） */
  snapshot(): CfBody[] {
    return this.bodies.map(({ def, body }) => ({
      ...def,
      p: [body.position.x, body.position.y, body.position.z],
      q: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
    }));
  }

  /** 模拟结束后的结算：取整位置、移走出界的方块、找出阵亡的士兵 */
  result(): CfSimResult {
    const bodies: CfBody[] = [];
    const killed: CfBody[] = [];
    for (const b of this.snapshot()) {
      const p = b.p.map((v) => round(v, 1e4)) as CfBody["p"];
      const q = b.q.map((v) => round(v, 1e5)) as CfBody["q"];
      const next = { ...b, p, q };
      const out = Math.abs(p[0]) > CF_ARENA || Math.abs(p[2]) > CF_ARENA || p[1] < -2;
      if (b.kind === "soldier" && cfSoldierDown(next)) killed.push(next);
      else if (!out) bodies.push(next);
    }
    return { bodies, killed };
  }
}
