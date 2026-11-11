import { useEffect, useRef, useState } from "react";
import { jengaCanPull, jengaPullRisk, type JengaLayers, type JengaView } from "@party/shared";
import { FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import { JengaScene } from "./jengaScene";
import "./Jenga.css";

const JENGA_SHARDS = ["🧱", "🪵", "💥", "✨"];

function findBlock(layers: JengaLayers, blockId: number): { layer: number; pos: number } | null {
  for (let layer = 0; layer < layers.length; layer++) {
    const pos = layers[layer]!.indexOf(blockId);
    if (pos >= 0) return { layer, pos };
  }
  return null;
}

/** 选中木块后给个大概的危险提示（按中等手稳估算） */
function riskLabel(risk: number): { text: string; level: string } {
  if (risk >= 1) return { text: "💀 必倒：这层只剩一边了", level: "doom" };
  if (risk >= 0.15) return { text: "😱 很险", level: "high" };
  if (risk >= 0.07) return { text: "😬 有点险", level: "mid" };
  return { text: "🙂 比较稳", level: "low" };
}

/**
 * 抽木块的小游戏：指针在条上来回摆，越靠近中间按下手越稳。
 * 摆动速度随抽过的木块数变快，并且忽快忽慢，不好卡点。
 */
function SteadyMeter({
  pulls,
  onStop,
  onMove,
  onCancel,
}: {
  pulls: number;
  onStop: (steadiness: number) => void;
  onMove: (wobble: number) => void;
  onCancel: () => void;
}) {
  const needle = useRef<HTMLDivElement>(null);
  const x = useRef(0);
  const stopped = useRef(false);

  useEffect(() => {
    const speed = Math.min(7, 2.4 + pulls * 0.15);
    let phase = Math.random() * Math.PI * 2;
    let last = performance.now();
    let raf = 0;
    let lastTick = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      phase += dt * speed * (1 + 0.45 * Math.sin(now / 520));
      x.current = Math.sin(phase);
      if (needle.current) needle.current.style.left = `${50 + x.current * 46}%`;
      onMove(Math.abs(x.current));
      // 指针经过中间时轻轻响一下
      if (Math.abs(x.current) < 0.08 && now - lastTick > 250) {
        sfx.tick(0.2);
        lastTick = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      onMove(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    if (stopped.current) return;
    stopped.current = true;
    onStop(1 - Math.abs(x.current));
  };

  return (
    <div className="jg-meter">
      <div className="jg-meter-label">看准时机，指针越靠中间越稳</div>
      <div className="jg-meter-bar">
        <div className="jg-meter-zone" />
        <div ref={needle} className="jg-meter-needle" />
      </div>
      <div className="row">
        <button type="button" className="jg-pull-btn" onPointerDown={stop}>
          抽！
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          算了
        </button>
      </div>
    </div>
  );
}

export function Jenga({ room, me, actions }: GameProps) {
  const g = room.game as JengaView;
  const { error, run } = useRun();
  const { fx, show, shaking, shake } = useFx();
  const stage = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<JengaScene | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [sending, setSending] = useState(false);

  const name = (id?: string | null) => nameOf(room, id);
  const myTurn = g.phase === "playing" && g.currentPlayerId === me;

  // 场景回调里要用到最新的状态
  const latest = useRef({ g, me, name, myTurn });
  latest.current = { g, me, name, myTurn };

  useEffect(() => {
    if (!stage.current) return;
    let scene: JengaScene;
    try {
      scene = new JengaScene(stage.current, {
        onPick: (id) => {
          if (!latest.current.myTurn) return;
          setSelected(id);
          if (id !== null) sfx.woodTap();
        },
        onSlide: () => sfx.woodSlide(),
        onPlace: () => sfx.woodPlace(),
        onCollapse: () => {
          const { g, me, name } = latest.current;
          sfx.towerCollapse();
          shake();
          const loser = g.loserId;
          if (loser === me) vibrate([300, 100, 500]);
          show({ kind: "explode", icon: "💥", text: loser === me ? "你把塔推倒了！" : `${name(loser)} 把塔推倒了！` });
        },
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

  useEffect(() => {
    sceneRef.current?.sync(g.layers, g.log, g.collapse);
  }, [g.layers, g.log, g.collapse]);

  useEffect(() => {
    sceneRef.current?.setPickable((id) => {
      const at = findBlock(g.layers, id);
      return !!at && jengaCanPull(g.layers, at.layer, at.pos);
    });
  }, [g.layers]);

  useEffect(() => {
    sceneRef.current?.setSelected(selected);
  }, [selected]);

  // 轮次变化或木块已经不在原处时取消选择
  useEffect(() => {
    if (!myTurn) {
      setSelected(null);
      setPulling(false);
    }
  }, [myTurn]);
  useEffect(() => {
    if (selected === null) return;
    const at = findBlock(g.layers, selected);
    if (!at || !jengaCanPull(g.layers, at.layer, at.pos)) setSelected(null);
  }, [g.layers, selected]);

  // 轮到自己时提示；别人抽完显示手稳度
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      sfx.myTurn();
      vibrate(60);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    const maxSeq = g.log.at(-1)?.seq ?? 0;
    if (lastSeq.current === null) {
      lastSeq.current = maxSeq;
      return;
    }
    for (const e of g.log.filter((e) => e.seq > lastSeq.current!)) {
      if (e.kind === "pull" && e.steadiness !== undefined) {
        const pct = Math.round(e.steadiness * 100);
        show({ kind: "toast", icon: pct >= 80 ? "🎯" : pct >= 40 ? "🤏" : "🫨", text: `${e.playerId === me ? "你" : name(e.playerId)} 手稳度 ${pct}%` });
        // 手抖的时候塔吱呀一声
        if (pct < 40) sfx.creak();
      }
    }
    lastSeq.current = Math.max(lastSeq.current, maxSeq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.log]);

  const at = selected !== null ? findBlock(g.layers, selected) : null;
  const risk = at ? riskLabel(jengaPullRisk(g.layers, at.layer, at.pos, 0.5)) : null;

  const pull = (steadiness: number) => {
    if (selected === null) return;
    setSending(true);
    run(
      actions
        .act({ gameId: "jenga", type: "pull", blockId: selected, steadiness })
        .finally(() => {
          setSending(false);
          setPulling(false);
          setSelected(null);
        }),
    );
  };

  let status: string;
  if (g.phase === "ended") status = g.loserId === me ? "💥 你把塔推倒了，接受惩罚吧！" : `💥 ${name(g.loserId)} 把塔推倒了！`;
  else if (myTurn) status = selected === null ? "轮到你了：点一根木块选中（拖动可以转视角）" : `选中了第 ${at!.layer + 1} 层的木块`;
  else status = `等待 ${name(g.currentPlayerId)} 抽木块…`;

  return (
    <>
      <FxLayer fx={fx} shards={JENGA_SHARDS} />
      <section className={`jg-root ${shaking ? "fx-shake" : ""}`}>
        <div className="jg-head">
          <h2>🧱 层层叠</h2>
          <span className="jg-height">
            {g.layers.length} 层 · 已抽 {g.pulls} 根
          </span>
          <SoundToggle />
        </div>

        <ul className="jg-players">
          {g.order.map((id) => {
            const current = id === g.currentPlayerId && g.phase === "playing";
            return (
              <li key={id} className={`${current ? "current" : ""} ${id === g.loserId ? "loser" : ""}`}>
                {current ? "👉 " : id === g.loserId ? "💥 " : ""}
                {name(id)}
                {id === me && "（我）"} · 🪵{g.pullCounts[id] ?? 0}
              </li>
            );
          })}
        </ul>

        <div className={`jg-stage ${myTurn ? "my-turn" : ""}`} ref={stage}>
          {webglError && <p className="jg-fallback">你的浏览器不支持 WebGL，没法显示 3D 木塔 😢</p>}
        </div>

        <p className={g.phase === "ended" ? "big jg-end-text" : "hint jg-status"}>{status}</p>

        {myTurn && selected !== null && at && !pulling && (
          <div className="jg-selected">
            {risk && <span className={`jg-risk ${risk.level}`}>{risk.text}</span>}
            <div className="row">
              <button type="button" className="jg-pull-btn" onClick={() => setPulling(true)}>
                抽出这根
              </button>
              <button type="button" className="secondary" onClick={() => setSelected(null)}>
                换一根
              </button>
            </div>
          </div>
        )}
        {myTurn && pulling && !sending && (
          <SteadyMeter
            pulls={g.pulls}
            onStop={pull}
            onMove={(w) => sceneRef.current?.setTremble(w)}
            onCancel={() => setPulling(false)}
          />
        )}

        {g.phase === "ended" && (
          <ol className="jg-result">
            {[...g.order]
              .sort((a, b) => (g.pullCounts[b] ?? 0) - (g.pullCounts[a] ?? 0))
              .map((id) => (
                <li key={id} className={id === g.loserId ? "loser" : ""}>
                  {name(id)}：成功抽了 {g.pullCounts[id] ?? 0} 根{id === g.loserId && " · 推倒了塔"}
                </li>
              ))}
          </ol>
        )}

        {error && <p className="error">{error}</p>}

        <ul className="history">
          {g.log
            .slice(-6)
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
