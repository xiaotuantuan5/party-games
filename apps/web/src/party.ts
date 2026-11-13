import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameAction,
  GameId,
  JoinResult,
  PropItem,
  PropThrow,
  QuestMove,
  RoomView,
  ServerToClientEvents,
} from "@party/shared";
import { saveName, savedAvatar, savedName } from "./profile";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const socket: AppSocket = io({ autoConnect: true });

const TOKEN_KEY = "party.token";
const ROOM_KEY = "party.room";

function getToken(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

/** 实时游戏：上报自己的位置。volatile：网络忙时直接丢掉，反正下一包马上就来 */
export function sendMove(move: QuestMove): void {
  if (socket.connected) socket.volatile.emit("game:move", move);
}

/** 实时游戏：订阅其他玩家的位置，返回取消订阅的函数 */
export function onMove(cb: (playerId: string, move: QuestMove) => void): () => void {
  socket.on("game:move", cb);
  return () => {
    socket.off("game:move", cb);
  };
}

/** 扔道具（只有特殊昵称有权限，服务端会再校验一次） */
export function throwProp(to: string, item: PropItem): Promise<void> {
  return socket.emitWithAck("fx:throw", { to, item }).then(unwrap);
}

/** 订阅房间里的扔道具事件，返回取消订阅的函数 */
export function onThrow(cb: (t: PropThrow) => void): () => void {
  socket.on("fx:throw", cb);
  return () => {
    socket.off("fx:throw", cb);
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function unwrap<T>(res: Result<T>): T {
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** 管理与服务端的连接、房间状态，并在断线重连后自动回到原来的房间 */
export function useParty() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [notice, setNotice] = useState<string | null>(null);

  const enter = useCallback((res: JoinResult, name: string) => {
    saveName(name);
    localStorage.setItem(ROOM_KEY, res.code);
    setMe(res.playerId);
    history.replaceState(null, "", `?room=${res.code}`);
  }, []);

  useEffect(() => {
    const rejoin = () => {
      setConnected(true);
      const code = localStorage.getItem(ROOM_KEY);
      const name = savedName();
      if (!code || !name) return;
      socket.emit("room:join", { token: getToken(), name, avatar: savedAvatar(), code }, (res) => {
        if (res.ok) enter(res.data, name);
        else {
          localStorage.removeItem(ROOM_KEY);
          setRoom(null);
        }
      });
    };
    const onDisconnect = () => setConnected(false);
    const onClosed = (reason: string) => {
      localStorage.removeItem(ROOM_KEY);
      setRoom(null);
      setNotice(reason);
    };

    socket.on("connect", rejoin);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", setRoom);
    socket.on("room:closed", onClosed);
    if (socket.connected) rejoin();
    return () => {
      socket.off("connect", rejoin);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", setRoom);
      socket.off("room:closed", onClosed);
    };
  }, [enter]);

  const actions = {
    create: (name: string, gameId?: GameId) =>
      socket
        .emitWithAck("room:create", { token: getToken(), name, avatar: savedAvatar(), gameId })
        .then(unwrap)
        .then((r) => enter(r, name.trim())),
    join: (name: string, code: string) =>
      socket
        .emitWithAck("room:join", { token: getToken(), name, avatar: savedAvatar(), code })
        .then(unwrap)
        .then((r) => enter(r, name.trim())),
    leave: () => {
      socket.emit("room:leave");
      localStorage.removeItem(ROOM_KEY);
      history.replaceState(null, "", location.pathname);
      setRoom(null);
    },
    selectGame: (gameId: GameId) => socket.emitWithAck("room:selectGame", { gameId }).then(unwrap),
    start: () => socket.emitWithAck("game:start").then(unwrap),
    act: (action: GameAction) => socket.emitWithAck("game:action", action).then(unwrap),
    backToLobby: () => socket.emitWithAck("game:backToLobby").then(unwrap),
    restart: () => socket.emitWithAck("game:restart").then(unwrap),
  };

  return { room, me, connected, notice, clearNotice: () => setNotice(null), actions };
}

export type PartyActions = ReturnType<typeof useParty>["actions"];
