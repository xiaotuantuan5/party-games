/**
 * 工位摸鱼（玩法参考《猛鬼宿舍》）
 * 每人一个工位，坐着就能摸鱼赚 🐟 摸鱼币，用来升级隔板、摸鱼装备和桌面炮台。
 * 老板开完早会就开始巡查：走到某个工位前敲隔板，隔板被敲烂这个人就被抓了。
 * 撑到 18:00 下班，或者把老板气走，没被抓的人获胜。
 *
 * 服务端每秒结算一次（tick），下面所有时间都以秒为单位。
 */

/** 早会时长：这段时间老板不出来，大家先攒钱升级 */
export const MOYU_PREP_S = 30;
/** 整局时长（包含早会），对应游戏里的 09:00 ~ 18:00 */
export const MOYU_TOTAL_S = 330;
export const MOYU_START_COINS = 20;

/** 摸鱼装备：每秒收入 */
export const MOYU_GEAR = [
  { name: "手机", icon: "📱", income: 2 },
  { name: "平板", icon: "📟", income: 4 },
  { name: "笔记本", icon: "💻", income: 7 },
  { name: "双屏", icon: "🖥", income: 11 },
  { name: "三屏电竞", icon: "🎮", income: 16 },
] as const;

/** 隔板：耐久 */
export const MOYU_DOOR = [
  { name: "纸板", icon: "📦", hp: 100 },
  { name: "木隔板", icon: "🪵", hp: 220 },
  { name: "铁皮隔板", icon: "🔩", hp: 400 },
  { name: "防弹玻璃", icon: "🪟", hp: 700 },
  { name: "保险库门", icon: "🚪", hp: 1100 },
  { name: "核掩体", icon: "🛡", hp: 1600 },
] as const;

/** 桌面炮台：老板在你工位前时每秒造成的伤害 */
export const MOYU_TURRET = [
  { name: "没有", icon: "➖", dps: 0 },
  { name: "订书机", icon: "📎", dps: 5 },
  { name: "橡皮筋弹弓", icon: "🪃", dps: 11 },
  { name: "回形针机枪", icon: "🔫", dps: 19 },
  { name: "打印机加农炮", icon: "🖨", dps: 30 },
  { name: "碎纸机导弹", icon: "🚀", dps: 45 },
] as const;

/** 升到第 i 级的价格（下标 0 不用） */
export const MOYU_COST = {
  gear: [0, 30, 80, 180, 350],
  door: [0, 25, 60, 140, 280, 500],
  turret: [0, 40, 100, 220, 420, 700],
} as const;

export type MoyuItem = keyof typeof MOYU_COST;

export function moyuMaxLevel(item: MoyuItem): number {
  return MOYU_COST[item].length - 1;
}

/** 修隔板：恢复最大耐久的 30%，价格随隔板等级上涨，每人有冷却 */
export const MOYU_REPAIR_RATIO = 0.3;
export const MOYU_REPAIR_COOLDOWN_S = 10;
export function moyuRepairCost(doorLv: number): number {
  return 10 + 5 * doorLv;
}

/** 给老板递咖啡：老板发呆几秒不敲隔板（炮台照打），全场共用冷却 */
export const MOYU_COFFEE_COST = 50;
export const MOYU_COFFEE_STUN_S = 5;
export const MOYU_COFFEE_COOLDOWN_S = 30;

/** 老板：每 40 秒升一级，越来越凶、越来越肉 */
export const MOYU_BOSS_LEVEL_S = 40;
export const MOYU_BOSS_DPS = [12, 20, 29, 40, 53, 68, 85, 104] as const;
export const MOYU_BOSS_BASE_HP = 750;
export const MOYU_BOSS_HP_PER_LEVEL = 220;
/** 走到一个工位要几秒 */
export const MOYU_BOSS_WALK_S = 4;
/** 在同一个工位敲这么久还没敲开，就换一家 */
export const MOYU_BOSS_GIVE_UP_S = 30;
/** 血量低于这个比例回办公室喝茶回血，一局最多回去几次 */
export const MOYU_BOSS_RETREAT_RATIO = 0.3;
export const MOYU_BOSS_RETREATS = 2;
/** 在办公室每秒回复最大血量的比例 */
export const MOYU_BOSS_HEAL_RATIO = 0.1;

/** 人越多老板越凶：5 人 ×1，之后每多 1 人 +0.05（8 人 ×1.15） */
export function moyuBossDps(level: number, players: number): number {
  return Math.round(MOYU_BOSS_DPS[level - 1]! * (1 + Math.max(0, players - 5) * 0.05));
}

export function moyuBossMaxHp(level: number): number {
  return MOYU_BOSS_BASE_HP + MOYU_BOSS_HP_PER_LEVEL * (level - 1);
}

/** 游戏时间 → 墙上的钟（09:00 ~ 18:00） */
export function moyuClock(t: number): string {
  const minutes = 9 * 60 + Math.floor((Math.min(t, MOYU_TOTAL_S) / MOYU_TOTAL_S) * 9 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type MoyuPhase = "prep" | "work" | "ended";

/**
 * meeting：开早会；walking：走向 desk；attacking：在 desk 前敲隔板；
 * retreating：回办公室；resting：在办公室喝茶回血
 */
export type MoyuBossMode = "meeting" | "walking" | "attacking" | "retreating" | "resting";

export interface MoyuBossView {
  level: number;
  hp: number;
  maxHp: number;
  mode: MoyuBossMode;
  /** 正在走向 / 正在敲的工位，不在工位区时为 -1 */
  desk: number;
  /** walking / retreating 时还要几秒到 */
  etaS: number;
  /** 被咖啡绊住还剩几秒 */
  stunS: number;
  retreatsLeft: number;
  /** 距离下次升级还有几秒，满级为 null */
  nextLevelS: number | null;
}

export interface MoyuDeskView {
  ownerId: string;
  doorLv: number;
  doorHp: number;
  doorMax: number;
  gearLv: number;
  turretLv: number;
  /** 隔板被敲烂、主人被抓 */
  broken: boolean;
  /** 主人中途离开，工位空了 */
  vacant: boolean;
}

export interface MoyuPlayerStats {
  coins: number;
  /** 一共摸到的鱼 */
  earned: number;
  /** 炮台对老板造成的总伤害 */
  damage: number;
  /** 帮同事修隔板的次数 */
  helps: number;
  /** 第几秒被抓，没被抓为 null */
  caughtAt: number | null;
  left: boolean;
}

export type MoyuOutcome = "survived" | "bossDown" | "allCaught";

export interface MoyuResult {
  outcome: MoyuOutcome;
  /** 获胜（没被抓）的人 */
  winners: string[];
  endedAt: number;
}

export type MoyuEventKind =
  | "wake"
  | "target"
  | "caught"
  | "retreat"
  | "level"
  | "coffee"
  | "help"
  | "upgrade"
  | "giveUp"
  | "leave"
  | "end";

export interface MoyuLogEntry {
  seq: number;
  kind: MoyuEventKind;
  /** 游戏时间，前端显示成钟点 */
  t: number;
  /** text 中的 {player} 替换成这个人的昵称 */
  playerId?: string;
  /** text 中的 {target} 替换成这个人的昵称 */
  targetId?: string;
  /** 相关工位 */
  desk?: number;
  text: string;
}

export interface MoyuView {
  gameId: "moyu";
  phase: MoyuPhase;
  /** 开局以来过了几秒 */
  t: number;
  /** 工位，下标就是工位号 */
  desks: MoyuDeskView[];
  myDesk: number;
  boss: MoyuBossView;
  players: Record<string, MoyuPlayerStats>;
  /** 自己修隔板的冷却剩余秒数 */
  myRepairCooldownS: number;
  /** 全场咖啡冷却剩余秒数 */
  coffeeCooldownS: number;
  log: MoyuLogEntry[];
  result: MoyuResult | null;
}

export type MoyuAction =
  | { gameId: "moyu"; type: "upgrade"; item: MoyuItem }
  /** 修任意一个工位的隔板（包括自己的） */
  | { gameId: "moyu"; type: "repair"; desk: number }
  | { gameId: "moyu"; type: "coffee" };
