import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { NumberBombView } from "@party/shared";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./NumberBomb.css";

const MIN = 1;
const MAX = 100;
const TOTAL = MAX - MIN + 1;
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
  const urgency = g.phase === "playing" ? urgencyOf(remaining) : 0;
  const myTurn = g.phase === "playing" && g.currentPlayerId === me;

  const mid = Math.floor((lo + hi) / 2);
  const [value, setValue] = useState(String(mid));
  // 范围变了就把输入重置到新范围的中间
  useEffect(() => setValue(String(mid)), [lo, hi, mid]);

  // 轮到自己时滴答作响，范围越小越快
  useEffect(() => {
    if (!myTurn) return;
    const interval = Math.round(1000 - 700 * urgency);
    const t = setInterval(() => sfx.tick(urgency), interval);
    return () => clearInterval(t);
  }, [myTurn, urgency]);

  const num = Number(value);
  const valid = Number.isInteger(num) && num >= lo && num <= hi;
  const submit = () => {
    if (valid) run(actions.act({ gameId: "numberBomb", type: "guess", value: num }));
  };

  const pct = (n: number) => `${(n / TOTAL) * 100}%`;
  const ended = g.phase === "ended";

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
              <div className="nb-reveal-label">炸弹是</div>
              <div className="nb-reveal-number">{g.bomb}</div>
            </div>
          ) : (
            <div key={rangeBump} className={`nb-range ${rangeBump ? "bump" : ""}`}>
              {lo} <span className="nb-tilde">~</span> {hi}
            </div>
          )}
          {!ended && (
            <div className="nb-odds">
              {remaining === 1 ? "只剩最后一个数了……" : `还剩 ${remaining} 个数，随便猜中炸弹的概率 1/${remaining}`}
            </div>
          )}
        </div>

        {/* 1~100 数轴：灰色是已排除的区间，亮色是还可能藏着炸弹的区间 */}
        <div className="nb-track" aria-hidden>
          <div className="nb-safe" style={{ left: pct(lo - MIN), width: pct(remaining) }} />
          {g.history.map((h, i) => (
            <span
              key={i}
              className={`nb-mark ${directionOf(g, h.guess)}`}
              style={{ left: `calc(${pct(h.guess - MIN)} + ${50 / TOTAL}%)` }}
            />
          ))}
          <span className="nb-track-label left">{MIN}</span>
          <span className="nb-track-label right">{MAX}</span>
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

        {ended ? (
          <p className="big nb-result">
            {g.loserId === me ? "😭 你踩中了炸弹" : `😅 ${name(g.loserId)} 踩中了炸弹，其他人安全！`}
          </p>
        ) : myTurn ? (
          <div className="nb-input">
            <p className="nb-turn">轮到你了！选一个数</p>
            <input
              className="nb-slider"
              type="range"
              min={lo}
              max={hi}
              value={valid ? num : mid}
              onChange={(e) => setValue(e.target.value)}
              disabled={remaining === 1}
            />
            <div className="row">
              <button type="button" className="secondary" onClick={() => setValue(String(Math.max(lo, num - 1)))}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={value}
                min={lo}
                max={hi}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <button type="button" className="secondary" onClick={() => setValue(String(Math.min(hi, num + 1)))}>
                +
              </button>
              <button type="button" className="nb-go" disabled={!valid} onClick={submit}>
                就它了！
              </button>
            </div>
          </div>
        ) : (
          <p className="hint nb-wait">等待 {name(g.currentPlayerId)} 猜数字…</p>
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
