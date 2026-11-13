import { createHash } from "node:crypto";
import {
  GAMES,
  MAX_AVATAR_DATA_URL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  PROP_ITEMS,
  canThrowProps,
  type GameAction,
  type GameId,
  type PlayerInfo,
  type PropItem,
  type PropThrow,
  type QuestMove,
  type RoomView,
} from "@party/shared";
import { ENGINES } from "./games/index.js";
import { GameError, TICK_MS, type AnyGameEngine } from "./games/types.js";

export interface Avatar {
  mime: string;
  data: Buffer;
  /** 内容哈希，放在图片地址里，换头像后浏览器不会用旧缓存 */
  version: string;
}

interface Player extends Omit<PlayerInfo, "avatar"> {
  socketId: string | null;
  avatar: Avatar | null;
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
  /** 随时间推进的游戏用的定时器，没有就是 null */
  ticker: NodeJS.Timeout | null;
}

/** 房间所有人都断线后保留多久（便于刷新页面、切后台后重连） */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

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

const AVATAR_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
};

/** 头像是可选的：没传或传空就是没有头像；传了就必须是合法的小图片 */
export function validateAvatar(raw: unknown): Avatar | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > MAX_AVATAR_DATA_URL_LENGTH) throw new GameError("头像图片太大了");
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!m) throw new GameError("头像格式不对");
  const mime = m[1]!;
  const data = Buffer.from(m[2]!, "base64");
  // 按文件头再确认一次，不信任客户端声明的类型
  if (!AVATAR_TYPES[mime]!(data)) throw new GameError("头像格式不对");
  return { mime, data, version: createHash("sha256").update(data).digest("hex").slice(0, 12) };
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
    return this.rooms.get(code.trim());
  }

  create(playerId: string, name: string, avatar: Avatar | null, socketId: string, gameId?: unknown): Room {
    const code = this.newCode();
    const room: Room = {
      code,
      hostId: playerId,
      players: [{ id: playerId, name, avatar, connected: true, socketId }],
      selectedGame: typeof gameId === "string" && gameId in GAMES ? (gameId as GameId) : "numberBomb",
      game: null,
      gameNo: 0,
      cleanupTimer: null,
      ticker: null,
    };
    this.rooms.set(code, room);
    this.onChange(room);
    return room;
  }

  join(
    code: string,
    playerId: string,
    name: string,
    avatar: Avatar | null,
    socketId: string,
  ): { room: Room; replacedSocketId: string | null } {
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
      existing.avatar = avatar;
    } else {
      if (room.game) throw new GameError("游戏进行中，请等这局结束后再加入");
      if (room.players.length >= MAX_PLAYERS_PER_ROOM) throw new GameError("房间已满");
      if (room.players.some((p) => p.name === name)) throw new GameError("这个昵称已经有人用了");
      room.players.push({ id: playerId, name, avatar, connected: true, socketId });
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
      room.cleanupTimer = setTimeout(() => this.delete(room), EMPTY_ROOM_TTL_MS);
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
      this.delete(room);
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
    this.ensureTicker(room);
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

  /** 扔道具：校验权限和目标，返回要广播的在线玩家 socket（包括扔的人自己） */
  throwProp(code: string, from: string, to: unknown, item: unknown): { event: PropThrow; socketIds: string[] } {
    const room = this.get(code);
    const thrower = room?.players.find((p) => p.id === from);
    if (!room || !thrower) throw new GameError("你不在这个房间");
    if (!canThrowProps(thrower.name)) throw new GameError("你没有扔道具的权限");
    if (typeof to !== "string" || to === from || !room.players.some((p) => p.id === to)) throw new GameError("找不到这个人");
    if (typeof item !== "string" || !(PROP_ITEMS as readonly string[]).includes(item)) throw new GameError("没有这个道具");
    const socketIds = room.players.filter((p) => p.socketId).map((p) => p.socketId!);
    return { event: { from, to, item: item as PropItem }, socketIds };
  }

  /** 只有房间里的玩家的头像才能取到，房间解散或玩家退出后就没了 */
  avatar(code: string, playerId: string): Avatar | null {
    return this.get(code)?.players.find((p) => p.id === playerId)?.avatar ?? null;
  }

  viewFor(room: Room, playerId: string): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.players.map(({ id, name, connected, avatar }) => ({
        id,
        name,
        connected,
        avatar: avatar ? `/avatars/${room.code}/${id}?v=${avatar.version}` : null,
      })),
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

  private delete(room: Room): void {
    this.stopTicker(room);
    this.rooms.delete(room.code);
  }

  /**
   * 当前游戏需要按时间推进时启动定时器。定时器每次都读取 room.game，
   * 所以“再来一局”可以沿用同一个定时器；回到大厅或换成不需要 tick 的游戏时自动停掉。
   */
  private ensureTicker(room: Room): void {
    if (room.ticker || !room.game?.engine.tick) return;
    room.ticker = setInterval(() => {
      const game = room.game;
      if (!game?.engine.tick || this.rooms.get(room.code) !== room) {
        this.stopTicker(room);
        return;
      }
      try {
        if (game.engine.tick(game.state)) this.onChange(room);
      } catch (err) {
        console.error(err);
      }
    }, TICK_MS);
  }

  private stopTicker(room: Room): void {
    if (room.ticker) clearInterval(room.ticker);
    room.ticker = null;
  }

  private newCode(): string {
    for (;;) {
      // 4 位数字，首位不为 0，避免口头报号时把开头的 0 漏掉
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (!this.rooms.has(code)) return code;
    }
  }
}

export type { Room };
