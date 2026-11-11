import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { NumberBombView } from "@party/shared";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./NumberBomb.css";

const MIN = 1;
const MAX = 100;
const NUMBERS = Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i);
const SURVIVOR_CONFETTI = ["🎉", "😅", "✨", "🎊"];

/** 0 = 很安全，1 = 只剩最后一个数 */
function urgencyOf(remaining: number): number {
  return 1 - Math.min(1, (remaining - 1) / 40);
}

/**
 * 每个猜过的数相对炸弹的方向。最终的 low 是所有“比炸弹小”的猜测中最大的一个，
 * 所以 guess <= low 就说明它比炸弹小，guess >= high 就说明它比炸弹大。
 */
function directionOf(g: NumberBombView, guess: number): "up" | "down" | "boom" {
  if (guess <= g.low) return "up";
  if (guess >= g.high) return "down";
  return "boom";
}

function useNumberBombEffects(g: NumberBombView, me: string, name: (id?: string | null) => string) {
  const { fx, show, shaking, shake } = useFx();
  const [confetti, setConfetti] = useState(false);
  const [rangeBump, setRangeBump] = useState(0);
  const seen = useRef<number | null>(null);
  const wasMyTurn = useRef(false);

  useEffect(() => {
    // 第一次渲染（包括刷新重连）不重放历史
    if (seen.current === null) {
      seen.current = g.history.length;
      return;
    }
    const fresh = g.history.slice(seen.current);
    seen.current = g.history.length;

    for (const h of fresh) {
      const who = h.playerId === me ? "你" : name(h.playerId);
      const dir = directionOf(g, h.guess);
      if (dir === "boom") {
        const iLost = h.playerId === me;
        sfx.explode();
        shake();
        show({
          kind: "explode",
          icon: "💥",
          text: iLost ? "你踩中炸弹了！" : `${who} 踩中炸弹了！`,
          sub: `炸弹就是 ${h.guess}`,
        });
        if (iLost) {
          sfx.lose();
          vibrate([300, 100, 500]);
        } else {
          sfx.win();
          setConfetti(true);
        }
      } else {
        const remaining = g.high - g.low - 1;
        sfx.safe(urgencyOf(remaining));
        sfx.sweep();
        setRangeBump((n) => n + 1);
        show({
          kind: "toast",
          icon: dir === "up" ? "⬆️" : "⬇️",
          text: `${who}猜了 ${h.guess}，炸弹比它${dir === "up" ? "大" : "小"}，还剩 ${remaining} 个数`,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.history.length]);

  const isMyTurn = g.phase === "playing" && g.currentPlayerId === me;
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) {
      sfx.myTurn();
      vibrate(60);
    }
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  return { fx, shaking, confetti, rangeBump };
}

export function NumberBomb({ room, me, actions }: GameProps) {
  const g = room.game as NumberBombView;
  const { error, run } = useRun();
  const name = (id?: string | null) => nameOf(room, id);
  const { fx, shaking, confetti, rangeBump } = useNumberBombEffects(g, me, name);

  const lo = g.low + 1;
  const hi = g.high - 1;
  const remaining = hi - lo + 1;
  const ended = g.phase === "ended";
  const urgency = ended ? 0 : urgencyOf(remaining);
  const myTurn = g.phase === "playing" && g.currentPlayerId === me;
  const lastGuess = g.history.at(-1)?.guess ?? null;
  const guessed = new Set(g.history.map((h) => h.guess));

  const [selected, setSelected] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 范围变化或回合交接时清掉选择
  useEffect(() => {
    setSelected(null);
  }, [lo, hi, myTurn]);

  useEffect(
    () => () => {
      if (rollTimer.current) clearTimeout(rollTimer.current);
    },
    [],
  );

  // 轮到自己时滴答作响，范围越小越快
  useEffect(() => {
    if (!myTurn) return;
    const interval = Math.round(1000 - 700 * urgency);
    const t = setInterval(() => sfx.tick(urgency), interval);
    return () => clearInterval(t);
  }, [myTurn, urgency]);

  const confirm = (n: number) => run(actions.act({ gameId: "numberBomb", type: "guess", value: n }));

  const tap = (n: number) => {
    if (!myTurn || rolling) return;
    if (selected === n) {
      confirm(n);
      return;
    }
    sfx.pick();
    setSelected(n);
  };

  /** 高亮在可选数字之间乱跳、逐渐变慢，最后停在一个数上（只选中，不自动提交） */
  const roll = () => {
    if (!myTurn || rolling) return;
    const candidates = NUMBERS.filter((n) => n >= lo && n <= hi);
    let steps = Math.min(16, 6 + candidates.length);
    let delay = 45;
    let prev: number | null = null;
    setRolling(true);
    const hop = () => {
      let n = candidates[Math.floor(Math.random() * candidates.length)]!;
      if (n === prev && candidates.length > 1) n = candidates[(candidates.indexOf(n) + 1) % candidates.length]!;
      prev = n;
      setSelected(n);
      sfx.tick(urgency);
      if (--steps > 0) {
        delay *= 1.18;
        rollTimer.current = setTimeout(hop, delay);
      } else {
        sfx.pick();
        setRolling(false);
      }
    };
    hop();
  };

  return (
    <>
      <FxLayer fx={fx} />
      {confetti && <Confetti chars={SURVIVOR_CONFETTI} />}

      <section
        className={`nb-root ${shaking ? "fx-shake" : ""}`}
        style={{ "--urgency": urgency, "--beat": `${1.2 - 0.9 * urgency}s` } as CSSProperties}
      >
        <div className="nb-head">
          <h2>💣 数字炸弹</h2>
          <SoundToggle />
        </div>

        <div className={`nb-stage ${ended ? "ended" : ""}`}>
          <div className={`nb-bomb ${ended ? "gone" : ""}`}>
            <span className="nb-spark">✨</span>💣
          </div>
          {ended ? (
            <div className="nb-reveal">
              炸弹是 <span className="nb-reveal-number">{g.bomb}</span>
            </div>
          ) : (
            <div className="nb-stage-text">
              <div key={rangeBump} className={`nb-range ${rangeBump ? "bump" : ""}`}>
                {lo} <span className="nb-tilde">~</span> {hi}
              </div>
              <div className="nb-odds">
                {remaining === 1 ? "只剩最后一个数了……" : `还剩 ${remaining} 个数，猜中概率 1/${remaining}`}
              </div>
            </div>
          )}
        </div>

        <ul className="nb-players">
          {g.order.map((id) => {
            const current = !ended && id === g.currentPlayerId;
            const lost = id === g.loserId;
            return (
              <li key={id} className={`${current ? "current" : ""} ${lost ? "lost" : ""}`}>
                {lost ? "💥 " : current ? "👉 " : ""}
                {name(id)}
                {id === me && "（我）"}
              </li>
            );
          })}
        </ul>

        {/* 1~100 数字格子：点一下选中，再点一下（或按按钮）确认 */}
        <div className={`nb-grid ${myTurn ? "active" : ""}`}>
          {NUMBERS.map((n) => {
            const isBomb = ended && n === g.bomb;
            const out = !isBomb && (n < lo || n > hi);
            const cls = [
              "nb-tile",
              out ? "out" : "in",
              guessed.has(n) ? "guessed" : "",
              n === lastGuess && !isBomb ? "last" : "",
              n === selected ? "selected" : "",
              isBomb ? "bomb" : "",
            ].join(" ");
            // 被排除的格子从刚猜的数开始，按距离依次翻走
            const delay = out && lastGuess !== null ? Math.min(450, Math.abs(n - lastGuess) * 14) : 0;
            return (
              <button
                key={n}
                type="button"
                className={cls}
                style={{ "--d": `${delay}ms` } as CSSProperties}
                disabled={!myTurn || out || rolling}
                aria-label={`${n}`}
                aria-pressed={n === selected}
                onClick={() => tap(n)}
              >
                {isBomb ? "💥" : n}
              </button>
            );
          })}
        </div>

        {ended ? (
          <p className="big nb-result">
            {g.loserId === me ? "😭 你踩中了炸弹" : `😅 ${name(g.loserId)} 踩中了炸弹，其他人安全！`}
          </p>
        ) : myTurn ? (
          <div className="nb-actions">
            <p className="nb-turn">
              {rolling ? "🎲 命运转盘转起来了…" : selected === null ? "轮到你了！点一个数字" : `选中了 ${selected}，再点一次或按按钮确认`}
            </p>
            <div className="row">
              <button type="button" className="secondary nb-dice" disabled={rolling} onClick={roll}>
                🎲 随机
              </button>
              <button
                type="button"
                className="nb-go"
                disabled={selected === null || rolling}
                onClick={() => selected !== null && confirm(selected)}
              >
                {selected === null ? "先选一个数" : `就它了！${selected}`}
              </button>
            </div>
          </div>
        ) : (
          <p className="hint nb-wait">等待 {name(g.currentPlayerId)} 选数字…</p>
        )}

        {error && <p className="error">{error}</p>}

        {g.history.length > 0 && (
          <div className="nb-history">
            {g.history.map((h, i) => {
              const dir = directionOf(g, h.guess);
              return (
                <span key={i} className={`nb-chip ${dir}`}>
                  {name(h.playerId)} {h.guess}
                  {dir === "up" ? " ⬆️" : dir === "down" ? " ⬇️" : " 💥"}
                </span>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
