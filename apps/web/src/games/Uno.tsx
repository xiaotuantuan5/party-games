import { useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import {
  UNO_COLORS,
  UNO_COLOR_INFO,
  UNO_VALUE_INFO,
  isUnoWild,
  unoCanPlay,
  type UnoCard,
  type UnoColor,
  type UnoLogEntry,
  type UnoValue,
  type UnoView,
} from "@party/shared";
import { Sheet } from "../components";
import { Confetti, FxLayer, SoundToggle, useFreshCards, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./Uno.css";

const UNO_SHARDS = ["🟥", "🟨", "🟩", "🟦", "✨"];
const UNO_CONFETTI = ["🎉", "🟥", "🟨", "🟩", "🟦", "⭐"];

/** 手牌排序：按颜色，再按牌面，万能牌放最后 */
const COLOR_ORDER: Record<string, number> = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
const VALUE_ORDER = Object.keys(UNO_VALUE_INFO);
const sortKey = (c: UnoCard) => COLOR_ORDER[c.color ?? "wild"]! * 100 + VALUE_ORDER.indexOf(c.value);

/** 禁止和反转用 SVG 画，不依赖字体里有没有 ⊘ / ⇄ 这两个符号 */
function SymbolIcon({ value }: { value: UnoValue }) {
  if (value === "skip") {
    return (
      <svg viewBox="0 0 24 24" className="uno-icon" aria-hidden>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="3" />
        <line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (value === "reverse") {
    return (
      <svg viewBox="0 0 24 24" className="uno-icon" aria-hidden>
        <path d="M4 9h13l-4-4M20 15H7l4 4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return <>{UNO_VALUE_INFO[value].symbol}</>;
}

export function UnoCardFace({
  card,
  className = "",
  style,
  ...rest
}: { card: Pick<UnoCard, "color" | "value"> } & Omit<ComponentProps<"button">, "type">) {
  const info = UNO_VALUE_INFO[card.value];
  // 颜色变量和外面传进来的样式（比如发牌动画延迟）合并，不能互相覆盖
  const merged = { ...(card.color ? { "--uc": UNO_COLOR_INFO[card.color].hex } : {}), ...style } as CSSProperties;
  return (
    <button
      type="button"
      className={`uno-card ${card.color ? "" : "wild"} v-${card.value} ${className}`}
      style={merged}
      aria-label={`${card.color ? UNO_COLOR_INFO[card.color].name : ""}${info.name}`}
      {...rest}
    >
      <span className="uno-corner tl">
        <SymbolIcon value={card.value} />
      </span>
      <span className="uno-oval">
        <span className="uno-symbol">
          <SymbolIcon value={card.value} />
        </span>
      </span>
      <span className="uno-corner br">
        <SymbolIcon value={card.value} />
      </span>
    </button>
  );
}

function useGameEffects(g: UnoView, me: string, name: (id?: string | null) => string) {
  const { fx, show, shaking, shake } = useFx();
  const [confetti, setConfetti] = useState(false);
  const [spin, setSpin] = useState(0);
  const lastSeq = useRef<number | null>(null);
  const prevWinner = useRef<string | null | undefined>(undefined);
  const wasMyTurn = useRef(false);

  const onEvent = (e: UnoLogEntry) => {
    const who = e.playerId === me ? "你" : name(e.playerId);
    switch (e.kind) {
      case "play": {
        const v = e.card?.value;
        if (v === "wild" || v === "wild4") sfx.wild();
        else if (v === "reverse") sfx.reverse();
        else if (v === "skip") sfx.skip();
        else if (v === "draw2") sfx.attack();
        else sfx.play();
        break;
      }
      case "draw":
        sfx.draw();
        break;
      case "penalty":
        if (e.targetId === me) {
          shake();
          vibrate([120, 60, 120]);
          show({ kind: "toast", icon: "😱", text: `你被罚摸 ${e.count} 张！` });
        } else {
          show({ kind: "toast", icon: `+${e.count}`, text: `${name(e.targetId)} 摸 ${e.count} 张` });
        }
        break;
      case "skipped":
        if (e.targetId === me) {
          show({ kind: "toast", icon: "⊘", text: "你被跳过了" });
          vibrate(80);
        }
        break;
      case "reverse":
        setSpin((n) => n + 1);
        break;
      case "uno":
        sfx.unoShout();
        show({ kind: "success", icon: "📣", text: `${who} 喊了 UNO！` });
        break;
      case "caught":
        sfx.caught();
        if (e.targetId === me) {
          shake();
          vibrate([200, 80, 200]);
        }
        show({
          kind: "toast",
          icon: "🚨",
          text: e.targetId === me ? `你没喊 UNO，被${who}抓了，罚摸 ${e.count} 张` : `${who}抓到${name(e.targetId)}没喊 UNO！`,
        });
        break;
      case "reshuffle":
        sfx.shuffle();
        break;
      case "pass":
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
      setConfetti(true);
      if (g.winnerId === me) sfx.win();
      else sfx.lose();
      show({ kind: "success", icon: "🏆", text: g.winnerId === me ? "你出完了所有牌！" : `${name(g.winnerId)} 出完了所有牌！` });
    }
    prevWinner.current = g.winnerId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.winnerId]);

  const isMyTurn = g.phase === "playing" && g.currentPlayerId === me;
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) {
      sfx.myTurn();
      vibrate(60);
    }
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  return { fx, shaking, confetti, spin };
}

export function Uno({ room, me, actions }: GameProps) {
  const g = room.game as UnoView;
  const { error, run } = useRun();
  const [selected, setSelected] = useState<number | null>(null);
  const [colorFor, setColorFor] = useState<number | null>(null);
  const [unoArmed, setUnoArmed] = useState(false);

  const name = (id?: string | null) => nameOf(room, id);
  const { fx, shaking, confetti, spin } = useGameEffects(g, me, name);
  const fresh = useFreshCards(g.myHand);

  const myTurn = g.phase === "playing" && g.currentPlayerId === me;
  const deciding = myTurn && g.drawnCardId !== null;
  const hand = useMemo(() => [...g.myHand].sort((a, b) => sortKey(a) - sortKey(b) || a.id - b.id), [g.myHand]);
  const canPlay = (c: UnoCard) =>
    myTurn && (g.drawnCardId === null || g.drawnCardId === c.id) && unoCanPlay(c, g.topCard, g.currentColor);
  const anyPlayable = hand.some(canPlay);
  const iAmCatchable = g.unoCatchable.includes(me);
  const catchTargets = g.unoCatchable.filter((id) => id !== me);
  const lastPlaySeq = [...g.log].reverse().find((e) => e.kind === "play")?.seq ?? 0;

  // 回合结束或手牌变了，清掉本地选择
  useEffect(() => {
    if (!myTurn) {
      setSelected(null);
      setUnoArmed(false);
    }
  }, [myTurn]);
  useEffect(() => {
    setSelected((id) => (id !== null && g.myHand.some((c) => c.id === id) ? id : null));
  }, [g.myHand]);

  const play = (card: UnoCard, color?: UnoColor) => {
    const uno = unoArmed && g.myHand.length === 2;
    run(
      actions.act({ gameId: "uno", type: "play", cardId: card.id, color, uno }).then(() => {
        setSelected(null);
        setUnoArmed(false);
      }),
    );
  };

  const tapCard = (card: UnoCard) => {
    if (!canPlay(card)) return;
    if (selected !== card.id) {
      setSelected(card.id);
      sfx.pick();
      return;
    }
    if (isUnoWild(card.value)) setColorFor(card.id);
    else play(card);
  };

  const draw = () => myTurn && !deciding && run(actions.act({ gameId: "uno", type: "draw" }));
  const pass = () => run(actions.act({ gameId: "uno", type: "pass" }));
  const callUno = () => run(actions.act({ gameId: "uno", type: "callUno" }));
  const catchPlayer = (id: string) => run(actions.act({ gameId: "uno", type: "catch", targetId: id }));
  const drawnCard = g.drawnCardId !== null ? g.myHand.find((c) => c.id === g.drawnCardId) : undefined;

  let status: string;
  if (g.phase === "ended") status = g.winnerId === me ? "🏆 你出完了所有牌，获胜！" : `🏆 ${name(g.winnerId)} 获胜！`;
  else if (deciding) status = "摸到一张能出的牌：出不出？";
  else if (myTurn) status = anyPlayable ? "轮到你了：点一张亮着的牌，再点一次出牌" : "轮到你了：没有能出的牌，摸一张吧";
  else if (g.awaitingDrawDecision) status = `${name(g.currentPlayerId)} 摸到一张能出的牌，正在犹豫…`;
  else status = `等待 ${name(g.currentPlayerId)} 出牌…`;

  const colorHex = UNO_COLOR_INFO[g.currentColor].hex;

  return (
    <>
      <FxLayer fx={fx} shards={UNO_SHARDS} />
      {confetti && <Confetti chars={UNO_CONFETTI} />}

      <section className={`uno-root ${shaking ? "fx-shake" : ""}`}>
        <div className="uno-head">
          <h2>🃏 UNO</h2>
          <SoundToggle />
        </div>

        <ul className="uno-players">
          {g.order.map((id) => {
            const current = id === g.currentPlayerId && g.phase === "playing";
            const count = g.handCounts[id] ?? 0;
            return (
              <li key={id} className={`${current ? "current" : ""} ${id === g.winnerId ? "winner" : ""}`}>
                <span className="uno-player-name">
                  {current ? "👉 " : id === g.winnerId ? "🏆 " : ""}
                  {name(id)}
                  {id === me && "（我）"}
                </span>
                <span className={`uno-count ${count === 1 ? "one" : ""}`}>🂠 {count}</span>
                {g.unoSafe.includes(id) && <span className="uno-badge">UNO</span>}
                {g.unoCatchable.includes(id) && id !== me && (
                  <button type="button" className="uno-catch" onClick={() => catchPlayer(id)}>
                    🚨 抓！
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="uno-table" style={{ "--cur": colorHex } as CSSProperties}>
          <div key={spin} className={`uno-direction ${g.direction === -1 ? "ccw" : "cw"} ${spin ? "flip" : ""}`} aria-hidden>
            ↻
          </div>
          <button
            type="button"
            className={`uno-deck ${myTurn && !deciding ? "ready" : ""} ${myTurn && !deciding && !anyPlayable ? "nudge" : ""}`}
            onClick={draw}
            disabled={!myTurn || deciding}
            aria-label="摸牌"
          >
            <span className="uno-back-logo">UNO</span>
            <span className="uno-deck-count">{g.deckCount}</span>
          </button>
          <div className="uno-discard">
            <UnoCardFace key={lastPlaySeq} card={g.topCard} className="big land" tabIndex={-1} />
            {isUnoWild(g.topCard.value) && <span className="uno-chosen">{UNO_COLOR_INFO[g.currentColor].name}色</span>}
          </div>
        </div>
        <div className="uno-dirtext">
          当前颜色 <span className="uno-dot" style={{ background: colorHex }} /> {UNO_COLOR_INFO[g.currentColor].name} · 方向{" "}
          {g.direction === 1 ? "顺时针 ↻" : "逆时针 ↺"}
        </div>

        <p className={g.phase === "ended" ? "big uno-win-text" : "hint uno-status"}>{status}</p>

        {catchTargets.length > 0 && g.phase === "playing" && (
          <div className="uno-alert">
            {catchTargets.map((id) => (
              <button key={id} type="button" className="uno-catch big" onClick={() => catchPlayer(id)}>
                🚨 {name(id)} 剩 1 张没喊 UNO，抓他！
              </button>
            ))}
          </div>
        )}
        {iAmCatchable && (
          <button type="button" className="uno-shout urgent" onClick={callUno}>
            UNO! <small>快补喊，不然会被抓</small>
          </button>
        )}

        <div className="uno-hand-head">
          <h3>我的手牌（{hand.length}）</h3>
          {myTurn && g.myHand.length === 2 && (
            <button
              type="button"
              className={`uno-shout ${unoArmed ? "armed" : ""}`}
              onClick={() => {
                setUnoArmed((v) => !v);
                if (!unoArmed) sfx.unoShout();
              }}
            >
              {unoArmed ? "✅ UNO!" : "UNO!"}
            </button>
          )}
        </div>
        <div className="uno-hand" style={{ "--n": hand.length } as CSSProperties}>
          {hand.map((c) => {
            const order = fresh.get(c.id);
            const playable = canPlay(c);
            return (
              <UnoCardFace
                key={c.id}
                card={c}
                className={`${myTurn && !playable ? "dim" : ""} ${playable ? "playable" : ""} ${selected === c.id ? "selected" : ""} ${
                  order !== undefined ? "deal" : ""
                } ${g.drawnCardId === c.id ? "drawn" : ""}`}
                style={order !== undefined ? { animationDelay: `${order * 70}ms` } : undefined}
                onClick={() => tapCard(c)}
              />
            );
          })}
        </div>
        {myTurn && g.myHand.length === 2 && !unoArmed && <p className="hint">⚠ 出完这张只剩 1 张，记得先点“UNO!”</p>}

        {deciding && drawnCard && (
          <div className="row uno-decide">
            <button
              type="button"
              onClick={() => (isUnoWild(drawnCard.value) ? setColorFor(drawnCard.id) : play(drawnCard))}
            >
              出这张
            </button>
            <button type="button" className="secondary" onClick={pass}>
              不出了
            </button>
          </div>
        )}
        {myTurn && !deciding && (
          <button type="button" className={`secondary uno-draw-btn ${anyPlayable ? "" : "nudge"}`} onClick={draw}>
            摸一张牌
          </button>
        )}

        {error && <p className="error">{error}</p>}

        <ul className="history">
          {g.log
            .slice(-8)
            .reverse()
            .map((e) => (
              <li key={e.seq}>
                <strong>{name(e.playerId)}</strong> {e.text.replace("{target}", name(e.targetId))}
              </li>
            ))}
        </ul>
      </section>

      {colorFor !== null && (
        <Sheet onClose={() => setColorFor(null)}>
          <h2>选择下一个颜色</h2>
          <div className="uno-color-pick">
            {UNO_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                style={{ background: UNO_COLOR_INFO[color].hex }}
                onClick={() => {
                  const card = g.myHand.find((c) => c.id === colorFor);
                  setColorFor(null);
                  if (card) play(card, color);
                }}
              >
                {UNO_COLOR_INFO[color].name}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
