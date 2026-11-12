import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  HOLDEM_STREET_LABEL,
  HOLDEM_TURN_SECONDS,
  POKER_SUITS,
  bestHand,
  describeHole,
  pokerRankLabel,
  type HoldemLogEntry,
  type HoldemSeat,
  type HoldemView,
  type PokerCard,
} from "@party/shared";
import { Avatar } from "../components";
import { Confetti, FxLayer, SoundToggle, useFreshCards, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./Holdem.css";

const WIN_CONFETTI = ["♠", "♥", "♦", "♣", "🪙", "🏆"];

export function CardFace({ card, size = "md", highlight, dim }: { card: PokerCard; size?: "sm" | "md" | "lg"; highlight?: boolean; dim?: boolean }) {
  const suit = POKER_SUITS[card.suit];
  return (
    <span className={`he-card ${size} ${suit.red ? "red" : ""} ${highlight ? "hl" : ""} ${dim ? "dim" : ""}`}>
      <span className="he-card-rank">{pokerRankLabel(card.rank)}</span>
      <span className="he-card-suit">{suit.symbol}</span>
    </span>
  );
}

function CardBack({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return <span className={`he-card back ${size}`} />;
}

/** 服务端只在状态变化时推送剩余秒数，这里在本地接着倒数 */
function useCountdown(seconds: number, key: unknown): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const start = Date.now();
    setLeft(seconds);
    if (seconds <= 0) return;
    const t = setInterval(() => setLeft(Math.max(0, seconds - (Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, [seconds, key]);
  return left;
}

function useHoldemEffects(g: HoldemView, me: string) {
  const { fx, show } = useFx();
  const [confetti, setConfetti] = useState(false);
  const lastSeq = useRef<number | null>(null);
  const wasMyTurn = useRef(false);
  const prevWinner = useRef<string | null | undefined>(undefined);

  const onEvent = (e: HoldemLogEntry) => {
    switch (e.kind) {
      case "hand":
        sfx.shuffle();
        break;
      case "street":
        sfx.flip();
        break;
      case "check":
        sfx.woodTap();
        break;
      case "call":
      case "raise":
        sfx.play();
        break;
      case "allin":
        sfx.attack();
        if (e.playerId !== me) vibrate(60);
        break;
      case "fold":
        sfx.draw();
        break;
      case "win":
        if (e.playerId === me) {
          sfx.win();
          show({ kind: "success", icon: "🪙", text: `你${e.text}` });
        }
        break;
      case "bust":
        if (e.playerId === me) {
          sfx.lose();
          show({ kind: "explode", icon: "💸", text: "筹码输光了" });
        }
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    const maxSeq = g.log.at(-1)?.seq ?? 0;
    if (lastSeq.current === null) {
      lastSeq.current = maxSeq;
      return;
    }
    const fresh = g.log.filter((e) => e.seq > lastSeq.current!);
    lastSeq.current = Math.max(lastSeq.current, maxSeq);
    fresh.forEach(onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.log]);

  const myTurn = g.phase === "betting" && g.turnId === me;
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      sfx.myTurn();
      vibrate(60);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  useEffect(() => {
    if (prevWinner.current === undefined) {
      prevWinner.current = g.winnerId;
      return;
    }
    if (g.winnerId && !prevWinner.current) {
      setConfetti(true);
      sfx.win();
    }
    prevWinner.current = g.winnerId;
  }, [g.winnerId]);

  return { fx, confetti };
}

function Seat({
  seat,
  g,
  me,
  name,
  turnLeft,
}: {
  seat: HoldemSeat;
  g: HoldemView;
  me: string;
  name: string;
  turnLeft: number;
}) {
  const isTurn = g.turnId === seat.id;
  const net = g.result?.net[seat.id] ?? 0;
  const winner = g.result?.pots.some((p) => p.winners.includes(seat.id)) ?? false;
  const inHand = !seat.out && !seat.folded;
  return (
    <li
      className={`he-seat ${isTurn ? "turn" : ""} ${seat.folded ? "folded" : ""} ${seat.out ? "out" : ""} ${winner && g.phase !== "betting" ? "winner" : ""} ${seat.id === me ? "me" : ""}`}
    >
      <div className="he-seat-top">
        <Avatar name={name} seed={seat.id} size={28} />
        <div className="he-seat-info">
          <div className="he-seat-name">
            {name}
            {seat.id === me && "（我）"}
          </div>
          <div className="he-seat-chips">🪙 {seat.chips}</div>
        </div>
        <div className="he-badges">
          {seat.id === g.dealerId && !seat.out && <span className="he-badge d">D</span>}
          {seat.id === g.sbId && !seat.out && <span className="he-badge">小</span>}
          {seat.id === g.bbId && !seat.out && <span className="he-badge">大</span>}
        </div>
      </div>
      <div className="he-seat-bottom">
        <span className="he-seat-cards">
          {seat.shownCards
            ? seat.shownCards.map((c) => <CardFace key={c.id} card={c} size="sm" highlight={g.result?.winningCardIds.includes(c.id)} />)
            : inHand && seat.id !== me && (
                <>
                  <CardBack size="sm" />
                  <CardBack size="sm" />
                </>
              )}
        </span>
        <span className="he-seat-status">
          {seat.out ? (
            "出局"
          ) : g.phase !== "betting" && g.result && net !== 0 ? (
            <span className={net > 0 ? "plus" : "minus"}>
              {net > 0 ? "+" : ""}
              {net}
            </span>
          ) : (
            (seat.handName ?? seat.lastAction ?? "")
          )}
        </span>
      </div>
      {seat.bet > 0 && g.phase === "betting" && <span className="he-bet">{seat.bet}</span>}
      {isTurn && g.phase === "betting" && (
        <span className="he-timer" style={{ "--p": `${(turnLeft / HOLDEM_TURN_SECONDS) * 100}%` } as CSSProperties} />
      )}
    </li>
  );
}

function RaisePanel({ g, onRaise, onCancel }: { g: HoldemView; onRaise: (to: number) => void; onCancel: () => void }) {
  const min = Math.min(g.minRaiseTo, g.maxRaiseTo);
  const max = g.maxRaiseTo;
  const [to, setTo] = useState(min);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / g.bigBlind) * g.bigBlind || v));
  const potAfterCall = g.pot + g.callAmount;
  const presets: [string, number][] = [
    ["最小", min],
    ["½ 池", clamp(g.currentBet + potAfterCall / 2)],
    ["¾ 池", clamp(g.currentBet + (potAfterCall * 3) / 4)],
    ["1 池", clamp(g.currentBet + potAfterCall)],
    ["全下", max],
  ];
  return (
    <div className="he-raise">
      <div className="he-raise-presets">
        {presets.map(([label, v]) => (
          <button key={label} type="button" className={`he-chip-btn ${to === v ? "on" : ""}`} onClick={() => setTo(v)}>
            {label}
          </button>
        ))}
      </div>
      <div className="he-raise-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={to}
          onChange={(e) => setTo(Number(e.target.value))}
          aria-label="加注到"
        />
        <input
          type="number"
          className="he-raise-input"
          min={min}
          max={max}
          value={to}
          onChange={(e) => setTo(Number(e.target.value) || min)}
          onBlur={() => setTo((v) => Math.max(min, Math.min(max, Math.round(v))))}
        />
      </div>
      <div className="row">
        <button type="button" className="secondary" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="he-btn raise grow" onClick={() => onRaise(Math.max(min, Math.min(max, Math.round(to))))}>
          {to >= max ? `全下 ${max}` : g.currentBet === 0 ? `下注 ${to}` : `加注到 ${to}`}
        </button>
      </div>
    </div>
  );
}

export function Holdem({ room, me, actions }: GameProps) {
  const g = room.game as HoldemView;
  const { error, run } = useRun();
  const name = (id?: string | null) => nameOf(room, id);
  const { fx, confetti } = useHoldemEffects(g, me);
  const freshBoard = useFreshCards(g.board);
  const freshHole = useFreshCards(g.myCards);
  const turnLeft = useCountdown(g.turnSecondsLeft, `${g.turnId}-${g.log.at(-1)?.seq}`);
  const nextIn = useCountdown(g.nextHandIn, g.handNo);
  const [raising, setRaising] = useState(false);

  const mySeat = g.seats.find((p) => p.id === me);
  const myTurn = g.phase === "betting" && g.turnId === me;
  useEffect(() => {
    if (!myTurn) setRaising(false);
  }, [myTurn]);

  const myHand = useMemo(() => {
    if (g.myCards.length !== 2) return "";
    const v = bestHand([...g.myCards, ...g.board]);
    return v ? v.name : describeHole(g.myCards);
  }, [g.myCards, g.board]);
  const myBestIds = useMemo(() => {
    const v = bestHand([...g.myCards, ...g.board]);
    return v && v.category > 0 ? new Set(v.best.map((c) => c.id)) : new Set<number>();
  }, [g.myCards, g.board]);

  const act = (type: "fold" | "check" | "call" | "allin") => run(actions.act({ gameId: "holdem", type }));
  const raise = (to: number) =>
    run(
      actions.act(to >= g.maxRaiseTo ? { gameId: "holdem", type: "allin" } : { gameId: "holdem", type: "raise", to }).then(() => setRaising(false)),
    );

  const allInCall = myTurn && g.callAmount > 0 && mySeat && g.callAmount >= mySeat.chips;
  const winnerName = g.winnerId === me ? "你" : name(g.winnerId);

  return (
    <>
      <FxLayer fx={fx} />
      {confetti && <Confetti chars={WIN_CONFETTI} delay={0.3} />}
      <section className="he-root">
        <div className="he-head">
          <h2>♠ 德州扑克</h2>
          <span className="he-pill">
            第 {g.handNo} 手 · 盲注 {g.smallBlind}/{g.bigBlind}
          </span>
          <SoundToggle />
        </div>
        {g.handsToNextLevel > 0 && g.phase !== "ended" && (
          <p className="hint he-sub">{g.handsToNextLevel === 1 ? "下一手升盲注" : `再打 ${g.handsToNextLevel} 手升盲注`}</p>
        )}

        <div className="he-table">
          <div className="he-street">{HOLDEM_STREET_LABEL[g.street]}</div>
          <div className="he-board">
            {Array.from({ length: 5 }, (_, i) => {
              const c = g.board[i];
              if (!c) return <span key={`slot-${i}`} className="he-card slot md" />;
              const order = freshBoard.get(c.id);
              return (
                <span
                  key={c.id}
                  className={order !== undefined ? "he-deal" : ""}
                  style={order !== undefined ? { animationDelay: `${order * 180}ms` } : undefined}
                >
                  <CardFace
                    card={c}
                    highlight={g.result ? g.result.winningCardIds.includes(c.id) : myBestIds.has(c.id)}
                    dim={!!g.result && g.result.winningCardIds.length > 0 && !g.result.winningCardIds.includes(c.id)}
                  />
                </span>
              );
            })}
          </div>
          <div className="he-pot">
            底池 <strong>🪙 {g.pot}</strong>
          </div>
        </div>

        {g.phase === "result" && g.result && (
          <div className="he-result">
            {g.result.pots.map((p, i) => (
              <div key={i}>
                {g.result!.pots.length > 1 && <span className="he-pot-tag">{i === 0 ? "主池" : `边池 ${i}`}</span>}
                <strong>{p.winners.map((id) => (id === me ? "你" : name(id))).join("、")}</strong>
                {p.winners.length > 1 ? " 平分 " : " 赢下 "}
                🪙 {p.amount}
                {p.handName && ` · ${p.handName}`}
              </div>
            ))}
            {g.result.uncontested && <div className="hint">其他人都弃牌了，不用亮牌</div>}
            <div className="hint">{Math.ceil(nextIn)} 秒后发下一手…</div>
          </div>
        )}
        {g.phase === "ended" && <p className="big he-winner">🏆 {winnerName}赢走了所有筹码！</p>}

        <ul className="he-seats">
          {g.seats.map((seat) => (
            <Seat key={seat.id} seat={seat} g={g} me={me} name={name(seat.id)} turnLeft={turnLeft} />
          ))}
        </ul>

        {mySeat && !mySeat.out && g.myCards.length > 0 && (
          <div className={`he-me ${myTurn ? "turn" : ""} ${mySeat.folded ? "folded" : ""}`}>
            <div className="he-hole">
              {g.myCards.map((c) => {
                const order = freshHole.get(c.id);
                return (
                  <span
                    key={c.id}
                    className={order !== undefined ? "he-deal" : ""}
                    style={order !== undefined ? { animationDelay: `${order * 150}ms` } : undefined}
                  >
                    <CardFace card={c} size="lg" highlight={myBestIds.has(c.id)} />
                  </span>
                );
              })}
            </div>
            <div className="he-me-info">
              <div className="he-me-hand">{mySeat.folded ? "已弃牌" : myHand}</div>
              <div className="hint">
                筹码 🪙 {mySeat.chips}
                {mySeat.bet > 0 && ` · 本轮已下 ${mySeat.bet}`}
              </div>
              {myTurn && <div className="he-me-timer">轮到你了 · {Math.ceil(turnLeft)} 秒</div>}
              {!myTurn && g.phase === "betting" && g.turnId && <div className="hint">等待 {name(g.turnId)} 行动…</div>}
            </div>
          </div>
        )}
        {mySeat?.out && g.phase !== "ended" && <p className="hint center">你已出局，可以继续观战</p>}

        {myTurn &&
          (raising ? (
            <RaisePanel g={g} onRaise={raise} onCancel={() => setRaising(false)} />
          ) : (
            <div className="he-actions">
              <button type="button" className="he-btn fold" onClick={() => act("fold")}>
                弃牌
              </button>
              {g.canCheck ? (
                <button type="button" className="he-btn check" onClick={() => act("check")}>
                  过牌
                </button>
              ) : (
                <button type="button" className="he-btn call" onClick={() => act("call")}>
                  {allInCall ? `全下跟注 ${g.callAmount}` : `跟注 ${g.callAmount}`}
                </button>
              )}
              {g.canRaise &&
                (g.maxRaiseTo > g.minRaiseTo ? (
                  <button type="button" className="he-btn raise" onClick={() => setRaising(true)}>
                    {g.currentBet === 0 ? "下注" : "加注"}
                  </button>
                ) : (
                  <button type="button" className="he-btn raise" onClick={() => act("allin")}>
                    全下 {g.maxRaiseTo}
                  </button>
                ))}
            </div>
          ))}

        {error && <p className="error">{error}</p>}

        <ul className="history he-log">
          {g.log
            .slice(-6)
            .reverse()
            .map((e) => (
              <li key={e.seq} className={`he-log-${e.kind}`}>
                {e.playerId && <strong>{e.playerId === me ? "你" : name(e.playerId)} </strong>}
                {e.text}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
