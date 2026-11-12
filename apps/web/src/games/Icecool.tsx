import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { IC_FISH_PER_RUNNER, type IcSimEvent, type IcShot, type IcecoolView } from "@party/shared";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import { IcecoolScene, type IcSceneState } from "./icecoolScene";
import "./Icecool.css";

const COLORS = ["#e8333a", "#2f80ed", "#27ae60", "#f2994a", "#9b51e0", "#e84393"];
const SHARDS = ["🐟", "🐧", "❄️", "✨"];

const SPINS: { value: number; label: string }[] = [
  { value: -1, label: "↰ 左拐" },
  { value: 0, label: "⬆ 直线" },
  { value: 1, label: "↱ 右拐" },
];

const total = (g: IcecoolView, id: string) => (g.scores[id]?.fish ?? 0) + (g.scores[id]?.catches ?? 0);

export function Icecool({ room, me, actions }: GameProps) {
  const g = room.game as IcecoolView;
  const { error, run } = useRun();
  const { fx, show, shaking, shake } = useFx();
  const stage = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<IcecoolScene | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [spin, setSpin] = useState(0);
  const [power, setPower] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [animating, setAnimating] = useState(false);

  const name = (id?: string | null) => nameOf(room, id);
  const you = (id?: string | null) => (id === me ? "你" : name(id));
  const colors = useMemo(() => Object.fromEntries(g.order.map((id, i) => [id, COLORS[i % COLORS.length]!])), [g.order]);
  const isCatcher = g.catcherId === me;
  const myTurn = g.phase === "playing" && g.currentPlayerId === me;
  const canAim = myTurn && !animating && !sending;

  const latest = useRef({ g, me, you });
  latest.current = { g, me, you };

  // 同一下弹射里的音效别叠太多；同一条鱼 / 同一次抓人只提示一次
  const lastBump = useRef(0);
  const handled = useRef(new Set<string>());
  const onSimEvent = (e: IcSimEvent, shot: IcShot) => {
    const { g, me, you } = latest.current;
    const now = performance.now();
    if (e.kind === "bump") {
      const catcherHit = shot.shooterId === g.catcherId && (e.a === shot.shooterId || e.b === shot.shooterId);
      const other = e.a === shot.shooterId ? e.b : e.a;
      if (catcherHit && shot.caught.includes(other) && !handled.current.has(`c${other}`)) {
        handled.current.add(`c${other}`);
        sfx.caught();
        shake();
        if (other === me) vibrate([200, 80, 200]);
        show({ kind: "toast", icon: "🚨", text: `老师抓住了${you(other)}！` });
      } else if (e.speed > 1.5 && now - lastBump.current > 120) {
        lastBump.current = now;
        sfx.boing();
      }
    } else if (e.kind === "wall") {
      if (now - lastBump.current > 90) {
        lastBump.current = now;
        sfx.woodPlace();
      }
    } else if (e.kind === "door") {
      const key = `f${e.pieceId}:${e.door}`;
      if (shot.fish.some((f) => f.playerId === e.pieceId && f.door === e.door) && !handled.current.has(key)) {
        handled.current.add(key);
        sfx.crystal();
        if (e.pieceId === me) vibrate(60);
        show({ kind: "toast", icon: "🐟", text: `${you(e.pieceId)}抓到一条鱼！` });
      }
    }
  };
  const onSimEventRef = useRef(onSimEvent);
  onSimEventRef.current = onSimEvent;

  useEffect(() => {
    if (!stage.current) return;
    let scene: IcecoolScene;
    try {
      scene = new IcecoolScene(stage.current, {
        onFlick: (flick) => {
          setSending(true);
          sfx.glide(true);
          run(actions.act({ gameId: "icecool", type: "flick", flick }).finally(() => setSending(false)));
        },
        onAimChange: setPower,
        onSimEvent: (e, shot) => onSimEventRef.current(e, shot),
        onSettled: () => setAnimating(false),
      });
    } catch {
      setWebglError(true);
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新的弹射：先开始重放，再更新状态（重放期间场景不会把企鹅直接挪到终点）
  const lastShot = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const seq = g.shot?.seq ?? null;
    if (lastShot.current !== undefined && g.shot && seq !== lastShot.current) {
      handled.current = new Set();
      scene.playShot(g.shot);
      setAnimating(true);
      if (g.shot.shooterId !== me) sfx.glide(true);
    }
    lastShot.current = seq;

    const fishOnDoors = new Map<number, string[]>();
    for (const [id, doors] of Object.entries(g.targets)) {
      for (const d of doors) {
        if (g.collected[id]?.includes(d)) continue;
        fishOnDoors.set(d, [...(fishOnDoors.get(d) ?? []), id]);
      }
    }
    const st: IcSceneState = {
      pieces: g.pieces,
      me,
      catcherId: g.catcherId,
      currentId: g.currentPlayerId,
      colors,
      names: Object.fromEntries(g.order.map((id) => [id, id === me ? "我" : name(id)])),
      fishOnDoors,
      myDoors: g.targets[me] ?? [],
      canAim,
      spin,
    };
    scene.setState(st);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, canAim, spin, colors]);

  // 轮到自己时提示一下
  const wasMyTurn = useRef(false);
  useEffect(() => {
    const ready = myTurn && !animating;
    if (ready && !wasMyTurn.current) {
      sfx.myTurn();
      vibrate(60);
    }
    wasMyTurn.current = ready;
  }, [myTurn, animating]);

  // 新一轮开始
  const lastRound = useRef(g.round);
  useEffect(() => {
    if (g.round === lastRound.current) return;
    lastRound.current = g.round;
    show({ kind: "success", icon: "🎓", text: `第 ${g.round + 1} 轮`, sub: g.catcherId === me ? "这轮你当老师，去抓学生！" : `${name(g.catcherId)} 当老师，快躲开！` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.round]);

  const showSummary = !animating && g.phase !== "playing";
  const endedFx = useRef(false);
  useEffect(() => {
    if (!showSummary || g.phase !== "ended" || endedFx.current) return;
    endedFx.current = true;
    if (g.winnerIds.includes(me)) {
      sfx.win();
      show({ kind: "success", icon: "🏆", text: "你赢了！" });
    } else {
      sfx.lose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSummary, g.phase]);

  const myFish = g.collected[me]?.length ?? 0;
  let status: string;
  if (animating) status = `${you(g.shot?.shooterId)}的企鹅滑出去了…`;
  else if (g.phase === "ended") status = g.winnerIds.includes(me) ? "🏆 你是冠军！" : `🏆 ${g.winnerIds.map(name).join("、")} 获胜`;
  else if (g.phase === "roundOver") status = `第 ${g.round + 1} 轮结束`;
  else if (myTurn) {
    if (power !== null) status = power > 0 ? `力度 ${Math.round(power * 100)}%，松手弹出` : "拉远一点，回到企鹅身边松手可以取消";
    else status = isCatcher ? "轮到你（老师）：按住企鹅往后拉，去撞学生！" : "轮到你：按住企鹅往后拉，松手弹出";
  } else status = `等 ${name(g.currentPlayerId)} 弹企鹅…`;

  const ranking = [...g.order].sort((a, b) => total(g, b) - total(g, a));

  return (
    <>
      <FxLayer fx={fx} shards={SHARDS} />
      {showSummary && g.phase === "ended" && g.winnerIds.includes(me) && <Confetti chars={["🐟", "🐧", "❄️", "🎉"]} />}
      <section className={`ic-root ${shaking ? "fx-shake" : ""}`}>
        <div className="ic-head">
          <h2>🐧 冰企鹅</h2>
          <span className="ic-round">
            第 {g.round + 1}/{g.totalRounds} 轮 · {g.turn}/{g.maxTurns} 次
          </span>
          <SoundToggle />
        </div>

        <ul className="ic-players">
          {g.order.map((id) => {
            const current = id === g.currentPlayerId && g.phase === "playing";
            const catcher = id === g.catcherId;
            return (
              <li key={id} className={current ? "current" : ""} style={{ "--pc": colors[id] } as CSSProperties}>
                <span className="ic-dot" />
                {catcher ? "🎓 " : ""}
                {name(id)}
                {id === me && "（我）"}
                {!catcher && (
                  <span className="ic-fish">
                    {Array.from({ length: IC_FISH_PER_RUNNER }, (_, i) => (
                      <span key={i} className={i < (g.collected[id]?.length ?? 0) ? "got" : ""}>
                        🐟
                      </span>
                    ))}
                  </span>
                )}
                {g.caught.includes(id) && <span title="本轮被抓过">🚨</span>}
                <strong className="ic-score">{total(g, id)}</strong>
              </li>
            );
          })}
        </ul>

        <div className={`ic-stage ${canAim ? "my-turn" : ""}`} ref={stage}>
          {webglError && <p className="ic-fallback">你的浏览器不支持 WebGL，没法显示 3D 场景 😢</p>}
          {!isCatcher && g.phase === "playing" && (
            <div className="ic-mine" style={{ "--pc": colors[me] } as CSSProperties}>
              你的鱼 {myFish}/{IC_FISH_PER_RUNNER} · 地上发光的门
            </div>
          )}
        </div>

        <p className={g.phase === "ended" && !animating ? "big ic-end-text" : "hint ic-status"}>{status}</p>

        {myTurn && !animating && (
          <div className="ic-spin" role="radiogroup" aria-label="弹出的弧线">
            {SPINS.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={spin === s.value}
                className={spin === s.value ? "active" : ""}
                onClick={() => setSpin(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {showSummary && g.lastRound && (
          <div className="ic-summary">
            <div className="ic-summary-title">
              第 {g.lastRound.round + 1} 轮结束：{g.lastRound.playerId ? `${you(g.lastRound.playerId)}` : ""}
              {g.lastRound.reason}
            </div>
            <ol>
              {(g.phase === "ended" ? ranking : g.order).map((id) => (
                <li key={id} className={g.winnerIds.includes(id) ? "winner" : ""}>
                  <span className="ic-dot" style={{ "--pc": colors[id] } as CSSProperties} />
                  {name(id)}
                  {id === g.lastRound!.catcherId && " 🎓"}：本轮 +{g.lastRound!.gained[id] ?? 0}，总分 {total(g, id)}
                  <small>
                    （🐟 {g.scores[id]?.fish ?? 0} · 🚨 {g.scores[id]?.catches ?? 0}）
                  </small>
                </li>
              ))}
            </ol>
            {g.phase === "roundOver" && (
              <button type="button" className="ic-next" onClick={() => run(actions.act({ gameId: "icecool", type: "nextRound" }))}>
                下一轮：{you(g.nextCatcherId)}当老师 ▶
              </button>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <ul className="history">
          {g.log
            .slice(-5)
            .reverse()
            .map((e) => (
              <li key={e.seq}>
                <strong>{name(e.playerId)}</strong> {e.text}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
