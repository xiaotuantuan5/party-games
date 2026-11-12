import {
  GAMES,
  MOYU_BOSS_DPS,
  MOYU_BOSS_GIVE_UP_S,
  MOYU_BOSS_HEAL_RATIO,
  MOYU_BOSS_HP_PER_LEVEL,
  MOYU_BOSS_LEVEL_S,
  MOYU_BOSS_RETREAT_RATIO,
  MOYU_BOSS_RETREATS,
  MOYU_BOSS_WALK_S,
  MOYU_COFFEE_COOLDOWN_S,
  MOYU_COFFEE_COST,
  MOYU_COFFEE_STUN_S,
  MOYU_COST,
  MOYU_DOOR,
  MOYU_GEAR,
  MOYU_PREP_S,
  MOYU_REPAIR_COOLDOWN_S,
  MOYU_REPAIR_RATIO,
  MOYU_START_COINS,
  MOYU_TOTAL_S,
  MOYU_TURRET,
  moyuBossDps,
  moyuBossMaxHp,
  moyuMaxLevel,
  moyuRepairCost,
  type MoyuAction,
  type MoyuBossMode,
  type MoyuItem,
  type MoyuLogEntry,
  type MoyuOutcome,
  type MoyuPhase,
  type MoyuPlayerStats,
  type MoyuResult,
  type MoyuView,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface Desk {
  ownerId: string;
  doorLv: number;
  doorHp: number;
  gearLv: number;
  turretLv: number;
  broken: boolean;
  vacant: boolean;
}

interface Boss {
  level: number;
  hp: number;
  maxHp: number;
  mode: MoyuBossMode;
  desk: number;
  /** walking / retreating 到达的时刻 */
  arriveAt: number;
  /** 开始敲当前这家的时刻 */
  attackSince: number;
  stunUntil: number;
  retreatsLeft: number;
  nextLevelAt: number;
}

interface State {
  t: number;
  phase: MoyuPhase;
  desks: Desk[];
  players: Record<string, MoyuPlayerStats>;
  repairReadyAt: Record<string, number>;
  coffeeReadyAt: number;
  boss: Boss;
  log: MoyuLogEntry[];
  seq: number;
  result: MoyuResult | null;
}

const LOG_LIMIT = 40;

const doorMax = (d: Desk) => MOYU_DOOR[d.doorLv]!.hp;
const active = (d: Desk) => !d.broken && !d.vacant;
const deskOf = (s: State, playerId: string) => s.desks.findIndex((d) => d.ownerId === playerId);

function log(s: State, entry: Omit<MoyuLogEntry, "seq" | "t">): void {
  s.log.push({ ...entry, seq: ++s.seq, t: s.t });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function pay(s: State, playerId: string, cost: number): void {
  const p = s.players[playerId]!;
  if (p.coins < cost) throw new GameError(`摸鱼币不够，还差 ${cost - p.coins}`);
  p.coins -= cost;
}

/**
 * 挑下一个工位：一半概率去隔板最薄的那家，否则随机。
 * 换人时（exclude）尽量不回同一家，只剩一家就没得选。
 */
function pickTarget(s: State, exclude = -1): void {
  const b = s.boss;
  let candidates = s.desks.map((d, i) => (active(d) ? i : -1)).filter((i) => i >= 0);
  if (candidates.length > 1 && exclude >= 0) candidates = candidates.filter((i) => i !== exclude);
  if (candidates.length === 0) return;

  let target: number;
  if (Math.random() < 0.5) {
    target = candidates.reduce((best, i) => (s.desks[i]!.doorHp < s.desks[best]!.doorHp ? i : best));
  } else {
    target = candidates[Math.floor(Math.random() * candidates.length)]!;
  }
  b.mode = "walking";
  b.desk = target;
  b.arriveAt = s.t + MOYU_BOSS_WALK_S;
  log(s, { kind: "target", targetId: s.desks[target]!.ownerId, desk: target, text: "老板朝 {target} 的工位走过去了" });
}

function end(s: State, outcome: MoyuOutcome): void {
  s.phase = "ended";
  const winners = outcome === "allCaught" ? [] : s.desks.filter(active).map((d) => d.ownerId);
  s.result = { outcome, winners, endedAt: s.t };
  const text = {
    survived: "18:00 到了，下班！没被抓的人获胜",
    bossDown: "老板被气得提前回家了，大家提前下班！",
    allCaught: "所有人都被抓了，老板获胜",
  }[outcome];
  log(s, { kind: "end", text });
}

function checkAllCaught(s: State): boolean {
  if (s.desks.some(active)) return false;
  end(s, "allCaught");
  return true;
}

function bossStep(s: State): void {
  const b = s.boss;

  if (s.t === MOYU_PREP_S) {
    s.phase = "work";
    b.level = 1;
    b.nextLevelAt = s.t + MOYU_BOSS_LEVEL_S;
    log(s, { kind: "wake", text: "早会结束，老板出来巡查了！" });
    pickTarget(s);
    return;
  }

  if (s.t >= b.nextLevelAt && b.level < MOYU_BOSS_DPS.length) {
    b.level++;
    b.maxHp = moyuBossMaxHp(b.level);
    b.hp += MOYU_BOSS_HP_PER_LEVEL;
    b.nextLevelAt += MOYU_BOSS_LEVEL_S;
    log(s, { kind: "level", text: `老板升到 ${b.level} 级，敲得更狠了` });
  }

  switch (b.mode) {
    case "walking":
      if (s.desks[b.desk] && !active(s.desks[b.desk]!)) pickTarget(s, b.desk);
      else if (s.t >= b.arriveAt) {
        b.mode = "attacking";
        b.attackSince = s.t;
      }
      return;

    case "attacking": {
      const desk = s.desks[b.desk]!;
      if (!active(desk)) {
        pickTarget(s, b.desk);
        return;
      }

      // 炮台先打
      const dps = MOYU_TURRET[desk.turretLv]!.dps;
      if (dps > 0) {
        b.hp = Math.max(0, b.hp - dps);
        s.players[desk.ownerId]!.damage += dps;
        if (b.hp === 0) {
          end(s, "bossDown");
          return;
        }
      }

      if (s.t >= b.stunUntil) {
        desk.doorHp = Math.max(0, desk.doorHp - moyuBossDps(b.level, s.desks.length));
        if (desk.doorHp === 0) {
          desk.broken = true;
          s.players[desk.ownerId]!.caughtAt = s.t;
          log(s, { kind: "caught", targetId: desk.ownerId, desk: b.desk, text: "{target} 的隔板被敲烂了，摸鱼被抓！" });
          if (!checkAllCaught(s)) pickTarget(s, b.desk);
          return;
        }
      }

      if (b.hp <= b.maxHp * MOYU_BOSS_RETREAT_RATIO && b.retreatsLeft > 0) {
        b.retreatsLeft--;
        b.mode = "retreating";
        b.arriveAt = s.t + MOYU_BOSS_WALK_S;
        b.stunUntil = 0;
        log(s, { kind: "retreat", targetId: desk.ownerId, desk: b.desk, text: "老板被 {target} 的炮台打疼了，回办公室喝茶回血" });
        b.desk = -1;
        return;
      }

      if (s.t - b.attackSince >= MOYU_BOSS_GIVE_UP_S && s.desks.filter(active).length > 1) {
        log(s, { kind: "giveUp", targetId: desk.ownerId, desk: b.desk, text: "{target} 的隔板太硬了，老板决定换一家" });
        pickTarget(s, b.desk);
      }
      return;
    }

    case "retreating":
      if (s.t >= b.arriveAt) b.mode = "resting";
      return;

    case "resting":
      b.hp = Math.min(b.maxHp, b.hp + Math.ceil(b.maxHp * MOYU_BOSS_HEAL_RATIO));
      if (b.hp >= b.maxHp) pickTarget(s);
      return;

    case "meeting":
      return;
  }
}

function requireDeskIndex(s: State, raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw >= s.desks.length) throw new GameError("没有这个工位");
  return raw;
}

export const moyu: GameEngine<State, MoyuAction, MoyuView> = {
  meta: GAMES.moyu,

  setup(players) {
    const seats = shuffle(players.map((p) => p.id));
    const stats: Record<string, MoyuPlayerStats> = {};
    for (const id of seats) stats[id] = { coins: MOYU_START_COINS, earned: 0, damage: 0, helps: 0, caughtAt: null, left: false };
    return {
      t: 0,
      phase: "prep",
      desks: seats.map((ownerId) => ({
        ownerId,
        doorLv: 0,
        doorHp: MOYU_DOOR[0].hp,
        gearLv: 0,
        turretLv: 0,
        broken: false,
        vacant: false,
      })),
      players: stats,
      repairReadyAt: {},
      coffeeReadyAt: 0,
      boss: {
        level: 1,
        hp: moyuBossMaxHp(1),
        maxHp: moyuBossMaxHp(1),
        mode: "meeting",
        desk: -1,
        arriveAt: 0,
        attackSince: 0,
        stunUntil: 0,
        retreatsLeft: MOYU_BOSS_RETREATS,
        nextLevelAt: Infinity,
      },
      log: [],
      seq: 0,
      result: null,
    };
  },

  tick(s) {
    if (s.phase === "ended") return false;
    s.t++;

    for (const d of s.desks) {
      if (!active(d)) continue;
      const income = MOYU_GEAR[d.gearLv]!.income;
      const p = s.players[d.ownerId]!;
      p.coins += income;
      p.earned += income;
    }

    if (s.t >= MOYU_PREP_S) bossStep(s);
    // bossStep 可能已经结束了游戏，TS 看不出来，这里重新读一次
    if ((s.phase as MoyuPhase) !== "ended" && s.t >= MOYU_TOTAL_S) end(s, "survived");
    return true;
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("已经下班了");
    const mine = deskOf(s, playerId);
    if (mine < 0) throw new GameError("你不在这局游戏里");
    if (!active(s.desks[mine]!)) throw new GameError("你已经被抓了，只能围观");

    switch (action.type) {
      case "upgrade": {
        const item = action.item as MoyuItem;
        // 用 hasOwn 而不是 in，避免 "__proto__" 这类原型上的键混进来
        if (typeof item !== "string" || !Object.hasOwn(MOYU_COST, item)) throw new GameError("没有这个东西");
        const desk = s.desks[mine]!;
        const key = ({ gear: "gearLv", door: "doorLv", turret: "turretLv" } as const)[item];
        const next = desk[key] + 1;
        if (next > moyuMaxLevel(item)) throw new GameError("已经满级了");
        pay(s, playerId, MOYU_COST[item][next]!);
        if (item === "door") {
          // 升级时多出来的耐久直接补上
          const before = doorMax(desk);
          desk.doorLv = next;
          desk.doorHp += doorMax(desk) - before;
        } else {
          desk[key] = next;
        }
        if (item === "turret" && next === moyuMaxLevel("turret")) {
          log(s, { kind: "upgrade", playerId, desk: mine, text: `{player} 装上了${MOYU_TURRET[next]!.name}！` });
        }
        return;
      }

      case "repair": {
        const idx = requireDeskIndex(s, action.desk);
        const desk = s.desks[idx]!;
        if (!active(desk)) throw new GameError("这个工位已经没人了");
        if (desk.doorHp >= doorMax(desk)) throw new GameError("隔板是满的，不用修");
        const wait = (s.repairReadyAt[playerId] ?? 0) - s.t;
        if (wait > 0) throw new GameError(`扳手还在冷却，${wait} 秒后再修`);
        pay(s, playerId, moyuRepairCost(desk.doorLv));
        desk.doorHp = Math.min(doorMax(desk), desk.doorHp + Math.ceil(doorMax(desk) * MOYU_REPAIR_RATIO));
        s.repairReadyAt[playerId] = s.t + MOYU_REPAIR_COOLDOWN_S;
        if (idx !== mine) {
          s.players[playerId]!.helps++;
          log(s, { kind: "help", playerId, targetId: desk.ownerId, desk: idx, text: "{player} 帮 {target} 修了隔板" });
        }
        return;
      }

      case "coffee": {
        if (s.boss.mode !== "attacking") throw new GameError("老板正在敲隔板时才能递咖啡");
        const wait = s.coffeeReadyAt - s.t;
        if (wait > 0) throw new GameError(`咖啡机还在煮，${wait} 秒后再递`);
        pay(s, playerId, MOYU_COFFEE_COST);
        s.boss.stunUntil = s.t + MOYU_COFFEE_STUN_S;
        s.coffeeReadyAt = s.t + MOYU_COFFEE_COOLDOWN_S;
        log(s, {
          kind: "coffee",
          playerId,
          targetId: s.desks[s.boss.desk]?.ownerId,
          desk: s.boss.desk,
          text: `{player} 给老板递了杯咖啡，老板发呆 ${MOYU_COFFEE_STUN_S} 秒`,
        });
        return;
      }

      default:
        throw new GameError("未知操作");
    }
  },

  viewFor(s, playerId) {
    const b = s.boss;
    const players: Record<string, MoyuPlayerStats> = {};
    for (const [id, p] of Object.entries(s.players)) players[id] = { ...p };
    return {
      gameId: "moyu",
      phase: s.phase,
      t: s.t,
      desks: s.desks.map((d) => ({ ...d, doorMax: doorMax(d) })),
      myDesk: deskOf(s, playerId),
      boss: {
        level: b.level,
        hp: b.hp,
        maxHp: b.maxHp,
        mode: b.mode,
        desk: b.desk,
        etaS: b.mode === "walking" || b.mode === "retreating" ? Math.max(0, b.arriveAt - s.t) : 0,
        stunS: b.mode === "attacking" ? Math.max(0, b.stunUntil - s.t) : 0,
        retreatsLeft: b.retreatsLeft,
        nextLevelS: b.level < MOYU_BOSS_DPS.length && Number.isFinite(b.nextLevelAt) ? b.nextLevelAt - s.t : null,
      },
      players,
      myRepairCooldownS: Math.max(0, (s.repairReadyAt[playerId] ?? 0) - s.t),
      coffeeCooldownS: Math.max(0, s.coffeeReadyAt - s.t),
      log: s.log.slice(-20),
      result: s.result,
    };
  },

  removePlayer(s, playerId) {
    const idx = deskOf(s, playerId);
    if (idx < 0 || s.phase === "ended") return true;
    const desk = s.desks[idx]!;
    s.players[playerId]!.left = true;
    if (!active(desk)) return true;
    desk.vacant = true;
    log(s, { kind: "leave", targetId: playerId, desk: idx, text: "{target} 提前溜了，工位空了" });
    if (!checkAllCaught(s) && s.boss.desk === idx && (s.boss.mode === "walking" || s.boss.mode === "attacking")) {
      pickTarget(s, idx);
    }
    return true;
  },
};
