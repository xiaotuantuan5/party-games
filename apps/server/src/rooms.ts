import { createHash } from "node:crypto";
import {
  GAMES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  type GameAction,
  type GameId,
  type PlayerInfo,
  type QuestMove,
  type RoomView,
} from "@party/shared";
import { ENGINES } from "./games/index.js";
import { GameError, type AnyGameEngine } from "./games/types.js";

interface Player extends PlayerInfo {
  socketId: string | null;
}

interface Room {
  code: string;
  hostId: string;
  players: Player[];
  selectedGame: GameId;
  game: { engine: AnyGameEngine; state: unknown } | null;
  /** 每开一局 +1，前端据此在“再来一局”时重置游戏界面 */
  gameNo: number;
  cleanupTimer: NodeJS.Timeout | null;
}

/** 房间所有人都断线后保留多久（便于刷新页面、切后台后重连） */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // 去掉了易混淆的 I、O

/**
 * 客户端在 localStorage 里保存一个随机 token 作为身份凭证。
 * 对外公开的玩家 id 是 token 的哈希，这样别人看到 id 也无法冒充。
 */
export function playerIdFromToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function validateName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new GameError("请输入昵称");
  if ([...name].length > MAX_NAME_LENGTH) throw new GameError(`昵称最多 ${MAX_NAME_LENGTH} 个字`);
  return name;
}

export function validateToken(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 16 || raw.length > 128) throw new GameError("无效的身份凭证");
  return raw;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  /** 状态变化时回调，由上层负责把每个玩家的视图推送出去 */
  constructor(private onChange: (room: Room) => void) {}

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  create(playerId: string, name: string, socketId: string, gameId?: unknown): Room {
    const code = this.newCode();
    const room: Room = {
      code,
      hostId: playerId,
      players: [{ id: playerId, name, connected: true, socketId }],
      selectedGame: typeof gameId === "string" && gameId in GAMES ? (gameId as GameId) : "numberBomb",
      game: null,
      gameNo: 0,
      cleanupTimer: null,
    };
    this.rooms.set(code, room);
    this.onChange(room);
    return room;
  }

  join(code: string, playerId: string, name: string, socketId: string): { room: Room; replacedSocketId: string | null } {
    const room = this.get(code);
    if (!room) throw new GameError("房间不存在");

    let replacedSocketId: string | null = null;
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) {
      // 断线重连 / 换了个标签页
      replacedSocketId = existing.socketId !== socketId ? existing.socketId : null;
      existing.socketId = socketId;
      existing.connected = true;
      existing.name = name;
    } else {
      if (room.game) throw new GameError("游戏进行中，请等这局结束后再加入");
      if (room.players.length >= MAX_PLAYERS_PER_ROOM) throw new GameError("房间已满");
      if (room.players.some((p) => p.name === name)) throw new GameError("这个昵称已经有人用了");
      room.players.push({ id: playerId, name, connected: true, socketId });
    }

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    this.ensureConnectedHost(room);
    this.onChange(room);
    return { room, replacedSocketId };
  }

  /** socket 断开：保留座位，等待重连 */
  disconnect(code: string, playerId: string, socketId: string): void {
    const room = this.get(code);
    const player = room?.players.find((p) => p.id === playerId);
    if (!room || !player || player.socketId !== socketId) return;

    player.connected = false;
    player.socketId = null;
    this.ensureConnectedHost(room);

    if (room.players.every((p) => !p.connected)) {
      room.cleanupTimer = setTimeout(() => this.rooms.delete(room.code), EMPTY_ROOM_TTL_MS);
    }
    this.onChange(room);
  }

  /** 主动退出：让出座位 */
  leave(code: string, playerId: string): void {
    const room = this.get(code);
    if (!room || !room.players.some((p) => p.id === playerId)) return;

    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length === 0) {
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      this.rooms.delete(room.code);
      return;
    }

    if (room.game && !room.game.engine.removePlayer(room.game.state, playerId)) {
      room.game = null;
    }
    if (room.hostId === playerId) room.hostId = room.players[0]!.id;
    this.ensureConnectedHost(room);
    this.onChange(room);
  }

  selectGame(code: string, playerId: string, gameId: unknown): void {
    const room = this.requireHost(code, playerId);
    if (room.game) throw new GameError("游戏进行中");
    if (typeof gameId !== "string" || !(gameId in GAMES)) throw new GameError("未知游戏");
    room.selectedGame = gameId as GameId;
    this.onChange(room);
  }

  start(code: string, playerId: string): void {
    const room = this.requireHost(code, playerId);
    if (room.game) throw new GameError("游戏已经开始了");
    const engine = ENGINES[room.selectedGame];
    const n = room.players.length;
    if (n < engine.meta.minPlayers) throw new GameError(`${engine.meta.name}至少需要 ${engine.meta.minPlayers} 人`);
    if (n > engine.meta.maxPlayers) throw new GameError(`${engine.meta.name}最多 ${engine.meta.maxPlayers} 人`);
    room.game = { engine, state: engine.setup(room.players.map(({ id, name, connected }) => ({ id, name, connected }))) };
    room.gameNo++;
    this.onChange(room);
  }

  action(code: string, playerId: string, action: unknown): void {
    const room = this.get(code);
    if (!room?.players.some((p) => p.id === playerId)) throw new GameError("你不在这个房间");
    if (!room.game) throw new GameError("游戏还没开始");
    if (typeof action !== "object" || action === null) throw new GameError("无效操作");
    if ((action as GameAction).gameId !== room.game.engine.meta.id) throw new GameError("操作与当前游戏不匹配");
    room.game.engine.handleAction(room.game.state, playerId, action);
    this.onChange(room);
  }

  /**
   * 实时位置：交给游戏引擎校验，返回要转发的数据和接收方。
   * 只有离散状态（水晶、机关、终点）变化时才推送完整房间视图，平时只转发位置。
   */
  move(code: string, playerId: string, data: unknown): { relay: QuestMove; socketIds: string[] } | null {
    const room = this.get(code);
    const engine = room?.game?.engine;
    if (!room || !engine?.move || !room.players.some((p) => p.id === playerId)) return null;
    const res = engine.move(room.game!.state, playerId, data);
    if (!res) return null;
    if (res.changed) this.onChange(room);
    const socketIds = room.players.filter((p) => p.id !== playerId && p.socketId).map((p) => p.socketId!);
    return { relay: res.relay, socketIds };
  }

  backToLobby(code: string, playerId: string): void {
    const room = this.requireHost(code, playerId);
    room.game = null;
    this.onChange(room);
  }

  /** 同一个游戏、同一批人直接再来一局 */
  restart(code: string, playerId: string): void {
    const room = this.requireHost(code, playerId);
    room.game = null;
    this.start(code, playerId);
  }

  viewFor(room: Room, playerId: string): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.players.map(({ id, name, connected }) => ({ id, name, connected })),
      selectedGame: room.selectedGame,
      gameNo: room.gameNo,
      game: room.game ? room.game.engine.viewFor(room.game.state, playerId) : null,
    };
  }

  private requireHost(code: string, playerId: string): Room {
    const room = this.get(code);
    if (!room) throw new GameError("房间不存在");
    if (room.hostId !== playerId) throw new GameError("只有房主可以这样做");
    return room;
  }

  /** 房主断线时，把房主交给一位在线玩家，避免整个房间卡住 */
  private ensureConnectedHost(room: Room): void {
    const host = room.players.find((p) => p.id === room.hostId);
    if (host?.connected) return;
    const next = room.players.find((p) => p.connected);
    if (next) room.hostId = next.id;
  }

  private newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}

export type { Room };
