import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server, type Socket } from "socket.io";
import type { Ack, ClientToServerEvents, ServerToClientEvents } from "@party/shared";
import { GameError } from "./games/types.js";
import { RoomManager, playerIdFromToken, validateAvatar, validateName, validateToken } from "./rooms.js";

interface SocketData {
  playerId?: string;
  roomCode?: string;
  /** 上一次位置上报的时间，用来限流 */
  lastMoveAt?: number;
}

/** 客户端每秒发 12 次左右，超过 25 次的直接丢掉 */
const MIN_MOVE_INTERVAL_MS = 40;

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
  // 所有消息都很小，限制包大小防止滥用
  maxHttpBufferSize: 16 * 1024,
  // 开发时 web 跑在 Vite 的 5173 端口，通过 Vite 代理访问，无需 CORS
});

const rooms = new RoomManager((room) => {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit("room:state", rooms.viewFor(room, p.id));
  }
});

/** 统一处理 ack 和错误：GameError 返回给客户端，其他错误记日志 */
function handle<T>(ack: unknown, fn: () => T): void {
  const reply = typeof ack === "function" ? (ack as Ack<T>) : () => {};
  try {
    reply({ ok: true, data: fn() });
  } catch (err) {
    if (err instanceof GameError) {
      reply({ ok: false, error: err.message });
    } else {
      console.error(err);
      reply({ ok: false, error: "服务器出错了" });
    }
  }
}

function requireRoom(socket: AppSocket): { code: string; playerId: string } {
  const { roomCode, playerId } = socket.data;
  if (!roomCode || !playerId) throw new GameError("你还没有进入房间");
  return { code: roomCode, playerId };
}

/** 一个 socket 同一时间只在一个房间 */
function leaveCurrent(socket: AppSocket): void {
  const { roomCode, playerId } = socket.data;
  if (roomCode && playerId) rooms.leave(roomCode, playerId);
  socket.data.roomCode = undefined;
}

io.on("connection", (socket: AppSocket) => {
  socket.on("room:create", (p, ack) =>
    handle(ack, () => {
      const token = validateToken(p?.token);
      const name = validateName(p?.name);
      const avatar = validateAvatar(p?.avatar);
      leaveCurrent(socket);
      const playerId = playerIdFromToken(token);
      const room = rooms.create(playerId, name, avatar, socket.id, p?.gameId);
      socket.data = { playerId, roomCode: room.code };
      return { code: room.code, playerId };
    }),
  );

  socket.on("room:join", (p, ack) =>
    handle(ack, () => {
      const token = validateToken(p?.token);
      const name = validateName(p?.name);
      const avatar = validateAvatar(p?.avatar);
      const code = typeof p?.code === "string" ? p.code.trim() : "";
      if (socket.data.roomCode && socket.data.roomCode !== code) leaveCurrent(socket);
      const playerId = playerIdFromToken(token);
      const { room, replacedSocketId } = rooms.join(code, playerId, name, avatar, socket.id);
      if (replacedSocketId) {
        io.to(replacedSocketId).emit("room:closed", "你在另一个页面进入了这个房间");
        io.in(replacedSocketId).disconnectSockets(true);
      }
      socket.data = { playerId, roomCode: room.code };
      return { code: room.code, playerId };
    }),
  );

  socket.on("room:leave", () => leaveCurrent(socket));

  socket.on("room:selectGame", (p, ack) =>
    handle(ack, () => {
      const { code, playerId } = requireRoom(socket);
      rooms.selectGame(code, playerId, p?.gameId);
    }),
  );

  socket.on("game:start", (ack) =>
    handle(ack, () => {
      const { code, playerId } = requireRoom(socket);
      rooms.start(code, playerId);
    }),
  );

  socket.on("game:action", (action, ack) =>
    handle(ack, () => {
      const { code, playerId } = requireRoom(socket);
      rooms.action(code, playerId, action);
    }),
  );

  socket.on("game:backToLobby", (ack) =>
    handle(ack, () => {
      const { code, playerId } = requireRoom(socket);
      rooms.backToLobby(code, playerId);
    }),
  );

  socket.on("game:restart", (ack) =>
    handle(ack, () => {
      const { code, playerId } = requireRoom(socket);
      rooms.restart(code, playerId);
    }),
  );

  socket.on("game:move", (move) => {
    const { roomCode, playerId, lastMoveAt = 0 } = socket.data;
    if (!roomCode || !playerId) return;
    const now = Date.now();
    if (now - lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
    socket.data.lastMoveAt = now;
    try {
      const res = rooms.move(roomCode, playerId, move);
      if (res) for (const id of res.socketIds) io.to(id).volatile.emit("game:move", playerId, res.relay);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("disconnect", () => {
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) rooms.disconnect(roomCode, playerId, socket.id);
  });
});

// 头像图片。地址里带内容哈希，可以放心长期缓存
app.get("/avatars/:code/:playerId", (req, res) => {
  const avatar = rooms.avatar(req.params.code, req.params.playerId);
  if (!avatar) {
    res.status(404).end();
    return;
  }
  res.set({
    "Content-Type": avatar.mime,
    "Cache-Control": "public, max-age=86400, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(avatar.data);
});

// 生产环境：同一个端口同时提供前端静态文件
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((_req, res) => res.sendFile(resolve(webDist, "index.html")));
}

httpServer.listen(PORT, () => {
  console.log(`party-games server listening on http://localhost:${PORT}`);
});
