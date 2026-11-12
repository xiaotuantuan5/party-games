/**
 * 火柴人刷图的静态配置：角色、技能、强化、属性卡、敌人、房间、评分。
 * 只放数据，方便调数值；逻辑在 stickmanScene.ts。
 */

export type RoleId = "sword" | "spear" | "fist" | "dart" | "fan";
export type Element = "fire" | "ice" | "thunder";

export type SkillId =
  // 剑客
  | "rise" | "dash" | "spin" | "crescent" | "airDance" | "thunder" | "firePunch" | "frost"
  // 枪客
  | "longOut" | "backStab" | "sweep" | "plumBlossom"
  // 拳师
  | "powerPunch" | "quake" | "whirl" | "bell"
  // 暗器师
  | "flyKnife" | "fanDarts" | "shadowStep" | "caltrops"
  // 扇舞者
  | "flyingFan" | "sleeveHook" | "inkStorm" | "fanWave";

export interface SkillUpgrade {
  /** 形如 "longOut.twin"，全局唯一 */
  id: string;
  name: string;
  desc: string;
  /** 数值类强化：伤害、范围、冷却、持续时间的倍数。没有的字段表示不改 */
  mod?: { dmg?: number; size?: number; cd?: number; dur?: number };
}

export interface SkillDef {
  id: SkillId;
  role: RoleId;
  name: string;
  icon: string;
  element: Element | null;
  /** 冷却（秒） */
  cd: number;
  mp: number;
  /** no：只能在地面放；yes：地面空中都行；only：只能在空中放 */
  air: "no" | "yes" | "only";
  desc: string;
  upgrades: [SkillUpgrade, SkillUpgrade, SkillUpgrade];
}

const up = (skill: SkillId, key: string, name: string, desc: string, mod?: SkillUpgrade["mod"]): SkillUpgrade => ({
  id: `${skill}.${key}`,
  name,
  desc,
  mod,
});

export const SKILLS: Record<SkillId, SkillDef> = {
  // ================= 剑客 =================
  rise: {
    id: "rise",
    role: "sword",
    name: "升龙斩",
    icon: "🐉",
    element: null,
    cd: 3,
    mp: 5,
    air: "no",
    desc: "向上挥剑，把面前的敌人挑到半空，自己也跟着跳起，可以接空中技能",
    upgrades: [
      up("rise", "big", "巨龙", "光弧变大，范围扩大 80%", { size: 1.8 }),
      up("rise", "shock", "雷龙", "挑起的敌人附带感电"),
      up("rise", "cd", "疾龙", "冷却缩短 40%", { cd: 0.6 }),
    ],
  },
  dash: {
    id: "dash",
    role: "sword",
    name: "疾风突刺",
    icon: "💨",
    element: null,
    cd: 5,
    mp: 8,
    air: "no",
    desc: "向前冲刺，刺穿路径上的所有敌人，冲刺中无敌，随后斩痕爆开",
    upgrades: [
      up("dash", "twice", "连闪", "冲刺后 1 秒内可以免费再冲一次"),
      up("dash", "frostEnd", "霜痕", "终点放出一片小冰霜领域"),
      up("dash", "fireTrail", "炎痕", "冲刺路径留下 2 秒火焰"),
    ],
  },
  spin: {
    id: "spin",
    role: "sword",
    name: "旋风斩",
    icon: "🌀",
    element: null,
    cd: 8,
    mp: 15,
    air: "no",
    desc: "原地旋转 1.5 秒，持续伤害并把周围的敌人吸过来，旋转中可以慢慢移动",
    upgrades: [
      up("spin", "long", "飓风", "持续时间翻倍", { dur: 2 }),
      up("spin", "waves", "风刃", "结束时向四周甩出 8 道月牙斩"),
      up("spin", "shock", "雷暴", "旋风附带感电"),
    ],
  },
  crescent: {
    id: "crescent",
    role: "sword",
    name: "月牙斩",
    icon: "🌙",
    element: null,
    cd: 4,
    mp: 8,
    air: "no",
    desc: "挥出一道穿透的飞行剑气。放的时候按住上 / 下可以斜着放",
    upgrades: [
      up("crescent", "triple", "三日月", "一次放出 3 道"),
      up("crescent", "huge", "满月", "剑气变大 2 倍", { size: 2 }),
      up("crescent", "explode", "爆月", "剑气命中后爆炸"),
    ],
  },
  airDance: {
    id: "airDance",
    role: "sword",
    name: "空中连舞",
    icon: "✨",
    element: null,
    cd: 7,
    mp: 12,
    air: "only",
    desc: "只能在空中放：连续斩击 6 次，自己和敌人都停在空中",
    upgrades: [
      up("airDance", "more", "乱舞", "斩击次数 6 → 10"),
      up("airDance", "finisher", "坠星", "结束时向下劈出冲击波"),
      up("airDance", "fire", "炎舞", "斩击附带灼烧"),
    ],
  },
  thunder: {
    id: "thunder",
    role: "sword",
    name: "雷霆落",
    icon: "⚡",
    element: "thunder",
    cd: 9,
    mp: 18,
    air: "yes",
    desc: "跳到空中再砸向地面，引下一道闪电，落点放出电环冲击波",
    upgrades: [
      up("thunder", "wide", "雷域", "冲击波范围扩大 60%", { size: 1.6 }),
      up("thunder", "triple", "三雷", "落地后在附近敌人身上再劈 3 道闪电"),
      up("thunder", "power", "天罚", "伤害 +60%", { dmg: 1.6 }),
    ],
  },
  firePunch: {
    id: "firePunch",
    role: "sword",
    name: "爆炎拳",
    icon: "🔥",
    element: "fire",
    cd: 6,
    mp: 12,
    air: "no",
    desc: "向前一拳，在拳头前方炸出火球，把敌人炸飞并灼烧",
    upgrades: [
      up("firePunch", "multi", "连环爆", "向前连续炸出 3 发"),
      up("firePunch", "big", "大爆炎", "爆炸范围扩大 70%", { size: 1.7 }),
      up("firePunch", "burn", "业火", "灼烧时间和伤害翻倍"),
    ],
  },
  frost: {
    id: "frost",
    role: "sword",
    name: "冰霜领域",
    icon: "❄️",
    element: "ice",
    cd: 12,
    mp: 20,
    air: "no",
    desc: "把剑插进地面，铺开 3 秒的冰面，冒出冰刺，走进来的敌人会被冻住",
    upgrades: [
      up("frost", "long", "永冻", "领域持续时间翻倍", { dur: 2 }),
      up("frost", "spikes", "冰棘", "冰刺伤害翻倍，并且每秒再冒一次", { dmg: 2 }),
      up("frost", "follow", "随身寒域", "领域跟着你移动"),
    ],
  },

  // ================= 枪客 =================
  longOut: {
    id: "longOut",
    role: "spear",
    name: "龙出水",
    icon: "🐲",
    element: null,
    cd: 4,
    mp: 8,
    air: "no",
    desc: "直线突刺，穿透路径上所有敌人，枪尖拖出一条青龙虚影",
    upgrades: [
      up("longOut", "long", "长龙", "突刺距离和伤害 +50%", { size: 1.5, dmg: 1.5 }),
      up("longOut", "twin", "双龙", "同时刺出两道青龙，左右各偏一点"),
      up("longOut", "fire", "炎龙", "龙身带火，命中后灼烧"),
    ],
  },
  backStab: {
    id: "backStab",
    role: "spear",
    name: "回马枪",
    icon: "↩️",
    element: null,
    cd: 5,
    mp: 10,
    air: "no",
    desc: "后撤一步再反刺。闪避结束后 1 秒内放这一招，会自动接上",
    upgrades: [
      up("backStab", "quick", "疾回", "冷却缩短 40%", { cd: 0.6 }),
      up("backStab", "heavy", "重刺", "伤害 +60%", { dmg: 1.6 }),
      up("backStab", "wind", "回风", "收枪时把周围的敌人震开"),
    ],
  },
  sweep: {
    id: "sweep",
    role: "spear",
    name: "横扫千军",
    icon: "🌪️",
    element: null,
    cd: 7,
    mp: 14,
    air: "no",
    desc: "以自己为中心横扫一圈，敌人被扫飞",
    upgrades: [
      up("sweep", "wide", "千军", "扫击范围 +40%", { size: 1.4 }),
      up("sweep", "knock", "震退", "敌人被击飞得更高"),
      up("sweep", "spin", "回旋", "扫两圈，伤害 +30%", { dmg: 1.3 }),
    ],
  },
  plumBlossom: {
    id: "plumBlossom",
    role: "spear",
    name: "梅花三弄",
    icon: "🌸",
    element: "ice",
    cd: 9,
    mp: 16,
    air: "yes",
    desc: "三连快刺，每刺一下落下一朵红梅形的光影，可以在空中用",
    upgrades: [
      up("plumBlossom", "more", "五弄", "刺击次数 3 → 5"),
      up("plumBlossom", "blossom", "落梅", "梅花落地时再造成一次伤害", { dmg: 1.3 }),
      up("plumBlossom", "frost", "寒梅", "命中的敌人被冻住 1 秒"),
    ],
  },

  // ================= 拳师 =================
  powerPunch: {
    id: "powerPunch",
    role: "fist",
    name: "崩山拳",
    icon: "👊",
    element: null,
    cd: 6,
    mp: 12,
    air: "no",
    desc: "蓄力一拳，出拳时身后山影压下，地面冲击波把敌人推开",
    upgrades: [
      up("powerPunch", "heavy", "重崩", "伤害 +50%", { dmg: 1.5 }),
      up("powerPunch", "shock", "震域", "冲击波范围 +50%", { size: 1.5 }),
      up("powerPunch", "quick", "连崩", "冷却缩短 30%", { cd: 0.7 }),
    ],
  },
  quake: {
    id: "quake",
    role: "fist",
    name: "震地拳",
    icon: "🪨",
    element: null,
    cd: 9,
    mp: 16,
    air: "no",
    desc: "一拳砸地，周围敌人被震浮空，地面裂出纹路",
    upgrades: [
      up("quake", "wide", "地动", "震波范围 +40%", { size: 1.4 }),
      up("quake", "crack", "地裂", "裂纹处持续灼烧 3 秒"),
      up("quake", "stun", "震晕", "被震中的敌人被震得更高"),
    ],
  },
  whirl: {
    id: "whirl",
    role: "fist",
    name: "旋风腿",
    icon: "🦵",
    element: null,
    cd: 5,
    mp: 10,
    air: "no",
    desc: "原地回旋踢，腿风能打到身后的敌人",
    upgrades: [
      up("whirl", "long", "连环腿", "持续时间 +50%", { dur: 1.5 }),
      up("whirl", "knock", "撩阴", "踢中的敌人被击飞"),
      up("whirl", "fast", "疾风", "冷却缩短 30%", { cd: 0.7 }),
    ],
  },
  bell: {
    id: "bell",
    role: "fist",
    name: "金钟罩",
    icon: "🔔",
    element: null,
    cd: 16,
    mp: 20,
    air: "no",
    desc: "4 秒金色护体，期间受到的伤害减半",
    upgrades: [
      up("bell", "long", "金身", "持续时间 +50%", { dur: 1.5 }),
      up("bell", "heal", "回春", "结束时回复 20% 血量"),
      up("bell", "reflect", "反震", "挡下的伤害会反弹给周围的敌人"),
    ],
  },

  // ================= 暗器师 =================
  flyKnife: {
    id: "flyKnife",
    role: "dart",
    name: "飞刀",
    icon: "🗡️",
    element: null,
    cd: 2.5,
    mp: 6,
    air: "yes",
    desc: "一把飞刀直线飞出，命中时炸出一小团火花",
    upgrades: [
      up("flyKnife", "triple", "三刃", "一次飞出 3 把，扇形散开"),
      up("flyKnife", "fire", "火刃", "飞刀带火，命中后灼烧", { dmg: 1.2 }),
      up("flyKnife", "pierce", "穿心", "飞刀穿透敌人，伤害 +40%", { dmg: 1.4 }),
    ],
  },
  fanDarts: {
    id: "fanDarts",
    role: "dart",
    name: "天女散花",
    icon: "🌼",
    element: null,
    cd: 6,
    mp: 12,
    air: "no",
    desc: "扇形抛出 7 枚暗器，每一枚落点都留下一道细线",
    upgrades: [
      up("fanDarts", "more", "满天花雨", "暗器数量 7 → 11", { size: 1.3 }),
      up("fanDarts", "poison", "淬毒", "命中的敌人持续掉血", { dmg: 1.2 }),
      up("fanDarts", "wide", "散花", "扇形角度扩大", { size: 1.5 }),
    ],
  },
  shadowStep: {
    id: "shadowStep",
    role: "dart",
    name: "暗影步",
    icon: "🌑",
    element: null,
    cd: 8,
    mp: 14,
    air: "no",
    desc: "隐身后瞬移到最近敌人身后，瞬移后的第一击伤害翻倍",
    upgrades: [
      up("shadowStep", "crit", "杀气", "瞬移后的第一击伤害翻倍", { dmg: 2 }),
      up("shadowStep", "long", "长影", "隐身时间 +1.5 秒", { dur: 1.5 }),
      up("shadowStep", "smoke", "烟遁", "瞬移后留下一团墨烟"),
    ],
  },
  caltrops: {
    id: "caltrops",
    role: "dart",
    name: "毒蒺藜",
    icon: "🕷️",
    element: null,
    cd: 10,
    mp: 16,
    air: "no",
    desc: "脚下撒一片毒蒺藜，敌人踩上后减速并持续掉血",
    upgrades: [
      up("caltrops", "more", "满地", "撒出的范围 +50%", { size: 1.5 }),
      up("caltrops", "poison", "剧毒", "毒伤害翻倍", { dmg: 2 }),
      up("caltrops", "long", "久毒", "持续时间 +50%", { dur: 1.5 }),
    ],
  },

  // ================= 扇舞者 =================
  flyingFan: {
    id: "flyingFan",
    role: "fan",
    name: "飞花扇",
    icon: "🪭",
    element: null,
    cd: 5,
    mp: 10,
    air: "yes",
    desc: "折扇飞出去旋转一圈再飞回手中，途中化成一圈花瓣刃",
    upgrades: [
      up("flyingFan", "twin", "双扇", "同时飞出两把扇子"),
      up("flyingFan", "petal", "落英", "花瓣刃的伤害 +50%", { dmg: 1.5 }),
      up("flyingFan", "far", "远飞", "飞行距离 +50%", { size: 1.5 }),
    ],
  },
  sleeveHook: {
    id: "sleeveHook",
    role: "fan",
    name: "水袖卷",
    icon: "🎐",
    element: null,
    cd: 7,
    mp: 12,
    air: "no",
    desc: "扇面一挥，把远处的敌人拉到身边",
    upgrades: [
      up("sleeveHook", "pull", "长袖", "拉扯距离 +50%", { size: 1.5 }),
      up("sleeveHook", "stun", "缠绵", "被拉来的敌人会被击飞"),
      up("sleeveHook", "wide", "广袖", "判定范围 +40%", { size: 1.4 }),
    ],
  },
  inkStorm: {
    id: "inkStorm",
    role: "fan",
    name: "墨扇风暴",
    icon: "🖌️",
    element: null,
    cd: 14,
    mp: 22,
    air: "no",
    desc: "扇面展开成墨色旋风持续数秒，墨点飞散后在地上留下水墨痕迹",
    upgrades: [
      up("inkStorm", "long", "墨染", "持续时间 +50%", { dur: 1.5 }),
      up("inkStorm", "ink", "泼墨", "地上的墨痕会灼烧敌人"),
      up("inkStorm", "wide", "满墨", "旋风范围 +40%", { size: 1.4 }),
    ],
  },
  fanWave: {
    id: "fanWave",
    role: "fan",
    name: "扇面一挥",
    icon: "💨",
    element: null,
    cd: 4,
    mp: 8,
    air: "no",
    desc: "扇面向前一挥，推出一道风刃，把敌人推开",
    upgrades: [
      up("fanWave", "push", "狂风", "敌人被推得更远", { size: 1.4 }),
      up("fanWave", "wide", "回风", "风刃范围 +40%", { size: 1.4 }),
      up("fanWave", "quick", "快扇", "冷却缩短 30%", { cd: 0.7 }),
    ],
  },
};

export interface RoleDef {
  id: RoleId;
  name: string;
  icon: string;
  weapon: "sword" | "spear" | "fist" | "dagger" | "fan";
  desc: string;
  hp: number;
  /** 攻击力，100 为基准 */
  atk: number;
  mpRegen: number;
  start: SkillId[];
  pool: SkillId[];
  awaken: { name: string; desc: string };
  /** 觉醒时画面的主色调 */
  tint: number;
}

export const ROLES: Record<RoleId, RoleDef> = {
  sword: {
    id: "sword",
    name: "剑客",
    icon: "⚔️",
    weapon: "sword",
    desc: "均衡的近战，技能多，招式连贯",
    hp: 1200,
    atk: 100,
    mpRegen: 4,
    start: ["rise", "dash", "spin"],
    pool: ["crescent", "airDance", "thunder", "firePunch", "frost"],
    awaken: { name: "万剑归宗", desc: "背后展开 100 把光剑，依次射向全屏敌人，最后合成巨剑劈下" },
    tint: 0xfff0b0,
  },
  spear: {
    id: "spear",
    name: "枪客",
    icon: "🐉",
    weapon: "spear",
    desc: "攻击距离远，能隔着敌人突刺，枪尖带着青龙虚影",
    hp: 1100,
    atk: 95,
    mpRegen: 4,
    start: ["longOut", "sweep", "backStab"],
    pool: ["plumBlossom"],
    awaken: { name: "龙啸九天", desc: "青龙从屏幕一侧游过，沿途咬中所有敌人，最后枪尖刺穿画面中心" },
    tint: 0x7affd8,
  },
  fist: {
    id: "fist",
    name: "拳师",
    icon: "👊",
    weapon: "fist",
    desc: "血厚、近身爆发高，能蓄力重拳，还有金钟罩护体",
    hp: 1400,
    atk: 115,
    mpRegen: 3,
    start: ["powerPunch", "whirl", "quake"],
    pool: ["bell"],
    awaken: { name: "罗汉伏魔", desc: "金身佛影在身后浮现，拳头落下时震屏，敌人全部倒地" },
    tint: 0xffc83a,
  },
  dart: {
    id: "dart",
    name: "暗器师",
    icon: "🗡️",
    weapon: "dagger",
    desc: "远程输出，有隐身和瞬移，血最少，要保持距离",
    hp: 900,
    atk: 90,
    mpRegen: 5,
    start: ["flyKnife", "fanDarts", "shadowStep"],
    pool: ["caltrops"],
    awaken: { name: "千机暗雨", desc: "满屏暗器从天而降，落点留下毒雾" },
    tint: 0xc8d4e8,
  },
  fan: {
    id: "fan",
    name: "扇舞者",
    icon: "🪭",
    weapon: "fan",
    desc: "中距离，会拉人、会扇风，墨扇风暴能困住一群敌人",
    hp: 1000,
    atk: 95,
    mpRegen: 4,
    start: ["flyingFan", "sleeveHook", "inkStorm"],
    pool: ["fanWave"],
    awaken: { name: "满月风华", desc: "扇子展开成一轮满月，满屏花瓣，被月光照中的敌人停住" },
    tint: 0xf4f8ff,
  },
};

export const ROLE_ORDER: RoleId[] = ["sword", "spear", "fist", "dart", "fan"];
/** 每个角色最多学满几个技能（技能栏） */
export const MAX_SLOTS = 6;
/** 每个技能最多强化几次 */
export const MAX_SKILL_LEVEL = 2;

export type StatId = "crit" | "atk" | "mpRegen" | "maxHp" | "dodgeBuff" | "cdr";

export const STATS: Record<StatId, { name: string; icon: string; desc: string }> = {
  crit: { name: "会心", icon: "🎯", desc: "暴击率 +15%" },
  atk: { name: "力量", icon: "💪", desc: "攻击力 +20%" },
  mpRegen: { name: "冥想", icon: "💧", desc: "MP 回复速度 +40%" },
  maxHp: { name: "体魄", icon: "❤️", desc: "最大 HP +20%，并回复 30% HP" },
  dodgeBuff: { name: "见切", icon: "🌬", desc: "闪避后 2 秒内伤害 +30%" },
  cdr: { name: "专注", icon: "⏱", desc: "所有技能冷却 -15%" },
};

export type Card =
  | { kind: "skill"; skill: SkillId }
  | { kind: "upgrade"; skill: SkillId; upgrade: string }
  | { kind: "stat"; stat: StatId };

export type EnemyKind = "goblin" | "archer" | "shield" | "bomber";

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  score: number;
  color: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  goblin: { name: "山贼刀手", hp: 650, speed: 3.2, dmg: 60, score: 100, color: 0x3a3a42 },
  archer: { name: "山贼弓手", hp: 480, speed: 3, dmg: 70, score: 120, color: 0x4a4a52 },
  shield: { name: "藤牌兵", hp: 1200, speed: 2.2, dmg: 80, score: 150, color: 0x6a6258 },
  bomber: { name: "火药傀儡", hp: 220, speed: 5.2, dmg: 150, score: 80, color: 0xa33a2a },
};

export const BOSS = { name: "血煞堂主", hp: 32000, bars: 8, dmg: 150, score: 5000, color: 0x7a1414 };

export interface Spawn {
  kind: EnemyKind;
  elite?: boolean;
}

export interface RoomDef {
  name: string;
  width: number;
  waves: Spawn[][];
  crates: number;
  barrels: number;
  boss?: boolean;
}

const many = (kind: EnemyKind, n: number): Spawn[] => Array.from({ length: n }, () => ({ kind }));

export const MAP_NAME = "古寺夜战";

export const ROOMS: RoomDef[] = [
  { name: "山门", width: 30, crates: 3, barrels: 1, waves: [many("goblin", 4), [...many("goblin", 3), ...many("archer", 1)]] },
  {
    name: "竹林",
    width: 30,
    crates: 2,
    barrels: 2,
    waves: [
      [...many("shield", 2), ...many("goblin", 2)],
      [...many("archer", 2), ...many("goblin", 3)],
    ],
  },
  {
    name: "古寺庭院",
    width: 30,
    crates: 2,
    barrels: 2,
    waves: [
      [...many("bomber", 4), ...many("goblin", 2)],
      [{ kind: "goblin", elite: true }, ...many("archer", 2), ...many("bomber", 2)],
    ],
  },
  {
    name: "藏经楼",
    width: 30,
    crates: 3,
    barrels: 3,
    waves: [
      [...many("shield", 2), ...many("archer", 2), ...many("bomber", 2)],
      [{ kind: "shield", elite: true }, ...many("goblin", 3), ...many("archer", 1)],
    ],
  },
  { name: "血煞大殿", width: 26, crates: 0, barrels: 3, waves: [], boss: true },
];

export const GRADES = ["SSS", "SS", "S", "A", "B", "C", "D"] as const;
export type Grade = (typeof GRADES)[number];
const GRADE_SCORE = [28000, 23000, 18000, 14000, 10000, 6000, 0];

/** 复活过的评分降一档 */
export function gradeFor(score: number, revived: boolean): Grade {
  let i = GRADE_SCORE.findIndex((s) => score >= s);
  if (i < 0) i = GRADES.length - 1;
  if (revived) i = Math.min(GRADES.length - 1, i + 1);
  return GRADES[i]!;
}

export const ELEMENT_COLOR: Record<Element, number> = { fire: 0xff6a20, ice: 0x6ad8ff, thunder: 0xb47aff };
