import {
  AVALON_MAX_REJECTS,
  AVALON_QUEST_SIZES,
  AVALON_ROLES,
  GAMES,
  avalonFailsNeeded,
  avalonRoleSetup,
  type AvalonAction,
  type AvalonLogEntry,
  type AvalonPhase,
  type AvalonQuestResult,
  type AvalonRole,
  type AvalonSight,
  type AvalonTeam,
  type AvalonView,
  type AvalonVoteResult,
  type AvalonWinReason,
} from "@party/shared";
import { GameError, shuffle, type GameEngine } from "./types.js";

interface State {
  roles: Record<string, AvalonRole>;
  seats: string[];
  phase: AvalonPhase;
  questSizes: number[];
  failsNeeded: number[];
  quests: AvalonQuestResult[];
  leaderIndex: number;
  rejects: number;
  team: string[];
  votes: Record<string, boolean>;
  /** 任务牌：true 成功，false 失败 */
  questCards: Record<string, boolean>;
  voteResults: AvalonVoteResult[];
  assassinTargetId: string | null;
  log: AvalonLogEntry[];
  seq: number;
  winner: AvalonTeam | null;
  winReason: AvalonWinReason | null;
}

const LOG_LIMIT = 60;
const QUEST_NAMES = ["第一", "第二", "第三", "第四", "第五"];

const teamOf = (s: State, id: string): AvalonTeam => AVALON_ROLES[s.roles[id]!].team;
const isEvil = (s: State, id: string) => teamOf(s, id) === "evil";
const leaderOf = (s: State) => s.seats[s.leaderIndex % s.seats.length]!;
const questIndex = (s: State) => s.quests.length;

function log(s: State, entry: Omit<AvalonLogEntry, "seq">): void {
  s.log.push({ ...entry, seq: ++s.seq });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function bySeat(s: State, ids: string[]): string[] {
  return [...ids].sort((a, b) => s.seats.indexOf(a) - s.seats.indexOf(b));
}

function end(s: State, winner: AvalonTeam, reason: AvalonWinReason, text: string): void {
  s.phase = "ended";
  s.winner = winner;
  s.winReason = reason;
  log(s, { kind: "end", text });
}

function startTeam(s: State): void {
  s.phase = "team";
  s.team = [];
  s.votes = {};
  s.questCards = {};
}

/** 队长依次轮换，不论组队是否通过 */
function nextLeader(s: State): void {
  s.leaderIndex = (s.leaderIndex + 1) % s.seats.length;
}

function tallyVotes(s: State): void {
  if (!s.seats.every((id) => id in s.votes)) return;
  const approvals = Object.values(s.votes).filter(Boolean).length;
  const approved = approvals * 2 > s.seats.length;
  const leaderId = leaderOf(s);
  s.voteResults.push({
    questIndex: questIndex(s),
    attempt: s.rejects + 1,
    leaderId,
    team: [...s.team],
    votes: { ...s.votes },
    approved,
  });
  nextLeader(s);

  if (approved) {
    s.rejects = 0;
    s.phase = "quest";
    s.questCards = {};
    log(s, { kind: "approved", playerIds: s.team, text: `${approvals} 票赞成，{players} 出发执行任务` });
    return;
  }
  s.rejects++;
  if (s.rejects >= AVALON_MAX_REJECTS) {
    log(s, { kind: "rejected", text: `${approvals} 票赞成，组队被否决` });
    end(s, "evil", "rejects", `连续 ${AVALON_MAX_REJECTS} 次组队被否决，坏人获胜！`);
    return;
  }
  log(s, { kind: "rejected", text: `${approvals} 票赞成，组队被否决（${s.rejects}/${AVALON_MAX_REJECTS}）` });
  startTeam(s);
}

function resolveQuestIfComplete(s: State): void {
  if (!s.team.every((id) => id in s.questCards)) return;
  const qi = questIndex(s);
  const fails = Object.values(s.questCards).filter((c) => !c).length;
  const success = fails < s.failsNeeded[qi]!;
  s.quests.push({ team: [...s.team], fails, success });
  const name = `${QUEST_NAMES[qi]}个任务`;
  log(s, {
    kind: success ? "questSuccess" : "questFail",
    playerIds: s.team,
    text: success
      ? `${name}成功${fails ? `（有 ${fails} 张失败，但还不够）` : ""}`
      : `${name}失败，出现了 ${fails} 张失败`,
  });

  const wins = s.quests.filter((q) => q.success).length;
  const losses = s.quests.length - wins;
  if (losses >= 3) {
    end(s, "evil", "quests", "3 个任务失败，坏人获胜！");
    return;
  }
  if (wins >= 3) {
    s.phase = "assassin";
    s.team = [];
    s.questCards = {};
    log(s, { kind: "assassin", text: "好人完成了 3 个任务！坏人亮明身份，刺客准备刺杀梅林…" });
    return;
  }
  startTeam(s);
}

/** 自己身份牌上能看到哪些人 */
function sightFor(s: State, playerId: string): AvalonSight[] {
  const role = s.roles[playerId];
  const others = s.seats.filter((id) => id !== playerId);
  switch (role) {
    case "merlin":
      return others.filter((id) => isEvil(s, id) && s.roles[id] !== "mordred").map((id) => ({ playerId: id, as: "evil" }));
    case "percival":
      return others
        .filter((id) => s.roles[id] === "merlin" || s.roles[id] === "morgana")
        .map((id) => ({ playerId: id, as: "merlinOrMorgana" }));
    case "assassin":
    case "morgana":
    case "mordred":
    case "minion":
      return others.filter((id) => isEvil(s, id) && s.roles[id] !== "oberon").map((id) => ({ playerId: id, as: "evil" }));
    default:
      return [];
  }
}

export const avalon: GameEngine<State, AvalonAction, AvalonView> = {
  meta: GAMES.avalon,

  setup(players) {
    const seats = shuffle(players.map((p) => p.id));
    const roleList = shuffle(avalonRoleSetup(seats.length));
    const roles: Record<string, AvalonRole> = {};
    seats.forEach((id, i) => (roles[id] = roleList[i]!));
    const questSizes = AVALON_QUEST_SIZES[seats.length];
    if (!questSizes) throw new GameError(`阿瓦隆需要 ${GAMES.avalon.minPlayers}~${GAMES.avalon.maxPlayers} 人`);

    const s: State = {
      roles,
      seats,
      phase: "team",
      questSizes,
      failsNeeded: questSizes.map((_, i) => avalonFailsNeeded(seats.length, i)),
      quests: [],
      leaderIndex: 0,
      rejects: 0,
      team: [],
      votes: {},
      questCards: {},
      voteResults: [],
      assassinTargetId: null,
      log: [],
      seq: 0,
      winner: null,
      winReason: null,
    };
    startTeam(s);
    return s;
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("游戏已结束");
    if (!s.seats.includes(playerId)) throw new GameError("你不在这局游戏里");

    switch (action.type) {
      case "propose": {
        if (s.phase !== "team") throw new GameError("现在不是组队阶段");
        if (leaderOf(s) !== playerId) throw new GameError("只有队长可以组队");
        const ids = Array.isArray(action.teamIds) ? action.teamIds : [];
        const team = [...new Set(ids)];
        if (team.length !== ids.length || team.some((id) => typeof id !== "string" || !s.seats.includes(id))) {
          throw new GameError("队伍里有无效的玩家");
        }
        const size = s.questSizes[questIndex(s)]!;
        if (team.length !== size) throw new GameError(`这个任务需要 ${size} 个人`);
        s.team = bySeat(s, team);
        s.votes = {};
        s.phase = "vote";
        log(s, { kind: "propose", playerIds: [playerId], text: `队长 {players} 提名了队伍，请投票` });
        return;
      }
      case "vote": {
        if (s.phase !== "vote") throw new GameError("现在不是投票阶段");
        if (playerId in s.votes) throw new GameError("你已经投过票了");
        if (typeof action.approve !== "boolean") throw new GameError("请选择赞成或反对");
        s.votes[playerId] = action.approve;
        tallyVotes(s);
        return;
      }
      case "quest": {
        if (s.phase !== "quest") throw new GameError("现在不是执行任务的时候");
        if (!s.team.includes(playerId)) throw new GameError("你不在这次的队伍里");
        if (playerId in s.questCards) throw new GameError("你已经交过任务牌了");
        if (typeof action.success !== "boolean") throw new GameError("请选择任务牌");
        if (!action.success && !isEvil(s, playerId)) throw new GameError("好人只能交成功");
        s.questCards[playerId] = action.success;
        resolveQuestIfComplete(s);
        return;
      }
      case "assassinate": {
        if (s.phase !== "assassin") throw new GameError("现在不能刺杀");
        if (s.roles[playerId] !== "assassin") throw new GameError("只有刺客可以刺杀");
        const target = action.targetId;
        if (typeof target !== "string" || !s.seats.includes(target)) throw new GameError("请选择一位玩家");
        if (isEvil(s, target)) throw new GameError("要刺杀的是好人阵营的梅林");
        s.assassinTargetId = target;
        if (s.roles[target] === "merlin") {
          end(s, "evil", "assassinHit", "刺客刺中了梅林，坏人翻盘获胜！");
        } else {
          end(s, "good", "assassinMiss", "刺客没有刺中梅林，好人获胜！");
        }
        return;
      }
      default:
        throw new GameError("未知操作");
    }
  },

  viewFor(s, playerId) {
    const role = s.roles[playerId] ?? "servant";
    const ended = s.phase === "ended";
    const showEvil = s.phase === "assassin" || ended;
    const assassinId = s.seats.find((id) => s.roles[id] === "assassin") ?? null;

    return {
      gameId: "avalon",
      phase: s.phase,
      order: s.seats,
      myRole: role,
      sight: sightFor(s, playerId),
      questSizes: s.questSizes,
      failsNeeded: s.failsNeeded,
      quests: s.quests,
      questIndex: questIndex(s),
      leaderId: leaderOf(s),
      rejects: s.rejects,
      team: s.team,
      votedIds: s.phase === "vote" ? Object.keys(s.votes) : [],
      myVote: s.phase === "vote" ? (s.votes[playerId] ?? null) : null,
      questPlayedIds: s.phase === "quest" ? Object.keys(s.questCards) : [],
      myQuestCard: s.phase === "quest" ? (s.questCards[playerId] ?? null) : null,
      voteResults: s.voteResults.slice(-10),
      evilIds: showEvil ? s.seats.filter((id) => isEvil(s, id)) : null,
      assassinId: showEvil ? assassinId : null,
      assassinTargetId: s.assassinTargetId,
      log: s.log.slice(-30),
      winner: s.winner,
      winReason: s.winReason,
      reveal: ended ? s.roles : null,
    };
  },

  // 阿瓦隆没有人出局，人数和任务配置绑定，少一个人就没法继续
  removePlayer(s, playerId) {
    return s.phase === "ended" || !s.seats.includes(playerId);
  },
};
