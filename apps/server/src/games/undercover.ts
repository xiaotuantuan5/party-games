import {
  GAMES,
  UNDERCOVER_MAX_DESCRIPTION,
  type UndercoverAction,
  type UndercoverRole,
  type UndercoverView,
} from "@party/shared";
import { GameError, randomInt, shuffle, type GameEngine } from "./types.js";
import { WORD_PAIRS } from "./undercoverWords.js";

interface State {
  civilianWord: string;
  undercoverWord: string;
  roles: Record<string, UndercoverRole>;
  /** 固定的座位顺序；每轮描述按这个顺序跳过出局者 */
  seats: string[];
  alive: string[];
  round: number;
  phase: "describe" | "vote" | "ended";
  speakerIdx: number;
  descriptions: { round: number; playerId: string; text: string }[];
  votes: Record<string, string>;
  results: { round: number; eliminatedId: string | null; votes: Record<string, string> }[];
  winner: UndercoverRole | null;
}

function undercoverCount(players: number): number {
  return players >= 7 ? 2 : 1;
}

function roundOrder(s: State): string[] {
  return s.seats.filter((id) => s.alive.includes(id));
}

function checkWinner(s: State): void {
  const aliveUnder = s.alive.filter((id) => s.roles[id] === "undercover").length;
  const aliveCiv = s.alive.length - aliveUnder;
  if (aliveUnder === 0) s.winner = "civilian";
  else if (aliveUnder >= aliveCiv) s.winner = "undercover";
  if (s.winner) s.phase = "ended";
}

function startRound(s: State): void {
  s.round++;
  s.phase = "describe";
  s.speakerIdx = 0;
  s.votes = {};
}

function tallyIfComplete(s: State): void {
  if (s.phase !== "vote") return;
  if (!s.alive.every((id) => id in s.votes)) return;

  const counts = new Map<string, number>();
  for (const target of Object.values(s.votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const top = [...counts].filter(([, c]) => c === max).map(([id]) => id);
  // 平票则本轮无人出局
  const eliminatedId = top.length === 1 ? top[0]! : null;

  s.results.push({ round: s.round, eliminatedId, votes: { ...s.votes } });
  if (eliminatedId) s.alive = s.alive.filter((id) => id !== eliminatedId);

  checkWinner(s);
  if (!s.winner) startRound(s);
}

export const undercover: GameEngine<State, UndercoverAction, UndercoverView> = {
  meta: GAMES.undercover,

  setup(players) {
    const pair = WORD_PAIRS[randomInt(0, WORD_PAIRS.length - 1)]!;
    const [civilianWord, undercoverWord] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];
    const seats = shuffle(players.map((p) => p.id));
    const undercovers = new Set(shuffle(seats).slice(0, undercoverCount(seats.length)));
    const roles: Record<string, UndercoverRole> = {};
    for (const id of seats) roles[id] = undercovers.has(id) ? "undercover" : "civilian";

    const s: State = {
      civilianWord,
      undercoverWord,
      roles,
      seats,
      alive: [...seats],
      round: 0,
      phase: "describe",
      speakerIdx: 0,
      descriptions: [],
      votes: {},
      results: [],
      winner: null,
    };
    startRound(s);
    return s;
  },

  handleAction(s, playerId, action) {
    if (s.phase === "ended") throw new GameError("游戏已结束");
    if (!s.alive.includes(playerId)) throw new GameError("你已出局");

    if (action.type === "describe") {
      if (s.phase !== "describe") throw new GameError("现在是投票阶段");
      if (roundOrder(s)[s.speakerIdx] !== playerId) throw new GameError("还没轮到你描述");
      const text = String(action.text ?? "").trim();
      if (!text) throw new GameError("描述不能为空");
      if (text.length > UNDERCOVER_MAX_DESCRIPTION) throw new GameError(`描述最多 ${UNDERCOVER_MAX_DESCRIPTION} 个字`);
      const myWord = s.roles[playerId] === "undercover" ? s.undercoverWord : s.civilianWord;
      if (text.includes(myWord)) throw new GameError("描述里不能直接出现你的词");

      s.descriptions.push({ round: s.round, playerId, text });
      s.speakerIdx++;
      if (s.speakerIdx >= roundOrder(s).length) s.phase = "vote";
      return;
    }

    if (action.type === "vote") {
      if (s.phase !== "vote") throw new GameError("现在还不能投票");
      if (playerId in s.votes) throw new GameError("你已经投过票了");
      if (action.targetId === playerId) throw new GameError("不能投自己");
      if (!s.alive.includes(action.targetId)) throw new GameError("只能投给场上的玩家");
      s.votes[playerId] = action.targetId;
      tallyIfComplete(s);
      return;
    }

    throw new GameError("未知操作");
  },

  viewFor(s, playerId) {
    const ended = s.phase === "ended";
    const order = roundOrder(s);
    return {
      gameId: "undercover",
      phase: s.phase,
      round: s.round,
      myWord: s.roles[playerId] === "undercover" ? s.undercoverWord : s.civilianWord,
      alive: s.alive,
      order,
      currentSpeakerId: s.phase === "describe" ? (order[s.speakerIdx] ?? null) : null,
      descriptions: s.descriptions,
      votedPlayerIds: Object.keys(s.votes),
      results: s.results,
      winner: s.winner,
      reveal: ended ? { roles: s.roles, civilianWord: s.civilianWord, undercoverWord: s.undercoverWord } : null,
    };
  },

  removePlayer(s, playerId) {
    if (!s.alive.includes(playerId) || s.phase === "ended") return true;

    if (s.phase === "describe") {
      // 如果退出者排在当前描述者之前，当前指针需要前移
      const idx = roundOrder(s).indexOf(playerId);
      if (idx < s.speakerIdx) s.speakerIdx--;
    }
    s.alive = s.alive.filter((id) => id !== playerId);
    delete s.votes[playerId];
    for (const [voter, target] of Object.entries(s.votes)) {
      if (target === playerId) delete s.votes[voter];
    }

    checkWinner(s);
    if (s.winner) return true;
    if (s.phase === "describe" && s.speakerIdx >= roundOrder(s).length) s.phase = "vote";
    tallyIfComplete(s);
    return true;
  },
};
