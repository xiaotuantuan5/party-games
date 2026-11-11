import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  LIARS_BAR_CHAMBERS,
  LIARS_BAR_MAX_PLAY,
  LIARS_BAR_RANKS,
  type LiarsBarLogEntry,
  type LiarsBarRank,
  type LiarsBarView,
} from "@party/shared";
import { Avatar } from "../components";
import { Confetti, FxLayer, SoundToggle, useFreshCards, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./LiarsBar.css";

const BANG_SHARDS = ["💥", "🔥", "💀", "✨"];
const WIN_CONFETTI = ["🍺", "🎉", "🏆", "✨"];
const RANK_ORDER: LiarsBarRank[] = ["K", "Q", "A", "joker"];
/** 开枪前的悬念：弹巢转动多久再公布结果 */
const SUSPENSE_MS = 1400;
/** 摊牌时每张牌翻开的间隔 */
const FLIP_STEP_MS = 450;

function RankFace({ rank, small }: { rank: LiarsBarRank; small?: boolean }) {
  const r = LIARS_BAR_RANKS[rank];
  return (
    <span className={`lb-face r-${rank} ${small ? "small" : ""}`}>
      <span className="lb-face-label">{r.label}</span>
      <span className="lb-face-emoji">{r.emoji}</span>
    </span>
  );
}

/** 左轮手枪剪影。系统的 🔫 emoji 在苹果和安卓上都是水枪，所以自己画一个。 */
function GunIcon({ size = 22 }: { size?: number }) {
  return (
    <svg className="lb-gun-icon" width={size} height={(size * 40) / 64} viewBox="0 0 64 40" fill="currentColor" aria-hidden>
      <rect x="20" y="9" width="42" height="7" rx="2" />
      <rect x="56" y="5.5" width="3" height="4" rx="1" />
      <rect x="13" y="6" width="16" height="14" rx="4" />
      <path d="M7 6 h7 v4 h-9 z" />
      <path d="M5 10 h12 v9 l-3 3 -4 14 a2 2 0 0 1 -2 1.5 h-6 a2 2 0 0 1 -1.9 -2.5 l4.5 -15 z" />
      <path d="M20 19 q1 8 9 7" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M23 19 l1.5 5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** 开枪悬念里转动的弹巢 */
function Cylinder({ pulls }: { pulls: number }) {
  return (
    <span className="lb-cylinder">
      {Array.from({ length: LIARS_BAR_CHAMBERS }, (_, i) => (
        <span
          key={i}
          className={`lb-cyl-hole ${i < pulls ? "fired" : ""}`}
          style={{ transform: `rotate(${i * 60}deg) translateY(-26px)` }}
        />
      ))}
    </span>
  );
}

function Revolver({ pulls, out }: { pulls: number; out?: boolean }) {
  return (
    <span className={`lb-gun ${out ? "out" : ""}`} title={`已扣 ${pulls} 次扳机`}>
      <GunIcon />
      <span className="lb-chambers">
        {Array.from({ length: LIARS_BAR_CHAMBERS }, (_, i) => (
          <span key={i} className={`lb-chamber ${i < pulls ? "fired" : ""}`} />
        ))}
      </span>
    </span>
  );
}

type Suspense = { id: number; shooterId: string; died: boolean; pulls: number };

function useLiarsBarEffects(g: LiarsBarView, me: string, name: (id?: string | null) => string) {
  const { fx, show, shaking, shake } = useFx();
  const [suspense, setSuspense] = useState<Suspense | null>(null);
  const [confetti, setConfetti] = useState(false);
  const lastSeq = useRef<number | null>(null);
  const wasMyTurn = useRef(false);
  const prevWinner = useRef<string | null | undefined>(undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const onEvent = (e: LiarsBarLogEntry) => {
    const who = e.playerId === me ? "你" : name(e.playerId);
    switch (e.kind) {
      case "play":
        sfx.draw();
        break;
      case "challenge": {
        sfx.liar();
        vibrate(80);
        // 依次翻牌，最后公布结果
        const sd = g.showdown;
        const n = sd?.cards.length ?? 0;
        for (let i = 0; i < n; i++) later(700 + i * FLIP_STEP_MS, sfx.flip);
        later(700 + n * FLIP_STEP_MS + 150, () => (sd?.lie ? sfx.steal() : sfx.lose()));
        break;
      }
      case "click":
      case "bang": {
        const died = e.kind === "bang";
        setSuspense({ id: e.seq, shooterId: e.playerId, died, pulls: e.count ?? 0 });
        sfx.spin();
        later(SUSPENSE_MS, () => {
          setSuspense(null);
          if (died) {
            sfx.gunshot();
            shake();
            show({ kind: "explode", icon: "💀", text: e.playerId === me ? "砰！你中弹了" : `砰！${who} 倒下了` });
            if (e.playerId === me) vibrate([400, 100, 400]);
          } else {
            sfx.dryFire();
            show({ kind: "success", icon: "😮‍💨", text: e.playerId === me ? "咔嗒……你活下来了" : `咔嗒……${who} 活下来了` });
            if (e.playerId === me) vibrate(60);
          }
        });
        break;
      }
      case "round":
        // 新一轮的提示由桌牌动画负责，避免盖掉开枪特效
        if (e.seq > 1) later(SUSPENSE_MS + 300, sfx.shuffle);
        break;
      case "leave":
        break;
    }
  };

  useEffect(() => {
    const maxSeq = g.log.at(-1)?.seq ?? 0;
    // 第一次渲染（包括刷新重连）不重放历史事件
    if (lastSeq.current === null) {
      lastSeq.current = maxSeq;
      return;
    }
    const fresh = g.log.filter((e) => e.seq > lastSeq.current!);
    lastSeq.current = Math.max(lastSeq.current, maxSeq);
    fresh.forEach(onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.log]);

  useEffect(() => {
    if (prevWinner.current === undefined) {
      prevWinner.current = g.winnerId;
      return;
    }
    if (g.winnerId && !prevWinner.current) {
      later(SUSPENSE_MS + 600, () => {
        setConfetti(true);
        sfx.win();
      });
    }
    prevWinner.current = g.winnerId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.winnerId]);

  const isMyTurn = g.phase === "play" && g.currentPlayerId === me;
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) {
      later(suspense ? SUSPENSE_MS + 400 : 0, () => {
        sfx.myTurn();
        vibrate(60);
      });
    }
    wasMyTurn.current = isMyTurn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn]);

  // 轮到自己开枪时心跳声
  const iShoot = g.phase === "showdown" && g.showdown?.shooterId === me;
  useEffect(() => {
    if (!iShoot) return;
    const t = setInterval(sfx.heartbeat, 900);
    return () => clearInterval(t);
  }, [iShoot]);

  return { fx, shaking, suspense, confetti };
}

function Showdown({ g, me, name, onPull }: { g: LiarsBarView; me: string; name: (id?: string | null) => string; onPull: () => void }) {
  const sd = g.showdown!;
  const pulls = g.pulls[sd.shooterId] ?? 0;
  const left = LIARS_BAR_CHAMBERS - pulls;
  const iShoot = sd.shooterId === me;
  const verdictDelay = 700 + sd.cards.length * FLIP_STEP_MS;
  const caller = sd.callerId === me ? "你" : name(sd.callerId);
  const accused = sd.accusedId === me ? "你" : name(sd.accusedId);
  const shooter = iShoot ? "你" : name(sd.shooterId);

  return (
    <div className="lb-showdown">
      <div className="lb-callout">
        {caller}：<strong>“{accused}是骗子！”</strong>
      </div>
      <div className="lb-reveal">
        {sd.cards.map((c, i) => {
          const ok = c.rank === g.tableRank || c.rank === "joker";
          return (
            <span
              key={c.id}
              className={`lb-flip ${ok ? "ok" : "bad"}`}
              style={{ "--delay": `${700 + i * FLIP_STEP_MS}ms` } as CSSProperties}
            >
              <span className="lb-flip-inner">
                <span className="lb-back" />
                <RankFace rank={c.rank} />
              </span>
            </span>
          );
        })}
      </div>
      <div className="lb-verdict" style={{ animationDelay: `${verdictDelay}ms` }}>
        <div className={`lb-verdict-title ${sd.lie ? "lie" : "truth"}`}>{sd.lie ? `🤥 ${accused}撒谎了！` : `😇 ${accused}说的是真的！`}</div>
        <div className="lb-verdict-sub">
          {shooter}要对自己开一枪 · 中弹概率 1/{left}
        </div>
        {iShoot ? (
          <button type="button" className="lb-trigger" onClick={onPull}>
            <GunIcon size={28} /> 扣动扳机
          </button>
        ) : (
          <div className="lb-wait-shot">
            <Revolver pulls={pulls} /> 等待 {name(sd.shooterId)} 扣动扳机…
          </div>
        )}
      </div>
    </div>
  );
}

export function LiarsBar({ room, me, actions }: GameProps) {
  const g = room.game as LiarsBarView;
  const { error, run } = useRun();
  const name = (id?: string | null) => nameOf(room, id);
  const { fx, shaking, suspense, confetti } = useLiarsBarEffects(g, me, name);
  const fresh = useFreshCards(g.myHand);
  const [selected, setSelected] = useState<number[]>([]);

  const alive = g.alive.includes(me);
  const myTurn = g.phase === "play" && g.currentPlayerId === me;
  const canChallenge = myTurn && g.lastPlay !== null && g.lastPlay.playerId !== me;
  const canPlay = myTurn && !g.mustChallenge && g.myHand.length > 0;
  const table = LIARS_BAR_RANKS[g.tableRank];

  const hand = useMemo(
    () => [...g.myHand].sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) || a.id - b.id),
    [g.myHand],
  );
  const truthful = g.myHand.filter((c) => c.rank === g.tableRank || c.rank === "joker").length;

  useEffect(() => {
    setSelected((sel) => sel.filter((id) => g.myHand.some((c) => c.id === id)));
  }, [g.myHand]);

  const toggle = (id: number) => {
    if (!canPlay) return;
    sfx.pick();
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length >= LIARS_BAR_MAX_PLAY ? sel : [...sel, id]));
  };
  const play = () =>
    run(actions.act({ gameId: "liarsBar", type: "play", cardIds: selected }).then(() => setSelected([])));
  const challenge = () => run(actions.act({ gameId: "liarsBar", type: "challenge" }));
  const pull = () => run(actions.act({ gameId: "liarsBar", type: "pull" }));

  const winner = g.winnerId === me ? "你" : name(g.winnerId);

  return (
    <>
      <FxLayer fx={fx} shards={BANG_SHARDS} />
      {confetti && <Confetti chars={WIN_CONFETTI} delay={0} />}
      {suspense && (
        <div className="lb-suspense" key={suspense.id}>
          <div className="lb-suspense-gun">
            <GunIcon size={120} />
          </div>
          <Cylinder pulls={suspense.pulls - 1} />
          <div className="lb-suspense-text">
            {suspense.shooterId === me ? "你" : name(suspense.shooterId)}扣动了扳机……
          </div>
        </div>
      )}

      <section className={`lb-root ${shaking ? "fx-shake" : ""}`}>
        <div className="lb-head">
          <h2>🍺 骗子酒馆</h2>
          <span className="lb-round">第 {g.round} 轮</span>
          <SoundToggle />
        </div>

        <div className="lb-table">
          <div key={g.round} className="lb-table-card">
            <span className="lb-table-label">本轮桌牌</span>
            <RankFace rank={g.tableRank} />
            <span className="lb-table-hint">🃏 王可以当任何牌</span>
          </div>
          <div className="lb-pile">
            <div className="lb-pile-stack">
              {Array.from({ length: Math.min(g.pileCount, 8) }, (_, i) => (
                <span
                  key={i}
                  className="lb-back pile"
                  style={{ transform: `rotate(${((i * 37) % 30) - 15}deg) translate(${((i * 13) % 10) - 5}px, ${-i}px)` }}
                />
              ))}
            </div>
            {g.lastPlay ? (
              <div key={`${g.round}-${g.pileCount}`} className="lb-claim">
                {g.lastPlay.playerId === me ? "你" : name(g.lastPlay.playerId)}：“这 {g.lastPlay.count} 张都是 {table.label}”
              </div>
            ) : (
              <div className="lb-claim muted">还没人出牌</div>
            )}
          </div>
        </div>

        <ul className="lb-seats">
          {g.order.map((id) => {
            const out = !g.alive.includes(id);
            const current = g.phase === "play" && id === g.currentPlayerId;
            const shooter = g.phase === "showdown" && g.showdown?.shooterId === id;
            return (
              <li key={id} className={`${out ? "out" : ""} ${current ? "current" : ""} ${shooter ? "shooter" : ""} ${id === g.winnerId ? "winner" : ""}`}>
                <Avatar name={name(id)} seed={id} size={30} />
                <div className="lb-seat-info">
                  <div className="lb-seat-name">
                    {out ? "💀 " : id === g.winnerId ? "🏆 " : ""}
                    {name(id)}
                    {id === me && "（我）"}
                  </div>
                  <div className="lb-seat-cards">
                    {Array.from({ length: g.handCounts[id] ?? 0 }, (_, i) => (
                      <span key={i} className="lb-mini-back" />
                    ))}
                    {!out && (g.handCounts[id] ?? 0) === 0 && <span className="lb-no-cards">没牌了</span>}
                  </div>
                </div>
                <Revolver pulls={g.pulls[id] ?? 0} out={out} />
              </li>
            );
          })}
        </ul>

        {g.phase === "showdown" && g.showdown && <Showdown key={g.log.at(-1)?.seq} g={g} me={me} name={name} onPull={pull} />}

        {g.phase === "ended" && <p className="big lb-winner">🏆 {winner}是最后的幸存者！</p>}

        {g.phase === "play" && (
          <p className={`lb-status ${myTurn ? "mine" : ""}`}>
            {myTurn
              ? g.mustChallenge
                ? "其他人都没牌了，你只能开牌！"
                : g.lastPlay
                  ? `轮到你了：相信就接着出牌，不信就喊“骗子！”`
                  : `轮到你先出：选 1~${LIARS_BAR_MAX_PLAY} 张牌盖着打出`
              : `等待 ${name(g.currentPlayerId)} 出牌…`}
          </p>
        )}

        {alive && g.phase !== "ended" && (
          <>
            <div className="lb-hand-head">
              <h3>我的手牌</h3>
              <span className="hint">
                真牌 {truthful}/{g.myHand.length} 张
              </span>
            </div>
            <div className="lb-hand">
              {hand.map((c) => {
                const order = fresh.get(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`lb-card ${selected.includes(c.id) ? "selected" : ""} ${order !== undefined ? "deal" : ""} ${c.rank === g.tableRank || c.rank === "joker" ? "truth" : ""}`}
                    style={order !== undefined ? { animationDelay: `${order * 80}ms` } : undefined}
                    disabled={!canPlay}
                    onClick={() => toggle(c.id)}
                  >
                    <RankFace rank={c.rank} />
                  </button>
                );
              })}
              {hand.length === 0 && <p className="hint">手牌出完了，等别人开牌</p>}
            </div>

            {myTurn && (
              <div className="row lb-actions">
                {canChallenge && (
                  <button type="button" className="lb-liar" onClick={challenge}>
                    🗣️ 骗子！
                  </button>
                )}
                {canPlay && (
                  <button type="button" className="lb-play" disabled={selected.length === 0} onClick={play}>
                    {selected.length === 0 ? "先选牌" : `盖牌打出 ${selected.length} 张（说是 ${table.label}）`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {!alive && g.phase !== "ended" && <p className="hint center">你已出局，可以继续观战</p>}

        {error && <p className="error">{error}</p>}

        <ul className="history lb-log">
          {g.log
            .slice(-6)
            .reverse()
            .map((e) => (
              <li key={e.seq} className={`lb-log-${e.kind}`}>
                <strong>{name(e.playerId)}</strong> {e.text.replace("{target}", name(e.targetId))}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
