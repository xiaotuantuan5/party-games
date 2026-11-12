import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { GAMES, QUEST_CRYSTALS, type QuestView } from "@party/shared";
import { GameDetail, Sheet } from "../components";
import { Confetti, SoundToggle } from "../fx";
import { onMove, sendMove } from "../party";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import { QUEST_PALETTE, QuestScene, type QuestAirState } from "./questScene";
import "./Quest.css";

interface Toast {
  id: number;
  text: string;
  big?: boolean;
}

const STICK_RADIUS = 52;

const formatTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function stars(crystals: number): number {
  if (crystals >= QUEST_CRYSTALS.length) return 3;
  if (crystals >= Math.ceil(QUEST_CRYSTALS.length * 0.66)) return 2;
  return 1;
}

/**
 * 秘境闯关的界面：全屏 3D 画面 + 触屏摇杆 + HUD。
 * 左半屏按住拖动 = 摇杆，右半屏拖动 = 转视角；鼠标拖动在任何位置都是转视角。
 */
export function Quest({ room, me, actions, onLeave }: GameProps & { onLeave: () => void }) {
  const g = room.game as QuestView;
  const isHost = room.hostId === me;
  const { error, run } = useRun();
  const stage = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<QuestScene | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [air, setAir] = useState<QuestAirState>("ground");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState(false);
  const [falling, setFalling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [stick, setStick] = useState<{ ox: number; oy: number; kx: number; ky: number } | null>(null);
  const clockOffset = useRef(0);
  const name = (id?: string | null) => nameOf(room, id);

  const toast = (text: string, big = false) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, big }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), big ? 2600 : 2000);
  };

  // ---------- 场景 ----------
  useEffect(() => {
    if (!stage.current) return;
    let scene: QuestScene;
    try {
      scene = new QuestScene(stage.current, {
        onMove: sendMove,
        onAirState: setAir,
        onFall: () => {
          setFalling(true);
          setTimeout(() => setFalling(false), 900);
        },
      });
    } catch {
      setWebglError(true);
      return;
    }
    sceneRef.current = scene;
    const off = onMove((id, m) => scene.remoteMove(id, m));
    return () => {
      off();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // 玩家列表：颜色按入场顺序固定
  const orderKey = g.order.join(",");
  useEffect(() => {
    sceneRef.current?.setPlayers(
      g.order.map((id, i) => ({ id, name: name(id), colorIndex: i })),
      me,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, me]);

  useEffect(() => {
    clockOffset.current = g.serverNow - Date.now();
    sceneRef.current?.applyView(g);
  }, [g]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // ---------- 事件提示 ----------
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    const maxSeq = g.log.at(-1)?.seq ?? 0;
    if (lastSeq.current === null) {
      lastSeq.current = maxSeq;
      return;
    }
    const got = g.crystals.filter(Boolean).length;
    for (const e of g.log.filter((e) => e.seq > lastSeq.current!)) {
      const who = e.playerId === me ? "你" : name(e.playerId);
      if (e.kind === "crystal") {
        sfx.crystal();
        if (e.playerId === me) vibrate(30);
        toast(`💎 ${who}捡到了星辉水晶（${got}/${QUEST_CRYSTALS.length}）`);
      } else if (e.kind === "gate") {
        sfx.gate();
        vibrate([80, 60, 120]);
        toast("✨ 结界打开了！过桥继续前进", true);
      } else if (e.kind === "fall") {
        if (e.playerId !== me) toast(`😵 ${who}掉下去了`);
      } else if (e.kind === "goal") {
        toast(`⛩️ ${who}到达了神像`);
      } else if (e.kind === "wave") {
        sceneRef.current?.showEmote(e.playerId, "👋");
      } else if (e.kind === "leave") {
        toast(`🚪 ${e.text}`);
      }
    }
    lastSeq.current = Math.max(lastSeq.current, maxSeq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.log]);

  const ended = g.phase === "ended";
  const wasEnded = useRef(ended);
  useEffect(() => {
    if (ended && !wasEnded.current) sfx.win();
    wasEnded.current = ended;
  }, [ended]);

  // ---------- 触屏 ----------
  const pointers = useRef(new Map<number, { kind: "stick" | "cam"; x: number; y: number; ox: number; oy: number }>());

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (ended) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hasStick = [...pointers.current.values()].some((p) => p.kind === "stick");
    const kind = e.pointerType !== "mouse" && x < rect.width / 2 && !hasStick ? "stick" : "cam";
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, ox: x, oy: y });
    if (kind === "stick") setStick({ ox: x, oy: y, kx: 0, ky: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    if (p.kind === "cam") {
      sceneRef.current?.rotateCamera(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX;
      p.y = e.clientY;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - rect.left - p.ox;
    let dy = e.clientY - rect.top - p.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    sceneRef.current?.setStick(dx / STICK_RADIUS, -dy / STICK_RADIUS);
    setStick({ ox: p.ox, oy: p.oy, kx: dx, ky: dy });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (p?.kind === "stick") {
      sceneRef.current?.setStick(0, 0);
      setStick(null);
    }
  };

  // ---------- HUD ----------
  const crystalsGot = g.crystals.filter(Boolean).length;
  const elapsed = (g.finishedAt ?? now + clockOffset.current) - g.startedAt;
  const platesOn = g.plates.filter(Boolean).length;
  let objective: string;
  if (!g.gateOpen) objective = `① 跳过石柱，${g.platesNeeded} 人同时站上发光的机关（${platesOn}/${g.platesNeeded}）`;
  else if (g.inGoal.length === 0) objective = "② 过桥，跳上高台，在空中再按一次跳跃打开风之翼滑翔";
  else objective = `③ 全员站进神像前的光圈（${g.inGoal.length}/${g.order.length}）`;

  const jumpLabel = air === "ground" ? "跳" : air === "air" ? "🪽" : "收";

  return (
    <div className="qs-root">
      <div className="qs-stage" ref={stage} />
      {webglError && <p className="qs-error">你的浏览器不支持 WebGL，没法显示 3D 画面 😢</p>}

      <div
        className="qs-touch"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {stick && (
          <div className="qs-stick" style={{ left: stick.ox, top: stick.oy }}>
            <div className="qs-stick-knob" style={{ transform: `translate(${stick.kx}px, ${stick.ky}px)` }} />
          </div>
        )}
      </div>

      <div className="qs-hud">
        <div className="qs-top">
          <div className="qs-quest">
            <div className="qs-quest-title">
              ⛩️ 秘境闯关 <span className="qs-time">⏱ {formatTime(elapsed)}</span>
              <span className="qs-gems">💎 {crystalsGot}/{QUEST_CRYSTALS.length}</span>
            </div>
            <div className="qs-objective">{objective}</div>
          </div>
          <div className="qs-top-btns">
            <SoundToggle />
            <button type="button" className="qs-icon" onClick={() => setMenu(true)} aria-label="菜单">
              ☰
            </button>
          </div>
        </div>

        <ul className="qs-team">
          {g.order.map((id, i) => {
            const pal = QUEST_PALETTE[i % QUEST_PALETTE.length]!;
            const offline = !room.players.find((p) => p.id === id)?.connected;
            return (
              <li key={id} className={offline ? "offline" : ""} style={{ "--c": pal.css } as CSSProperties}>
                <i />
                {name(id)}
                {id === me && "（我）"}
                {g.inGoal.includes(id) && " ⛩️"}
                {g.plates.includes(id) && " 🔷"}
                {offline && " · 离线"}
              </li>
            );
          })}
        </ul>

        <div className="qs-toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`qs-toast ${t.big ? "big" : ""}`}>
              {t.text}
            </div>
          ))}
        </div>

        {!ended && (
          <div className="qs-actions">
            <button
              type="button"
              className="qs-wave"
              aria-label="打招呼"
              onPointerDown={(e) => {
                e.stopPropagation();
                sceneRef.current?.showEmote(me, "👋");
                run(actions.act({ gameId: "quest", type: "wave" }));
              }}
            >
              👋
            </button>
            <button
              type="button"
              className={`qs-jump ${air}`}
              aria-label="跳跃"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                sceneRef.current?.pressJump();
              }}
            >
              {jumpLabel}
            </button>
          </div>
        )}
        {!ended && <div className="qs-hint">左边拖动走路 · 右边拖动转视角 · 空中再按跳跃滑翔</div>}
      </div>

      {falling && <div className="qs-fade" />}
      {error && <p className="qs-err">{error}</p>}

      {ended && (
        <div className="qs-overlay">
          <Confetti chars={["💎", "✨", "⭐", "🪽"]} delay={0.2} />
          <div className="qs-result">
            <div className="qs-stars">
              {[1, 2, 3].map((n) => (
                <span key={n} className={n <= stars(crystalsGot) ? "on" : ""}>
                  ★
                </span>
              ))}
            </div>
            <h2>秘境通关！</h2>
            <p className="qs-result-sub">
              用时 {formatTime(elapsed)} · 星辉水晶 {crystalsGot}/{QUEST_CRYSTALS.length}
            </p>
            <ul className="qs-result-list">
              {g.order.map((id, i) => (
                <li key={id} style={{ "--c": QUEST_PALETTE[i % QUEST_PALETTE.length]!.css } as CSSProperties}>
                  <i />
                  <span>
                    {name(id)}
                    {id === me && "（我）"}
                  </span>
                  <span>💎 {g.crystals.filter((c) => c === id).length}</span>
                  <span>😵 {g.falls[id] ?? 0}</span>
                </li>
              ))}
            </ul>
            {isHost ? (
              <>
                <button type="button" className="primary-lg" onClick={() => run(actions.restart())}>
                  🔁 再闯一次
                </button>
                <button type="button" className="secondary" onClick={() => run(actions.backToLobby())}>
                  换个游戏
                </button>
              </>
            ) : (
              <p className="hint center">等房主开下一局…</p>
            )}
            <button type="button" className="link danger" onClick={onLeave}>
              退出房间
            </button>
          </div>
        </div>
      )}

      {menu && (
        <Sheet onClose={() => setMenu(false)}>
          <GameDetail meta={GAMES.quest} />
          <p className="hint">房间号 {room.code}</p>
          {isHost && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (!confirm("确定结束本局，回到大厅吗？")) return;
                setMenu(false);
                run(actions.backToLobby());
              }}
            >
              结束本局，回到大厅
            </button>
          )}
          <button type="button" className="link danger" onClick={onLeave}>
            退出房间
          </button>
        </Sheet>
      )}
    </div>
  );
}
