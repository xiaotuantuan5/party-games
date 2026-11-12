import { Suspense, lazy, useMemo, useRef, useState, type CSSProperties } from "react";
import { GAME_ORDER, GAMES, type GameId, type RoomView } from "@party/shared";
import { Avatar, AvatarContext, GameCard, GameDetail, Sheet, randomName } from "./components";
import { Avalon } from "./games/Avalon";
import { BombCat } from "./games/BombCat";
import { LiarsBar } from "./games/LiarsBar";
import { NumberBomb } from "./games/NumberBomb";
import { Undercover } from "./games/Undercover";
import { Uno } from "./games/Uno";
import { Werewolf } from "./games/Werewolf";
import { useParty, type PartyActions } from "./party";
import { compressAvatar, saveAvatar, saveName, savedAvatar, savedName } from "./profile";
import { SOLO_GAMES, SOLO_ORDER, getBest, type SoloGameId } from "./solo/soloGames";
import { useRun, type GameProps } from "./ui";

// 3D 层层叠依赖 three.js 和物理引擎，体积较大，进入游戏时才加载
const Jenga = lazy(() => import("./games/Jenga").then((m) => ({ default: m.Jenga })));
// 秘境闯关同样是 3D，进入游戏时才加载
const Quest = lazy(() => import("./games/Quest").then((m) => ({ default: m.Quest })));

// 单人游戏同样依赖 three.js，点开时才加载
const SpaceShooter = lazy(() => import("./solo/SpaceShooter").then((m) => ({ default: m.SpaceShooter })));

const NEW_GAMES: GameId[] = ["avalon", "quest", "werewolf", "uno"];

export function App() {
  const { room, me, connected, notice, clearNotice, actions } = useParty();
  const [solo, setSolo] = useState<SoloGameId | null>(null);

  if (solo) {
    return (
      <Suspense fallback={<div className="solo-loading">🚀 正在加载…</div>}>
        {solo === "spaceShooter" && <SpaceShooter onExit={() => setSolo(null)} />}
      </Suspense>
    );
  }

  return (
    <div className="app">
      {!connected && <div className="banner">连接中断，正在重连…</div>}
      {notice && (
        <div className="banner" onClick={clearNotice}>
          {notice}
        </div>
      )}
      {!room || !me ? (
        <Home actions={actions} onSolo={setSolo} />
      ) : (
        <RoomAvatars room={room}>
          <RoomScreen room={room} me={me} actions={actions} />
        </RoomAvatars>
      )}
    </div>
  );
}

/** 把房间里所有人的头像交给各游戏的 Avatar 组件 */
function RoomAvatars({ room, children }: { room: RoomView; children: React.ReactNode }) {
  const map = useMemo(() => new Map(room.players.flatMap((p) => (p.avatar ? [[p.id, p.avatar] as const] : []))), [room.players]);
  return <AvatarContext.Provider value={map}>{children}</AvatarContext.Provider>;
}

/** 首页最上方的一条：头像（点一下换图）+ 昵称，改了马上存到本机 */
function ProfileBar({
  name,
  onName,
  invalid,
  nameRef,
}: {
  name: string;
  onName: (v: string) => void;
  invalid: boolean;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [avatar, setAvatar] = useState(savedAvatar());
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setAvatarError(null);
    try {
      const url = await compressAvatar(file);
      saveAvatar(url);
      setAvatar(url);
    } catch (e) {
      setAvatarError((e as Error).message);
    }
  };
  const clear = () => {
    saveAvatar(null);
    setAvatar(null);
  };

  return (
    <>
      <header className={`profile-bar ${invalid ? "invalid" : ""}`}>
        <button type="button" className="profile-avatar" title="换头像" onClick={() => fileRef.current?.click()}>
          <Avatar name={name || "?"} seed={name || "?"} src={avatar} size={34} />
          <span className="profile-avatar-edit" aria-hidden>
            📷
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={nameRef}
          className="profile-name"
          value={name}
          maxLength={12}
          placeholder="点这里起个昵称"
          aria-label="昵称"
          onChange={(e) => onName(e.target.value)}
        />
        {avatar && (
          <button type="button" className="profile-btn" title="去掉头像" onClick={clear}>
            ×
          </button>
        )}
        <button type="button" className="profile-btn" title="随机一个昵称" onClick={() => onName(randomName())}>
          🎲
        </button>
      </header>
      {invalid && <p className="error">先起个昵称，朋友才知道你是谁</p>}
      {avatarError && <p className="error">{avatarError}</p>}
    </>
  );
}

type HomeTab = "multi" | "solo";
const TAB_KEY = "party.homeTab";

function Home({ actions, onSolo }: { actions: PartyActions; onSolo: (id: SoloGameId) => void }) {
  const invited = (new URLSearchParams(location.search).get("room") ?? "").toUpperCase();
  // 被邀请时一定停在多人页；否则记住上次看的是哪一页
  const [tab, setTabState] = useState<HomeTab>(() =>
    !invited && localStorage.getItem(TAB_KEY) === "solo" ? "solo" : "multi",
  );
  const setTab = (t: HomeTab) => {
    setTabState(t);
    localStorage.setItem(TAB_KEY, t);
  };
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(invited);
  const [detail, setDetail] = useState<GameId | null>(null);
  const [nameError, setNameError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const { error, run } = useRun();

  const requireName = () => {
    if (name.trim()) return true;
    setDetail(null);
    setNameError(true);
    nameRef.current?.focus();
    return false;
  };
  const changeName = (v: string) => {
    setName(v);
    setNameError(false);
    saveName(v);
  };
  const create = (gameId: GameId) => requireName() && run(actions.create(name, gameId));
  const join = () => requireName() && run(actions.join(name, code));

  return (
    <main className="home">
      <ProfileBar name={name} onName={changeName} invalid={nameError} nameRef={nameRef} />

      <header className="hero">
        <h1>🎉 聚会小游戏</h1>
        <p>手机打开就能玩，开个房间把链接发给朋友</p>
      </header>

      <nav className="home-tabs" role="tablist" aria-label="游戏分类">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "multi"}
          className={tab === "multi" ? "active" : ""}
          onClick={() => setTab("multi")}
        >
          👥 多人一起玩 <span className="home-tab-count">{GAME_ORDER.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "solo"}
          className={tab === "solo" ? "active" : ""}
          onClick={() => setTab("solo")}
        >
          👤 一个人玩 <span className="home-tab-count">{SOLO_ORDER.length}</span>
        </button>
      </nav>

      {tab === "multi" ? (
        <>
          {invited ? (
            <section className="panel invite-panel">
              <div>
                📨 朋友邀请你加入房间 <strong className="code">{invited}</strong>
              </div>
              <button type="button" className="primary-lg" onClick={join}>
                加入房间
              </button>
            </section>
          ) : null}

          {/* 有房间号的人不多，输入框和标题放同一行，不单独占一块 */}
          <div className="section-row">
            <h2 className="section-title">{invited ? "或者自己开一个房间" : "选个游戏，开房间"}</h2>
            {!invited && (
              <div className="join-inline">
                <input
                  value={code}
                  maxLength={4}
                  placeholder="房间号"
                  aria-label="房间号"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && code.length === 4 && join()}
                />
                <button type="button" disabled={code.length !== 4} onClick={join}>
                  加入
                </button>
              </div>
            )}
          </div>
          <div className="game-grid">
            {GAME_ORDER.map((id) => (
              <GameCard key={id} meta={GAMES[id]} isNew={NEW_GAMES.includes(id)} onClick={() => setDetail(id)} />
            ))}
          </div>
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <>
          <h2 className="section-title">不用开房间，点开就玩，最高分存在本机</h2>
          {SOLO_ORDER.map((id) => {
            const meta = SOLO_GAMES[id];
            const best = getBest(id);
            return (
              <button
                key={id}
                type="button"
                className="solo-card"
                style={{ "--c": meta.color } as CSSProperties}
                onClick={() => onSolo(id)}
              >
                <span className="solo-card-emoji">{meta.emoji}</span>
                <span className="solo-card-info">
                  <span className="solo-card-name">
                    {meta.name}
                    <span className="solo-card-new">NEW</span>
                  </span>
                  <span className="solo-card-tagline">{meta.tagline}</span>
                  <span className="solo-card-meta">
                    👤 单人 · {meta.tags.slice(0, 2).join(" · ")}
                    {best > 0 && ` · 🏆 ${best.toLocaleString()}`}
                  </span>
                </span>
                <span className="solo-card-go">▶</span>
              </button>
            );
          })}
        </>
      )}

      {detail && (
        <Sheet onClose={() => setDetail(null)}>
          <GameDetail meta={GAMES[detail]} />
          <button type="button" className="primary-lg" onClick={() => create(detail)}>
            开房间玩{GAMES[detail].name}
          </button>
        </Sheet>
      )}
    </main>
  );
}

function PlayerList({ room, me }: { room: RoomView; me: string }) {
  return (
    <ul className="player-list">
      {room.players.map((p) => (
        <li key={p.id} className={p.connected ? "" : "offline"}>
          <Avatar name={p.name} seed={p.id} size={28} />
          <span>
            {p.name}
            {p.id === me && "（我）"}
          </span>
          {p.id === room.hostId && <span title="房主">👑</span>}
          {!p.connected && <span className="offline-tag">离线</span>}
        </li>
      ))}
    </ul>
  );
}

function RoomScreen({ room, me, actions }: GameProps) {
  const isHost = room.hostId === me;
  const meta = GAMES[room.game?.gameId ?? room.selectedGame];
  const { error, run } = useRun();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${location.origin}${location.pathname}?room=${room.code}`;
  const inGame = room.game !== null && room.game.phase !== "ended";
  const offline = room.players.filter((p) => !p.connected);

  const copyInvite = () => {
    void navigator.clipboard?.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const invite = () => {
    // 手机上优先用系统分享面板，直接发到微信等
    if (navigator.share) {
      navigator.share({ title: "来玩聚会小游戏", text: `房间号 ${room.code}，一起玩${meta.name}！`, url: inviteUrl }).catch(() => {});
    } else {
      copyInvite();
    }
  };
  const leave = () => {
    if (inGame && !confirm("游戏还没结束，确定要退出吗？")) return;
    actions.leave();
  };

  // 实时 3D 游戏需要整块屏幕，自己管理菜单和结算界面
  if (room.game?.gameId === "quest") {
    return (
      <Suspense fallback={<div className="solo-loading">⛩️ 正在进入秘境…</div>}>
        <Quest key={room.gameNo} room={room} me={me} actions={actions} onLeave={leave} />
      </Suspense>
    );
  }

  const n = room.players.length;
  const need = meta.minPlayers - n;
  const tooMany = n > meta.maxPlayers;

  return (
    <>
      {/* 房间操作放在卡片外的一条细栏里，房间号缩成右上角的小标签，把空间留给游戏 */}
      <header className="room-bar">
        <button type="button" className="room-bar-btn" onClick={leave}>
          ‹ 退出
        </button>
        <div className="room-bar-actions">
          <button type="button" className="room-bar-btn" onClick={() => setRulesOpen(true)}>
            📖 规则
          </button>
          <button type="button" className="room-bar-btn" onClick={invite}>
            {copied ? "✅ 已复制" : "📨 邀请"}
          </button>
          <button type="button" className="room-code" title="房间号，点一下复制邀请链接" onClick={copyInvite}>
            {room.code}
          </button>
        </div>
      </header>
      <main className="card room">
        {room.game ? (
          <>
            {offline.length > 0 && inGame && (
              <p className="offline-banner">⚠️ {offline.map((p) => p.name).join("、")} 掉线了，等 Ta 回来…</p>
            )}
            {/* key 随局数变化：再来一局时整个游戏界面重新挂载，事件计数、彩带、定时器都从头开始 */}
            <div key={room.gameNo} className="game-slot">
              {room.game.gameId === "numberBomb" && <NumberBomb room={room} me={me} actions={actions} />}
              {room.game.gameId === "undercover" && (
                <>
                  <PlayerList room={room} me={me} />
                  <Undercover room={room} me={me} actions={actions} />
                </>
              )}
              {room.game.gameId === "bombCat" && <BombCat room={room} me={me} actions={actions} />}
              {room.game.gameId === "liarsBar" && <LiarsBar room={room} me={me} actions={actions} />}
              {room.game.gameId === "uno" && <Uno room={room} me={me} actions={actions} />}
              {room.game.gameId === "werewolf" && <Werewolf room={room} me={me} actions={actions} />}
              {room.game.gameId === "avalon" && <Avalon room={room} me={me} actions={actions} />}
              {room.game.gameId === "jenga" && (
                <Suspense fallback={<p className="hint center">正在搭木塔…</p>}>
                  <Jenga room={room} me={me} actions={actions} />
                </Suspense>
              )}
            </div>

            {room.game.phase === "ended" ? (
              isHost ? (
                <div className="end-actions">
                  <button type="button" className="primary-lg" onClick={() => run(actions.restart())}>
                    🔁 再来一局
                  </button>
                  <button type="button" className="secondary" onClick={() => run(actions.backToLobby())}>
                    换个游戏
                  </button>
                </div>
              ) : (
                <p className="hint center">等房主开下一局…</p>
              )
            ) : (
              isHost && (
                <button
                  type="button"
                  className="link end-link"
                  onClick={() => confirm("确定结束本局，回到大厅吗？") && run(actions.backToLobby())}
                >
                  结束本局
                </button>
              )
            )}
          </>
        ) : (
          <section className="lobby">
            <PlayerList room={room} me={me} />

            <div className="selected-game" style={{ "--c": meta.color } as CSSProperties}>
              <span className="selected-game-emoji">{meta.emoji}</span>
              <div className="selected-game-info">
                <div className="selected-game-name">{meta.name}</div>
                <div className="selected-game-tagline">{meta.tagline}</div>
                <div className="selected-game-meta">
                  👥 {meta.minPlayers}~{meta.maxPlayers} 人 · ⏱ {meta.duration}
                </div>
              </div>
              {isHost && (
                <button type="button" className="link" onClick={() => setPicking(true)}>
                  换游戏
                </button>
              )}
            </div>

            <details className="rules">
              <summary>📖 怎么玩</summary>
              <ol className="rules-list">
                {meta.rules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </details>

            {isHost ? (
              <button type="button" className="primary-lg" disabled={need > 0 || tooMany} onClick={() => run(actions.start())}>
                {need > 0
                  ? `还差 ${need} 人才能开始`
                  : tooMany
                    ? `${meta.name}最多 ${meta.maxPlayers} 人`
                    : `开始游戏（${n} 人）`}
              </button>
            ) : (
              <p className="hint center">等待房主开始游戏…</p>
            )}
            {need > 0 && (
              <button type="button" className="secondary" onClick={invite}>
                📨 邀请朋友加入
              </button>
            )}

            {picking && (
              <Sheet onClose={() => setPicking(false)}>
                <h2>换个游戏</h2>
                <div className="game-grid">
                  {GAME_ORDER.map((id) => (
                    <GameCard
                      key={id}
                      meta={GAMES[id]}
                      selected={id === room.selectedGame}
                      isNew={NEW_GAMES.includes(id)}
                      onClick={() => {
                        run(actions.selectGame(id));
                        setPicking(false);
                      }}
                    />
                  ))}
                </div>
              </Sheet>
            )}
          </section>
        )}

        {error && <p className="error">{error}</p>}

        {rulesOpen && (
          <Sheet onClose={() => setRulesOpen(false)}>
            <GameDetail meta={meta} />
          </Sheet>
        )}
      </main>
    </>
  );
}
