import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CF_BLOCKS,
  CF_CELLS,
  CF_COLS,
  CF_MAX_HEIGHT,
  CF_MAX_SHOTS,
  CF_PITCH_MAX,
  CF_PITCH_MIN,
  CF_PRESETS,
  CF_SOLDIERS,
  CF_YAW_RANGE,
  cfRandomBuild,
  type CatapultView,
  type CfAim,
  type CfBuild,
} from "@party/shared";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import { CatapultScene } from "./catapultScene";
import "./Catapult.css";

const COLORS = ["#e8333a", "#2f80ed", "#27ae60", "#f2994a"];
const SHARDS = ["🪨", "🧱", "💥", "🏯"];

type Tool = "add" | "remove" | "soldier";
const TOOLS: { id: Tool; label: string }[] = [
  { id: "add", label: "🧱 加砖" },
  { id: "remove", label: "⛏ 拆砖" },
  { id: "soldier", label: "💂 士兵" },
];

const used = (b: CfBuild) => b.heights.reduce((a, h) => a + h, 0);
const copy = (b: CfBuild): CfBuild => ({ heights: [...b.heights], soldiers: [...b.soldiers] });

/** 搭城堡：5 × 3 的格子，点一下按当前工具改一格 */
function Builder({ draft, onChange, locked }: { draft: CfBuild; onChange: (b: CfBuild) => void; locked: boolean }) {
  const [tool, setTool] = useState<Tool>("add");
  const [hint, setHint] = useState<string | null>(null);
  const left = CF_BLOCKS - used(draft);

  const tap = (cell: number) => {
    if (locked) return;
    const b = copy(draft);
    setHint(null);
    if (tool === "add") {
      if (left <= 0) return setHint("砖用完了，先拆掉一些");
      if (b.heights[cell]! >= CF_MAX_HEIGHT) return setHint(`一格最多叠 ${CF_MAX_HEIGHT} 层`);
      b.heights[cell]!++;
      sfx.woodPlace();
    } else if (tool === "remove") {
      if (b.heights[cell]! <= 0) return;
      b.heights[cell]!--;
      sfx.woodTap();
    } else {
      const i = b.soldiers.indexOf(cell);
      if (i >= 0) b.soldiers.splice(i, 1);
      else {
        // 已经有 3 个了：最早放的那个挪过来
        if (b.soldiers.length >= CF_SOLDIERS) b.soldiers.shift();
        b.soldiers.push(cell);
      }
      sfx.pick();
    }
    onChange(b);
  };

  return (
    <div className={`cf-builder ${locked ? "locked" : ""}`}>
      <div className="cf-tools" role="radiogroup" aria-label="工具">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={tool === t.id}
            className={tool === t.id ? "active" : ""}
            disabled={locked}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="cf-front">⬆ 前方（朝向敌人）</div>
      <div className="cf-grid" style={{ gridTemplateColumns: `repeat(${CF_COLS}, 1fr)` }}>
        {Array.from({ length: CF_CELLS }, (_, cell) => {
          const h = draft.heights[cell]!;
          const soldier = draft.soldiers.includes(cell);
          return (
            <button key={cell} type="button" className={`cf-cell h${h}`} disabled={locked} onClick={() => tap(cell)}>
              <span className="cf-stack">
                {Array.from({ length: h }, (_, i) => (
                  <span key={i} className="cf-brick" />
                ))}
              </span>
              {soldier && <span className="cf-soldier">💂</span>}
              {h > 0 && <span className="cf-h">{h}</span>}
            </button>
          );
        })}
      </div>
      <div className="cf-counts">
        🧱 还剩 {left}/{CF_BLOCKS} 块 · 💂 {draft.soldiers.length}/{CF_SOLDIERS} 个士兵
      </div>
      {hint && <p className="error">{hint}</p>}
      {!locked && (
        <div className="cf-presets">
          {CF_PRESETS.map((p) => (
            <button key={p.name} type="button" className="secondary" onClick={() => onChange(copy(p.build))}>
              {p.name}
            </button>
          ))}
          <button type="button" className="secondary" onClick={() => onChange(cfRandomBuild())}>
            🎲 随机
          </button>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="cf-slider">
      <span className="cf-slider-label">
        {label}
        <strong>{format(value)}</strong>
      </span>
      <span className="cf-slider-row">
        <button type="button" className="cf-nudge" onClick={() => onChange(Math.max(min, +(value - step).toFixed(3)))} aria-label={`${label}减小`}>
          −
        </button>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <button type="button" className="cf-nudge" onClick={() => onChange(Math.min(max, +(value + step).toFixed(3)))} aria-label={`${label}增大`}>
          +
        </button>
      </span>
    </label>
  );
}

export function Catapult({ room, me, actions }: GameProps) {
  const g = room.game as CatapultView;
  const { error, run } = useRun();
  const { fx, show, shaking, shake } = useFx();
  const stage = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CatapultScene | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [draft, setDraft] = useState<CfBuild>(() => g.myBuild ?? copy(CF_PRESETS[0]!.build));
  const [aim, setAim] = useState<CfAim>({ yaw: 0, pitch: 40, power: 0.5 });
  const [sending, setSending] = useState(false);
  const [animating, setAnimating] = useState(false);

  const name = (id?: string | null) => nameOf(room, id);
  const you = (id?: string | null) => (id === me ? "你" : name(id));
  const colors = useMemo(() => Object.fromEntries(g.order.map((id, i) => [id, COLORS[i % COLORS.length]!])), [g.order]);
  const ready = g.ready.includes(me);
  const myTurn = g.phase === "battle" && g.currentPlayerId === me;
  const canFire = myTurn && !animating && !sending;

  const latest = useRef({ me, you });
  latest.current = { me, you };

  useEffect(() => {
    if (!stage.current) return;
    let scene: CatapultScene;
    let lastImpact = 0;
    try {
      scene = new CatapultScene(stage.current, {
        onImpact: (kind, speed) => {
          const now = performance.now();
          if (now - lastImpact < 150) return;
          lastImpact = now;
          if (kind === "ground") sfx.land();
          else {
            sfx.rockBreak();
            if (speed > 6) shake();
          }
        },
        onSoldierDown: (owner) => {
          const { me, you } = latest.current;
          sfx.towerCollapse();
          if (owner === me) vibrate([200, 80, 300]);
          show({ kind: "toast", icon: "💥", text: `${you(owner)}的士兵倒下了！` });
        },
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

  useEffect(() => {
    sceneRef.current?.setPlayers(g.order, colors, me);
  }, [g.order, colors, me]);

  // 开战时镜头从地块拉远
  useEffect(() => {
    sceneRef.current?.resetCamera(g.phase === "build");
  }, [g.phase, g.order]);

  // 搭建阶段：预览自己的城堡
  useEffect(() => {
    if (g.phase === "build") sceneRef.current?.setPreview(draft);
  }, [g.phase, g.order, draft]);

  // 对战：新的发射先开始重放，再交给场景最终位置
  const lastShot = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || g.phase === "build") return;
    const seq = g.shot?.seq ?? null;
    if (lastShot.current !== undefined && g.shot && seq !== lastShot.current) {
      scene.playShot(g.shot);
      setAnimating(true);
      sfx.attack();
    }
    lastShot.current = seq;
    scene.setBodies(g.bodies);
  }, [g.phase, g.shot, g.bodies]);

  useEffect(() => {
    sceneRef.current?.setAim(canFire ? aim : null);
  }, [aim, canFire]);

  const wasMyTurn = useRef(false);
  useEffect(() => {
    const r = myTurn && !animating;
    if (r && !wasMyTurn.current) {
      sfx.myTurn();
      vibrate(60);
    }
    wasMyTurn.current = r;
  }, [myTurn, animating]);

  const lastPhase = useRef(g.phase);
  useEffect(() => {
    if (lastPhase.current === "build" && g.phase === "battle") {
      sfx.gate();
      show({ kind: "success", icon: "⚔️", text: "开战！", sub: g.currentPlayerId === me ? "你先发射" : `${name(g.currentPlayerId)} 先发射` });
    }
    lastPhase.current = g.phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.phase]);

  const showEnd = g.phase === "ended" && !animating;
  const endFx = useRef(false);
  useEffect(() => {
    if (!showEnd || endFx.current) return;
    endFx.current = true;
    if (g.winnerIds.includes(me)) {
      sfx.win();
      show({ kind: "success", icon: "🏆", text: g.winnerIds.length > 1 ? "平局！" : "你赢了！" });
    } else sfx.lose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEnd]);

  const submit = () => {
    if (draft.soldiers.length !== CF_SOLDIERS) {
      show({ kind: "toast", icon: "💂", text: `还要再放 ${CF_SOLDIERS - draft.soldiers.length} 个士兵` });
      return;
    }
    run(actions.act({ gameId: "catapult", type: "build", build: draft }));
  };

  const fire = () => {
    setSending(true);
    run(actions.act({ gameId: "catapult", type: "fire", aim }).finally(() => setSending(false)));
  };

  let status: string;
  if (g.phase === "build") status = ready ? `搭好了，等其他人（${g.ready.length}/${g.order.length}）…` : "搭你的城堡：点格子叠砖，再放 3 个士兵";
  else if (animating) status = `${you(g.shot?.shooterId)}发射了！`;
  else if (g.phase === "ended")
    status = g.winnerIds.length > 1 ? `🤝 平局：${g.winnerIds.map(name).join("、")}` : g.winnerIds[0] === me ? "🏆 你赢了！" : `🏆 ${name(g.winnerIds[0])} 获胜`;
  else if (myTurn) status = "轮到你：调好方向、仰角、力度，发射！";
  else status = `等 ${name(g.currentPlayerId)} 发射…`;

  return (
    <>
      <FxLayer fx={fx} shards={SHARDS} />
      {showEnd && g.winnerIds.includes(me) && <Confetti chars={["🏯", "🎉", "⭐", "🪨"]} />}
      <section className={`cf-root ${shaking ? "fx-shake" : ""}`}>
        <div className="cf-head">
          <h2>🏯 投石大战</h2>
          <span className="cf-phase">{g.phase === "build" ? "搭建中" : g.phase === "battle" ? "对战中" : "已结束"}</span>
          <SoundToggle />
        </div>

        <ul className="cf-players">
          {g.order.map((id) => {
            const current = g.phase === "battle" && id === g.currentPlayerId;
            const out = g.phase !== "build" && (g.alive[id] ?? 0) === 0;
            return (
              <li key={id} className={`${current ? "current" : ""} ${out ? "out" : ""}`} style={{ "--pc": colors[id] } as CSSProperties}>
                <span className="cf-dot" />
                {name(id)}
                {id === me && "（我）"}
                {g.phase === "build" ? (
                  <span>{g.ready.includes(id) ? "✅" : "🔨"}</span>
                ) : (
                  <>
                    <span className="cf-alive">{out ? "🏳️" : "💂".repeat(g.alive[id] ?? 0)}</span>
                    <small>
                      {g.shots[id] ?? 0}/{CF_MAX_SHOTS}
                    </small>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <div className={`cf-stage ${g.phase === "build" ? "building" : ""} ${canFire ? "my-turn" : ""}`} ref={stage}>
          {webglError && <p className="cf-fallback">你的浏览器不支持 WebGL，没法显示 3D 场景 😢</p>}
        </div>

        <p className={showEnd ? "big cf-end-text" : "hint cf-status"}>{status}</p>

        {g.phase === "build" && (
          <>
            <Builder draft={draft} onChange={setDraft} locked={ready} />
            {ready ? (
              <button type="button" className="secondary" onClick={() => run(actions.act({ gameId: "catapult", type: "unready" }))}>
                ✏️ 再改改
              </button>
            ) : (
              <button type="button" className="cf-fire" onClick={submit}>
                ✅ 城堡搭好了
              </button>
            )}
          </>
        )}

        {canFire && (
          <div className="cf-aim">
            <Slider
              label="方向"
              value={aim.yaw}
              min={-CF_YAW_RANGE}
              max={CF_YAW_RANGE}
              format={(v) => (v === 0 ? "正前方" : v < 0 ? `左 ${-v}°` : `右 ${v}°`)}
              onChange={(yaw) => setAim({ ...aim, yaw })}
            />
            <Slider
              label="仰角"
              value={aim.pitch}
              min={CF_PITCH_MIN}
              max={CF_PITCH_MAX}
              format={(v) => `${v}°`}
              onChange={(pitch) => setAim({ ...aim, pitch })}
            />
            <Slider
              label="力度"
              value={aim.power}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(power) => setAim({ ...aim, power })}
            />
            <button type="button" className="cf-fire" onClick={fire}>
              🔥 发射！
            </button>
          </div>
        )}

        {showEnd && (
          <ol className="cf-result">
            {[...g.order]
              .sort((a, b) => (g.alive[b] ?? 0) - (g.alive[a] ?? 0) || (g.kills[b] ?? 0) - (g.kills[a] ?? 0))
              .map((id) => (
                <li key={id} className={g.winnerIds.includes(id) ? "winner" : ""}>
                  {name(id)}：剩 {g.alive[id] ?? 0} 个士兵，砸倒敌人 {g.kills[id] ?? 0} 个
                </li>
              ))}
          </ol>
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
