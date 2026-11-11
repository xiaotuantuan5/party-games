import { useState } from "react";
import { GAMES } from "@party/shared";
import { NumberBomb } from "./games/NumberBomb";
import { Undercover } from "./games/Undercover";
import { useParty, savedName, type PartyActions } from "./party";
import { useRun, type GameProps } from "./ui";

export function App() {
  const { room, me, connected, notice, clearNotice, actions } = useParty();

  return (
    <div className="app">
      {!connected && <div className="banner">连接中断，正在重连…</div>}
      {notice && (
        <div className="banner" onClick={clearNotice}>
          {notice}
        </div>
      )}
      {!room || !me ? <Home actions={actions} /> : <RoomScreen room={room} me={me} actions={actions} />}
    </div>
  );
}

function Home({ actions }: { actions: PartyActions }) {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(new URLSearchParams(location.search).get("room") ?? "");
  const { error, run } = useRun();

  return (
    <main className="card">
      <h1>🎉 聚会小游戏</h1>
      <label>
        昵称
        <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="输入你的昵称" />
      </label>
      <button disabled={!name.trim()} onClick={() => run(actions.create(name))}>
        创建房间
      </button>
      <div className="divider">或者</div>
      <label>
        房间号
        <input
          value={code}
          maxLength={4}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="4 位房间号"
        />
      </label>
      <button disabled={!name.trim() || code.length !== 4} onClick={() => run(actions.join(name, code))}>
        加入房间
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function RoomScreen({ room, me, actions }: GameProps) {
  const isHost = room.hostId === me;
  const { error, run } = useRun();
  const inviteUrl = `${location.origin}${location.pathname}?room=${room.code}`;

  return (
    <main className="card">
      <header className="room-header">
        <div>
          房间 <strong className="code">{room.code}</strong>
          <button className="link" onClick={() => navigator.clipboard?.writeText(inviteUrl)}>
            复制邀请链接
          </button>
        </div>
        <button className="link" onClick={actions.leave}>
          退出
        </button>
      </header>

      <ul className="players">
        {room.players.map((p) => (
          <li key={p.id} className={p.connected ? "" : "offline"}>
            {p.id === room.hostId && "👑 "}
            {p.name}
            {p.id === me && "（我）"}
            {!p.connected && "（离线）"}
          </li>
        ))}
      </ul>

      {room.game ? (
        <>
          {room.game.gameId === "numberBomb" && <NumberBomb room={room} me={me} actions={actions} />}
          {room.game.gameId === "undercover" && <Undercover room={room} me={me} actions={actions} />}
          {isHost && (
            <button className="secondary" onClick={() => run(actions.backToLobby())}>
              {room.game.phase === "ended" ? "回到大厅" : "结束本局，回到大厅"}
            </button>
          )}
        </>
      ) : (
        <section>
          <h2>选择游戏</h2>
          <div className="games">
            {Object.values(GAMES).map((g) => (
              <button
                key={g.id}
                className={`game-option ${room.selectedGame === g.id ? "selected" : ""}`}
                disabled={!isHost}
                onClick={() => run(actions.selectGame(g.id))}
              >
                <strong>{g.name}</strong>
                <span>
                  {g.minPlayers}~{g.maxPlayers} 人
                </span>
                <small>{g.description}</small>
              </button>
            ))}
          </div>
          {isHost ? (
            <button onClick={() => run(actions.start())}>开始游戏</button>
          ) : (
            <p className="hint">等待房主开始游戏…</p>
          )}
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
