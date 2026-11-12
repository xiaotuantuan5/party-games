import type { GameId, GameView, GameAction, QuestMove } from "./games/index.js";

export const MAX_PLAYERS_PER_ROOM = 12;
export const MAX_NAME_LENGTH = 12;
/** 头像以 data URL 上传，前端压缩到 96×96 JPEG，一般只有几 KB */
export const MAX_AVATAR_DATA_URL_LENGTH = 14_000;

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
  /** 头像图片地址（服务端提供），没上传就是 null，前端用昵称首字代替 */
  avatar?: string | null;
}

/** 房间状态。服务端按玩家分别下发，game 字段只包含该玩家可见的信息。 */
export interface RoomView {
  code: string;
  hostId: string;
  players: PlayerInfo[];
  selectedGame: GameId;
  /** 第几局。“再来一局”时会变，前端用它作为 key 让游戏界面重新挂载，清空上一局的动画状态 */
  gameNo: number;
  /** null 表示在大厅等待中 */
  game: GameView | null;
}

export type Ack<T = void> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

/** 加入房间成功后返回。playerId 是 token 的哈希，可以公开。 */
export interface JoinResult {
  code: string;
  playerId: string;
}

export interface ClientToServerEvents {
  /** token 是客户端本地生成并保存的随机串，用于断线重连时识别身份，不会下发给其他人 */
  /** gameId：从首页某个游戏卡片直接开房时预先选好游戏 */
  "room:create": (p: { token: string; name: string; avatar?: string | null; gameId?: GameId }, ack: Ack<JoinResult>) => void;
  "room:join": (p: { token: string; name: string; avatar?: string | null; code: string }, ack: Ack<JoinResult>) => void;
  "room:leave": () => void;
  "room:selectGame": (p: { gameId: GameId }, ack: Ack) => void;
  "game:start": (ack: Ack) => void;
  "game:action": (action: GameAction, ack: Ack) => void;
  "game:backToLobby": (ack: Ack) => void;
  /** 房主一键再来一局（同一个游戏，同一批人） */
  "game:restart": (ack: Ack) => void;
  /** 实时游戏的位置上报，高频、不需要回执，丢了也没关系 */
  "game:move": (move: QuestMove) => void;
}

export interface ServerToClientEvents {
  "room:state": (room: RoomView) => void;
  "room:closed": (reason: string) => void;
  /** 转发其他玩家的实时位置 */
  "game:move": (playerId: string, move: QuestMove) => void;
}
