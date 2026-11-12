/**
 * 火柴人刷图的静态配置：技能、强化、属性卡、怪物、房间、评分。
 * 只放数据，方便调数值；逻辑在 stickmanScene.ts。
 */

export type SkillId = "rise" | "dash" | "spin" | "crescent" | "airDance" | "thunder" | "firePunch" | "frost";
export type Element = "fire" | "ice" | "thunder";

export interface SkillUpgrade {
  /** 形如 "crescent.triple"，全局唯一 */
  id: string;
  name: string;
  desc: string;
}

export interface SkillDef {
  id: SkillId;
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

const up = (skill: SkillId, key: string, name: string, desc: string): SkillUpgrade => ({ id: `${skill}.${key}`, name, desc });

export const SKILLS: Record<SkillId, SkillDef> = {
  rise: {
    id: "rise",
    name: "升龙斩",
    icon: "🐉",
    element: null,
    cd: 3,
    mp: 5,
    air: "no",
    desc: "向上挥剑，把面前的敌人挑到半空，自己也跟着跳起，可以接空中技能",
    upgrades: [
      up("rise", "big", "巨龙", "光弧变大，范围扩大 80%"),
      up("rise", "shock", "雷龙", "挑起的敌人附带感电"),
      up("rise", "cd", "疾龙", "冷却缩短 40%"),
    ],
  },
  dash: {
    id: "dash",
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
    name: "旋风斩",
    icon: "🌀",
    element: null,
    cd: 8,
    mp: 15,
    air: "no",
    desc: "原地旋转 1.5 秒，持续伤害并把周围的敌人吸过来，旋转中可以慢慢移动",
    upgrades: [
      up("spin", "long", "飓风", "持续时间翻倍"),
      up("spin", "waves", "风刃", "结束时向四周甩出 8 道月牙斩"),
      up("spin", "shock", "雷暴", "旋风附带感电"),
    ],
  },
  crescent: {
    id: "crescent",
    name: "月牙斩",
    icon: "🌙",
    element: null,
    cd: 4,
    mp: 8,
    air: "no",
    desc: "挥出一道穿透的飞行剑气。放的时候按住上 / 下可以斜着放",
    upgrades: [
      up("crescent", "triple", "三日月", "一次放出 3 道"),
      up("crescent", "huge", "满月", "剑气变大 2 倍"),
      up("crescent", "explode", "爆月", "剑气命中后爆炸"),
    ],
  },
  airDance: {
    id: "airDance",
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
    name: "雷霆落",
    icon: "⚡",
    element: "thunder",
    cd: 9,
    mp: 18,
    air: "yes",
    desc: "跳到空中再砸向地面，引下一道闪电，落点放出电环冲击波",
    upgrades: [
      up("thunder", "wide", "雷域", "冲击波范围扩大 60%"),
      up("thunder", "triple", "三雷", "落地后在附近敌人身上再劈 3 道闪电"),
      up("thunder", "power", "天罚", "伤害 +60%"),
    ],
  },
  firePunch: {
    id: "firePunch",
    name: "爆炎拳",
    icon: "🔥",
    element: "fire",
    cd: 6,
    mp: 12,
    air: "no",
    desc: "向前一拳，在拳头前方炸出火球，把敌人炸飞并灼烧",
    upgrades: [
      up("firePunch", "multi", "连环爆", "向前连续炸出 3 发"),
      up("firePunch", "big", "大爆炎", "爆炸范围扩大 70%"),
      up("firePunch", "burn", "业火", "灼烧时间和伤害翻倍"),
    ],
  },
  frost: {
    id: "frost",
    name: "冰霜领域",
    icon: "❄️",
    element: "ice",
    cd: 12,
    mp: 20,
    air: "no",
    desc: "把剑插进地面，铺开 3 秒的冰面，冒出冰刺，走进来的敌人会被冻住",
    upgrades: [
      up("frost", "long", "永冻", "领域持续时间翻倍"),
      up("frost", "spikes", "冰棘", "冰刺伤害翻倍，并且每秒再冒一次"),
      up("frost", "follow", "随身寒域", "领域跟着你移动"),
    ],
  },
};

export const START_SKILLS: SkillId[] = ["rise", "dash", "spin"];
export const NEW_SKILL_POOL: SkillId[] = ["crescent", "airDance", "thunder", "firePunch", "frost"];
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
  goblin: { name: "哥布林", hp: 650, speed: 3.2, dmg: 60, score: 100, color: 0x4fc04a },
  archer: { name: "弓箭手", hp: 480, speed: 3, dmg: 70, score: 120, color: 0xe8c23a },
  shield: { name: "盾兵", hp: 1200, speed: 2.2, dmg: 80, score: 150, color: 0x9aa3ad },
  bomber: { name: "自爆虫", hp: 220, speed: 5.2, dmg: 150, score: 80, color: 0xff4a3a },
};

export const BOSS = { name: "哥布林酋长", hp: 32000, bars: 8, dmg: 150, score: 5000, color: 0x3f9a3a };

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

export const MAP_NAME = "哥布林洞窟";

export const ROOMS: RoomDef[] = [
  { name: "洞口", width: 30, crates: 3, barrels: 1, waves: [many("goblin", 4), [...many("goblin", 3), ...many("archer", 1)]] },
  {
    name: "岔路",
    width: 30,
    crates: 2,
    barrels: 2,
    waves: [
      [...many("shield", 2), ...many("goblin", 2)],
      [...many("archer", 2), ...many("goblin", 3)],
    ],
  },
  {
    name: "虫巢",
    width: 30,
    crates: 2,
    barrels: 2,
    waves: [
      [...many("bomber", 4), ...many("goblin", 2)],
      [{ kind: "goblin", elite: true }, ...many("archer", 2), ...many("bomber", 2)],
    ],
  },
  {
    name: "营地",
    width: 30,
    crates: 3,
    barrels: 3,
    waves: [
      [...many("shield", 2), ...many("archer", 2), ...many("bomber", 2)],
      [{ kind: "shield", elite: true }, ...many("goblin", 3), ...many("archer", 1)],
    ],
  },
  { name: "酋长王座", width: 26, crates: 0, barrels: 3, waves: [], boss: true },
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
