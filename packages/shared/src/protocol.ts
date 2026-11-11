import type { GameId, GameView, GameAction } from "./games/index.js";

export const MAX_PLAYERS_PER_ROOM = 12;
export const MAX_NAME_LENGTH = 12;

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}

/** 房间状态。服务端按玩家分别下发，game 字段只包含该玩家可见的信息。 */
export interface RoomView {
  code: string;
  hostId: string;
  players: PlayerInfo[];
  selectedGame: GameId;
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
  "room:create": (p: { token: string; name: string }, ack: Ack<JoinResult>) => void;
  "room:join": (p: { token: string; name: string; code: string }, ack: Ack<JoinResult>) => void;
  "room:leave": () => void;
  "room:selectGame": (p: { gameId: GameId }, ack: Ack) => void;
  "game:start": (ack: Ack) => void;
  "game:action": (action: GameAction, ack: Ack) => void;
  "game:backToLobby": (ack: Ack) => void;
}

export interface ServerToClientEvents {
  "room:state": (room: RoomView) => void;
  "room:closed": (reason: string) => void;
}
