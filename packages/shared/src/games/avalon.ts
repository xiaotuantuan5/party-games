export type AvalonRole = "merlin" | "percival" | "servant" | "assassin" | "morgana" | "mordred" | "oberon" | "minion";
export type AvalonTeam = "good" | "evil";

export const AVALON_ROLES: Record<AvalonRole, { name: string; emoji: string; team: AvalonTeam; description: string }> = {
  merlin: {
    name: "梅林",
    emoji: "🧙",
    team: "good",
    description: "你知道谁是坏人（莫德雷德除外）。暗中引导大家，但别暴露自己，否则刺客会刺杀你。",
  },
  percival: {
    name: "派西维尔",
    emoji: "🛡",
    team: "good",
    description: "你能看到梅林和莫甘娜，但分不清谁是谁。找出真梅林，替他挡刀。",
  },
  servant: { name: "亚瑟的忠臣", emoji: "⚔", team: "good", description: "没有特殊信息，靠发言、投票和任务结果找出坏人。" },
  assassin: {
    name: "刺客",
    emoji: "🗡",
    team: "evil",
    description: "你认识其他坏人。如果好人完成 3 个任务，你还有最后一次机会：刺中梅林就能翻盘。",
  },
  morgana: { name: "莫甘娜", emoji: "🧝‍♀️", team: "evil", description: "你认识其他坏人。派西维尔看你和梅林长得一样，假装自己是梅林来迷惑他。" },
  mordred: { name: "莫德雷德", emoji: "👑", team: "evil", description: "你认识其他坏人，而且梅林看不到你。" },
  oberon: { name: "奥伯伦", emoji: "👻", team: "evil", description: "你是坏人，但你不认识队友，队友也不认识你。梅林能看到你。" },
  minion: { name: "莫德雷德的爪牙", emoji: "😈", team: "evil", description: "你认识其他坏人，和他们一起让任务失败。" },
};

/** 每个人数下 5 个任务的出征人数 */
export const AVALON_QUEST_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

/** 7 人及以上时，第 4 个任务需要 2 张失败票才失败 */
export function avalonFailsNeeded(players: number, questIndex: number): number {
  return players >= 7 && questIndex === 3 ? 2 : 1;
}

/** 不同人数的身份配置：5~6 人 2 坏，7~9 人 3 坏，10 人 4 坏 */
export function avalonRoleSetup(players: number): AvalonRole[] {
  const evil: AvalonRole[] = ["assassin", "morgana"];
  if (players >= 7) evil.push("mordred");
  if (players >= 10) evil.push("oberon");
  const good: AvalonRole[] = ["merlin", "percival"];
  while (good.length + evil.length < players) good.push("servant");
  return [...good, ...evil];
}

/** 连续几次组队被否决，坏人直接获胜 */
export const AVALON_MAX_REJECTS = 5;

export type AvalonPhase = "team" | "vote" | "quest" | "assassin" | "ended";

/** 身份牌上看到的别人：坏人（梅林、坏人互认），或“梅林或莫甘娜”（派西维尔） */
export interface AvalonSight {
  playerId: string;
  as: "evil" | "merlinOrMorgana";
}

export interface AvalonQuestResult {
  team: string[];
  /** 失败票张数（不公开谁投的） */
  fails: number;
  success: boolean;
}

export interface AvalonVoteResult {
  questIndex: number;
  /** 本任务第几次组队，从 1 开始 */
  attempt: number;
  leaderId: string;
  team: string[];
  votes: Record<string, boolean>;
  approved: boolean;
}

export type AvalonEventKind = "propose" | "approved" | "rejected" | "questSuccess" | "questFail" | "assassin" | "end";

export interface AvalonLogEntry {
  /** 单局内递增，前端据此识别新事件并播放特效 */
  seq: number;
  kind: AvalonEventKind;
  /** text 中的 {players} 由前端替换成这些人的昵称 */
  playerIds?: string[];
  /** text 中的 {target} 由前端替换成这个人的昵称 */
  targetId?: string;
  text: string;
}

export type AvalonWinReason = "quests" | "rejects" | "assassinHit" | "assassinMiss";

export interface AvalonView {
  gameId: "avalon";
  phase: AvalonPhase;
  order: string[];
  myRole: AvalonRole;
  sight: AvalonSight[];
  questSizes: number[];
  /** 每个任务需要几张失败票才失败 */
  failsNeeded: number[];
  /** 已完成的任务 */
  quests: AvalonQuestResult[];
  /** 当前任务（0~4） */
  questIndex: number;
  leaderId: string;
  /** 当前任务已经被否决了几次 */
  rejects: number;
  /** 投票和任务阶段：本次出征的队伍 */
  team: string[];
  /** 投票中：已经投过票的人（不公开投了什么） */
  votedIds: string[];
  myVote: boolean | null;
  /** 任务中：已经交了任务牌的人 */
  questPlayedIds: string[];
  /** 自己这次交的任务牌 */
  myQuestCard: boolean | null;
  voteResults: AvalonVoteResult[];
  /** 刺杀阶段坏人亮明身份（不说具体角色） */
  evilIds: string[] | null;
  assassinId: string | null;
  assassinTargetId: string | null;
  log: AvalonLogEntry[];
  winner: AvalonTeam | null;
  winReason: AvalonWinReason | null;
  /** 结束后公开所有身份 */
  reveal: Record<string, AvalonRole> | null;
}

export type AvalonAction =
  | { gameId: "avalon"; type: "propose"; teamIds: string[] }
  | { gameId: "avalon"; type: "vote"; approve: boolean }
  /** success=false 表示交失败牌，只有坏人能交 */
  | { gameId: "avalon"; type: "quest"; success: boolean }
  | { gameId: "avalon"; type: "assassinate"; targetId: string };
