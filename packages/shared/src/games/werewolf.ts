export type WerewolfRole = "wolf" | "seer" | "witch" | "hunter" | "villager";
export type WerewolfTeam = "good" | "wolf";

export const WEREWOLF_ROLES: Record<WerewolfRole, { name: string; emoji: string; team: WerewolfTeam; description: string }> = {
  wolf: { name: "狼人", emoji: "🐺", team: "wolf", description: "每晚和狼队友一起选一个人刀掉。白天混在好人里，别被投出去。" },
  seer: { name: "预言家", emoji: "🔮", team: "good", description: "每晚查验一个人，知道他是好人还是狼人。" },
  witch: { name: "女巫", emoji: "🧪", team: "good", description: "一瓶解药救当晚被刀的人，一瓶毒药毒死任何人，各用一次，同一晚只能用一瓶，不能自救。" },
  hunter: { name: "猎人", emoji: "🔫", team: "good", description: "被狼刀死或被投出局时，可以开枪带走一个人。被毒死不能开枪。" },
  villager: { name: "村民", emoji: "🧑‍🌾", team: "good", description: "没有技能，靠发言和投票找出狼人。" },
};

/** 不同人数的身份配置 */
export function werewolfRoleSetup(players: number): WerewolfRole[] {
  const wolves = players >= 11 ? 4 : players >= 8 ? 3 : 2;
  const roles: WerewolfRole[] = Array(wolves).fill("wolf");
  roles.push("seer", "witch");
  if (players >= 7) roles.push("hunter");
  while (roles.length < players) roles.push("villager");
  return roles;
}

export type WerewolfPhase = "night" | "hunter" | "day" | "vote" | "ended";
export type WerewolfDeathCause = "night" | "vote" | "shot" | "leave";

export interface WerewolfDeath {
  playerId: string;
  round: number;
  /** 夜里死的不公开是被刀还是被毒 */
  cause: WerewolfDeathCause;
}

export interface WerewolfVoteResult {
  round: number;
  /** 投票人 → 被投的人，null 表示弃票 */
  votes: Record<string, string | null>;
  exiledId: string | null;
}

export type WerewolfEventKind = "night" | "dawn" | "vote" | "exile" | "shot" | "leave" | "end";

export interface WerewolfLogEntry {
  /** 单局内递增，前端据此识别新事件并播放特效 */
  seq: number;
  kind: WerewolfEventKind;
  /** text 中的 {players} 由前端替换成这些人的昵称 */
  playerIds?: string[];
  /** text 中的 {target} 由前端替换成这个人的昵称 */
  targetId?: string;
  text: string;
}

/**
 * 只发给自己的夜间信息。
 * 不下发当前是狼人阶段还是女巫阶段，否则别人能推断出女巫是否还活着。
 */
export interface WerewolfNightView {
  /** 自己现在要做的事，没有就是 null */
  task: "wolf" | "seer" | "witch" | null;
  /** 今晚自己的任务已经完成（狼人：刀口已锁定；预言家：已查验） */
  done: boolean;
  /** 狼人：每个狼队友选的目标 */
  wolfVotes: Record<string, string> | null;
  /** 女巫（还有解药时）：今晚被刀的人 */
  wolfTargetId: string | null;
}

export interface WerewolfView {
  gameId: "werewolf";
  phase: WerewolfPhase;
  round: number;
  order: string[];
  alive: string[];
  myRole: WerewolfRole;
  /** 自己是狼人时，所有狼人（包括自己） */
  wolfTeam: string[] | null;
  night: WerewolfNightView | null;
  /** 自己是预言家时的查验记录 */
  seerChecks: { round: number; targetId: string; isWolf: boolean }[] | null;
  /** 自己是女巫时剩下的药 */
  potions: { antidote: boolean; poison: boolean } | null;
  /** 天亮后公布昨晚死了谁（白天和投票阶段一直显示） */
  lastNightDeaths: string[] | null;
  /** 白天建议的发言顺序 */
  speakOrder: string[];
  /** 白天：已经准备好投票的人 */
  readyIds: string[];
  /** 投票中：已经投过票的人（不公开投给谁） */
  votedIds: string[];
  /** 猎人开枪阶段：猎人亮明身份 */
  hunterId: string | null;
  deaths: WerewolfDeath[];
  voteResults: WerewolfVoteResult[];
  log: WerewolfLogEntry[];
  winner: WerewolfTeam | null;
  /** 结束后公开所有身份 */
  reveal: Record<string, WerewolfRole> | null;
}

export type WerewolfAction =
  | { gameId: "werewolf"; type: "wolfKill"; targetId: string }
  | { gameId: "werewolf"; type: "seerCheck"; targetId: string }
  /** 不救也不毒就两个都不传 */
  | { gameId: "werewolf"; type: "witch"; save?: boolean; poisonId?: string | null }
  /** targetId 为 null 表示不开枪 */
  | { gameId: "werewolf"; type: "hunterShoot"; targetId: string | null }
  | { gameId: "werewolf"; type: "ready"; ready: boolean }
  /** targetId 为 null 表示弃票 */
  | { gameId: "werewolf"; type: "vote"; targetId: string | null };
