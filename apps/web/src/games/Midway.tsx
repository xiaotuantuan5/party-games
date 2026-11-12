import { useEffect, useRef, useState } from "react";
import { MIDWAY_MAX_STRIKES, MIDWAY_SHEET_SIZE, type MidwayLogEntry, type MidwayView } from "@party/shared";
import { Avatar } from "../components";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./Midway.css";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const SHARDS = ["0", "💥", "⚖", "✨"];

/** 根据服务端下发的新事件播放音效和特效 */
function useGameEffects(g: MidwayView, me: string, name: (id?: string) => string) {
  const { fx, show, shaking, shake } = useFx();
  const [confetti, setConfetti] = useState(false);
  const lastSeq = useRef<number | null>(null);

  const onEvent = (e: MidwayLogEntry) => {
    switch (e.kind) {
      case "announce":
        sfx.flip();
        show({ kind: "toast", icon: "📢", text: "首轮统计出来了" });
        break;
      case "caught":
        sfx.explode();
        shake();
        if (e.targetId === me) vibrate([300, 100, 300]);
        show({ kind: "explode", icon: "🎯", text: e.targetId === me ? "你被指认出局了" : `${name(e.targetId)} 被指认出局` });
        break;
      case "miss":
        sfx.liar();
        show({ kind: "toast", icon: "❌", text: `${name(e.playerIds?.[0])} 指错了` });
        break;
      case "struckOut":
        sfx.lose();
        if (e.playerIds?.includes(me)) vibrate(300);
        break;
      case "zeroed":
        sfx.wild();
        show({ kind: "toast", icon: "0️⃣", text: `${name(e.targetId)} 的纸上多了一个 0` });
        break;
      case "end": {
        const won = g.result?.outcomes[me]?.won;
        if (won) sfx.win();
        else sfx.lose();
        if (won) setConfetti(true);
        break;
      }
      case "modify":
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

  return { fx, shaking, confetti };
}

/** 讨论倒计时，只是提醒，不会自动结束 */
function useCountdown(endsAt: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt ? Math.max(0, endsAt - now) : null;
}

function DigitPad({
  selected,
  onPick,
  disabled,
  mark,
}: {
  selected: number[];
  onPick: (d: number) => void;
  disabled?: (d: number) => boolean;
  /** 自己的牌，标个小点提醒 */
  mark?: number;
}) {
  return (
    <div className="mw-pad">
      {DIGITS.map((d) => (
        <button
          key={d}
          type="button"
          className={`mw-digit ${selected.includes(d) ? "on" : ""} ${d === 0 ? "zero" : ""} ${mark === d ? "mine" : ""}`}
          disabled={disabled?.(d)}
          onClick={() => onPick(d)}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function Sheet({ digits, highlight }: { digits: number[]; highlight?: number }) {
  return (
    <span className="mw-sheet">
      {digits.map((d, i) => (
        <span key={i} className={`mw-chip ${d === 0 ? "zero" : ""} ${highlight === d ? "mine" : ""}`}>
          {d}
        </span>
      ))}
    </span>
  );
}

/** 点一下翻开手牌，再点一下盖上 */
function MyCard({ g }: { g: MidwayView }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={`mw-card ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)}>
      {open ? (
        <>
          <span className={`mw-card-digit ${g.myCard === 0 ? "zero" : ""}`}>{g.myCard}</span>
          <span className="mw-card-text">
            <strong>{g.myCard === 0 ? "你是 0！" : `你的牌是 ${g.myCard}`}</strong>
            {g.myCard === 0 ? (
              <span>没人写 0 你就单独获胜；0 成了唯一最多或最少，你和写 0 的人一起输。</span>
            ) : (
              <span>让 {g.myCard} 被写的次数不多也不少。</span>
            )}
            {g.mySheet && (
              <span>
                我写的：
                <Sheet digits={g.mySheet} highlight={g.myCard} />
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="mw-card-hidden">🂠 点击查看手牌（别让别人看到）</span>
      )}
    </button>
  );
}

export function Midway({ room, me, actions }: GameProps) {
  const g = room.game as MidwayView;
  const { error, run } = useRun();
  const plain = (id?: string | null) => nameOf(room, id);
  const name = (id?: string | null) => (id === me ? "你" : plain(id));
  const { fx, shaking, confetti } = useGameEffects(g, me, name);
  const remaining = useCountdown(g.discussEndsAt);

  const [picked, setPicked] = useState<number[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [guess, setGuess] = useState<number | null>(null);
  const [queryDigit, setQueryDigit] = useState<number | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [newDigit, setNewDigit] = useState<number | null>(null);

  const alive = !(me in g.out);
  const isZero = g.myCard === 0;
  const myStrikes = g.strikes[me] ?? 0;
  const seat = (id: string) => g.order.indexOf(id) + 1;
  const submitted = g.submittedIds.includes(me);
  const ready = g.readyIds.includes(me);
  const modified = g.modifiedIds.includes(me);
  const zeroTask = g.pendingZero?.targetId === me ? g.pendingZero : null;
  const aliveCount = g.order.filter((id) => !(id in g.out)).length;

  // 阶段变化时清掉本地选择
  useEffect(() => {
    setTarget(null);
    setGuess(null);
    setSlot(null);
    setNewDigit(null);
  }, [g.phase, g.accusations.length]);

  // 轮到自己做事时提示
  const needsMe =
    (g.phase === "submit" && alive && !submitted) || !!zeroTask || (g.phase === "modify" && alive && !modified);
  const prevNeeds = useRef(false);
  useEffect(() => {
    if (needsMe && !prevNeeds.current) {
      sfx.myTurn();
      vibrate(60);
    }
    prevNeeds.current = needsMe;
  }, [needsMe]);

  const act = (a: Parameters<typeof actions.act>[0], after?: () => void) => run(actions.act(a).then(() => after?.()));

  const togglePick = (d: number) => {
    if (picked.includes(d)) setPicked(picked.filter((x) => x !== d));
    else if (picked.length < MIDWAY_SHEET_SIZE) setPicked([...picked, d]);
  };
  const missingOwn = !isZero && picked.length === MIDWAY_SHEET_SIZE && !picked.includes(g.myCard);

  const phaseTitle = { submit: "首轮提交", discuss: "自由交流", modify: "最后修改", ended: "结算" }[g.phase];
  const myOutcome = g.result?.outcomes[me];

  let status: string;
  if (g.phase === "ended") status = myOutcome?.won ? "🎉 你赢了！" : "😵 你输了";
  else if (!alive) status = g.out[me] === "caught" ? "你被指认出局了，纸条照样计入统计" : "你出局了，纸条照样计入统计";
  else if (g.phase === "submit")
    status = submitted ? `已交，等其他人…（${g.submittedIds.length}/${aliveCount}）` : `写下 ${MIDWAY_SHEET_SIZE} 个不同的数字`;
  else if (g.phase === "discuss") status = "随便聊，可以撒谎，觉得看穿了谁就指认";
  else status = modified ? `已确认，等其他人…（${g.modifiedIds.length}/${aliveCount}）` : "最后机会：可以改掉 1 个数字";

  const mmss = remaining === null ? "" : `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <>
      <FxLayer fx={fx} shards={SHARDS} />
      {confetti && <Confetti chars={["🎉", "⚖", "✨", "0"]} />}

      <section className={`mw-root ${shaking ? "fx-shake" : ""}`}>
        <div className="mw-head">
          <h2>⚖ 不上不下</h2>
          <span className="mw-phase">{phaseTitle}</span>
          <SoundToggle />
        </div>

        <MyCard g={g} />

        <p className={g.phase === "ended" ? `big mw-end-text ${myOutcome?.won ? "won" : "lost"}` : "mw-status"}>{status}</p>
        {g.phase === "ended" && myOutcome && <p className="hint center">{myOutcome.reason}</p>}

        {g.announce && g.phase !== "ended" && (
          <div className="mw-announce">
            <div>
              📢 首轮最多：<strong>{g.announce.max.length ? g.announce.max.join("、") : "无"}</strong>
              <span className="mw-sep">·</span>
              最少：<strong>{g.announce.min.length ? g.announce.min.join("、") : "无"}</strong>
            </div>
            <div className="hint">
              本局 {g.inPlayCount} 个数字在场（一定有 0），只统计这些数字
              {myStrikes > 0 && ` · 你已指错 ${myStrikes}/${MIDWAY_MAX_STRIKES}`}
            </div>
          </div>
        )}

        {g.phase === "discuss" && (
          <div className={`mw-timer ${remaining === 0 ? "over" : ""}`}>
            {remaining === 0 ? "⏰ 时间到，大家点“结束讨论”吧" : `⏱ 建议再聊 ${mmss}`}
            <span className="hint">
              {" "}
              · 结束讨论 {g.readyIds.length}/{aliveCount}
            </span>
          </div>
        )}

        <ul className="mw-seats">
          {g.order.map((id) => {
            const out = g.out[id];
            const canTarget = g.phase === "discuss" && alive && !out && id !== me && !g.pendingZero;
            const card = g.reveal?.cards[id] ?? g.revealedCards[id];
            const sheet = g.reveal?.sheets[id] ?? g.revealedSheets[id];
            const outcome = g.result?.outcomes[id];
            const strikes = g.strikes[id] ?? 0;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`mw-seat ${out ? "out" : ""} ${canTarget ? "can" : ""} ${target === id ? "selected" : ""} ${
                    outcome ? (outcome.won ? "won" : "lost") : ""
                  }`}
                  disabled={!canTarget}
                  onClick={() => setTarget(target === id ? null : id)}
                >
                  <span className="mw-seat-no">{seat(id)}</span>
                  {card !== undefined && <span className={`mw-seat-card ${card === 0 ? "zero" : ""}`}>{card}</span>}
                  <Avatar name={plain(id)} seed={id} size={36} />
                  <span className="mw-seat-name">
                    {plain(id)}
                    {id === me && "（我）"}
                  </span>
                  {sheet && sheet.length > 0 && <Sheet digits={sheet} highlight={card} />}
                  <span className="mw-seat-tags">
                    {out === "caught" && "🎯出局"}
                    {out === "strikes" && "❌出局"}
                    {out === "leave" && "离开"}
                    {!out && strikes > 0 && "❌".repeat(strikes)}
                    {g.phase === "submit" && g.submittedIds.includes(id) && "📝"}
                    {g.phase === "discuss" && g.readyIds.includes(id) && "✋"}
                    {g.phase === "modify" && g.modifiedIds.includes(id) && "✅"}
                    {outcome && (outcome.won ? "🏆" : "💀")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* ---------- 首轮提交 ---------- */}
        {g.phase === "submit" && alive && !submitted && (
          <div className="mw-panel">
            <p className="hint">
              {isZero ? "你拿到 0，可以不写 0。" : `必须包含自己的 ${g.myCard}（带点的那个）。`}已选 {picked.length}/{MIDWAY_SHEET_SIZE}
            </p>
            <DigitPad selected={picked} onPick={togglePick} mark={g.myCard} />
            {missingOwn && <p className="error">首轮必须写上自己的 {g.myCard}</p>}
            <button
              type="button"
              disabled={picked.length !== MIDWAY_SHEET_SIZE || missingOwn}
              onClick={() => act({ gameId: "midway", type: "submit", numbers: picked })}
            >
              📝 {picked.length === MIDWAY_SHEET_SIZE ? `交上去：${picked.join("、")}` : `还要选 ${MIDWAY_SHEET_SIZE - picked.length} 个`}
            </button>
          </div>
        )}

        {/* ---------- 被误指为 0：替指认者挑一个数字改成 0 ---------- */}
        {zeroTask && (
          <div className="mw-panel mw-zero-task">
            <p>
              {plain(zeroTask.accuserId)} 说你是 0，说错了！挑 Ta 纸上的一个数字改成 0：
            </p>
            <div className="mw-actions">
              {(g.revealedSheets[zeroTask.accuserId] ?? []).map((d, i) =>
                d === 0 ? null : (
                  <button key={i} type="button" onClick={() => act({ gameId: "midway", type: "zeroPick", index: i })}>
                    {d} → 0
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        {g.pendingZero && !zeroTask && g.phase === "discuss" && (
          <p className="hint center">
            等 {plain(g.pendingZero.targetId)} 把 {name(g.pendingZero.accuserId)} 纸上的一个数字改成 0…
          </p>
        )}

        {/* ---------- 自由交流 ---------- */}
        {g.phase === "discuss" && alive && (
          <div className="mw-panel">
            {target ? (
              <>
                <p>
                  指认 <strong>{plain(target)}</strong> 的牌是：
                </p>
                <DigitPad selected={guess === null ? [] : [guess]} onPick={(d) => setGuess(d)} />
                <div className="mw-actions">
                  <button
                    type="button"
                    className="mw-accuse"
                    disabled={guess === null}
                    onClick={() => act({ gameId: "midway", type: "accuse", targetId: target, digit: guess! })}
                  >
                    🎯 {guess === null ? "先选一个数字" : `就是 ${guess}！`}
                  </button>
                  <button type="button" className="secondary" onClick={() => setTarget(null)}>
                    算了
                  </button>
                </div>
                <p className="hint">
                  指错会公开你的纸条，指错 {MIDWAY_MAX_STRIKES} 次直接失败{guess === 0 && "；说别人是 0 却说错了，对方还会把你一个数字改成 0"}。
                </p>
              </>
            ) : (
              <p className="hint">想指认谁，就点 Ta 的头像。</p>
            )}
            <button
              type="button"
              className={ready ? "secondary" : ""}
              onClick={() => act({ gameId: "midway", type: "ready", ready: !ready })}
            >
              {ready ? "取消（还想再聊聊）" : "✋ 我聊完了，结束讨论"}
            </button>
          </div>
        )}

        {/* ---------- 指对换来的询问 ---------- */}
        {g.myQueriesLeft > 0 && (g.phase === "discuss" || g.phase === "modify") && (
          <div className="mw-panel">
            <p>🎯 你指对了！可以私下问一个数字现在一共被写了几次：</p>
            <DigitPad selected={queryDigit === null ? [] : [queryDigit]} onPick={setQueryDigit} />
            <button
              type="button"
              disabled={queryDigit === null}
              onClick={() => act({ gameId: "midway", type: "query", digit: queryDigit! }, () => setQueryDigit(null))}
            >
              🔍 {queryDigit === null ? "选一个数字" : `问 ${queryDigit}`}
            </button>
          </div>
        )}
        {g.myQueries.length > 0 && g.phase !== "ended" && (
          <p className="mw-queries">
            🔍 只有你知道：
            {g.myQueries.map((q, i) => (
              <span key={i}>
                {q.digit} 被写了 <strong>{q.count}</strong> 次
              </span>
            ))}
          </p>
        )}

        {/* ---------- 最后修改 ---------- */}
        {g.phase === "modify" && alive && !modified && g.mySheet && (
          <div className="mw-panel">
            <p>点一个要换掉的数字（也可以换掉自己的牌号）：</p>
            <div className="mw-slots">
              {g.mySheet.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  className={`mw-slot ${slot === i ? "on" : ""} ${d === g.myCard ? "mine" : ""}`}
                  onClick={() => {
                    setSlot(slot === i ? null : i);
                    setNewDigit(null);
                  }}
                >
                  {slot === i && newDigit !== null ? newDigit : d}
                </button>
              ))}
            </div>
            {slot !== null && (
              <DigitPad
                selected={newDigit === null ? [] : [newDigit]}
                onPick={setNewDigit}
                disabled={(d) => d !== g.mySheet![slot] && g.mySheet!.includes(d)}
                mark={g.myCard}
              />
            )}
            <div className="mw-actions">
              <button
                type="button"
                disabled={slot === null || newDigit === null}
                onClick={() => act({ gameId: "midway", type: "modify", index: slot, digit: newDigit! })}
              >
                ✏ {slot !== null && newDigit !== null ? `把 ${g.mySheet[slot]} 改成 ${newDigit}` : "选好再改"}
              </button>
              <button type="button" className="secondary" onClick={() => act({ gameId: "midway", type: "modify", index: null })}>
                不改了
              </button>
            </div>
          </div>
        )}

        {/* ---------- 结算 ---------- */}
        {g.result && (
          <div className="mw-panel">
            <h3>在场数字最终被写的次数</h3>
            <ul className="mw-bars">
              {Object.entries(g.result.counts)
                .map(([d, c]) => [Number(d), c] as const)
                .sort((a, b) => a[0] - b[0])
                .map(([d, c]) => {
                  const max = Math.max(1, ...Object.values(g.result!.counts));
                  const tag = g.result!.extremes.max.includes(d) ? "max" : g.result!.extremes.min.includes(d) ? "min" : "";
                  return (
                    <li key={d} className={tag}>
                      <span className={`mw-bar-digit ${d === 0 ? "zero" : ""}`}>{d}</span>
                      <span className="mw-bar-track">
                        <span className="mw-bar-fill" style={{ width: `${(c / max) * 100}%` }} />
                      </span>
                      <span className="mw-bar-count">
                        {c}
                        {tag === "max" && " 最多"}
                        {tag === "min" && " 最少"}
                      </span>
                    </li>
                  );
                })}
            </ul>
            <ul className="mw-outcomes">
              {g.order.map((id) => {
                const o = g.result!.outcomes[id];
                return (
                  <li key={id} className={o?.won ? "won" : "lost"}>
                    {o?.won ? "🏆" : "💀"} {plain(id)}（{g.reveal?.cards[id]}）：{o?.reason}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <ul className="history">
          {g.log
            .slice(-8)
            .reverse()
            .map((e) => (
              <li key={e.seq}>
                {e.text
                  .replace("{players}", (e.playerIds ?? []).map((id) => plain(id)).join("、"))
                  .replaceAll("{target}", plain(e.targetId))}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
