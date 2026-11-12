import { useEffect, useRef, useState } from "react";
import { SoundToggle } from "../fx";
import { getBest, saveBest } from "./soloGames";
import { SpaceScene, type SpaceBanner, type SpaceHud, type SpacePower, type SpaceResult } from "./spaceScene";
import "./SpaceShooter.css";

const POWER_LABEL: Record<SpacePower, string> = { spread: "🟡 散射", rapid: "🟣 急速", shield: "🔵 护盾" };

type Phase = "ready" | "playing" | "paused" | "over";

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function SpaceShooter({ onExit }: { onExit: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState<SpaceHud | null>(null);
  const [banner, setBanner] = useState<(SpaceBanner & { id: number }) | null>(null);
  const [result, setResult] = useState<(SpaceResult & { record: boolean }) | null>(null);
  const [best, setBest] = useState(() => getBest("spaceShooter"));
  const [webglError, setWebglError] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let scene: SpaceScene;
    let bannerId = 0;
    try {
      scene = new SpaceScene(mount.current!, {
        onHud: setHud,
        onBanner: (b) => setBanner({ ...b, id: ++bannerId }),
        onGameOver: (r) => {
          const record = saveBest("spaceShooter", r.score);
          setBest(getBest("spaceShooter"));
          setResult({ ...r, record });
          setPhase("over");
        },
      });
    } catch {
      setWebglError(true);
      return;
    }
    sceneRef.current = scene;

    // 切到后台或锁屏时自动暂停
    const onHidden = () => {
      if (document.hidden && phaseRef.current === "playing") {
        scene.setPaused(true);
        setPhase("paused");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "p") return;
      if (phaseRef.current === "playing") {
        scene.setPaused(true);
        setPhase("paused");
      } else if (phaseRef.current === "paused") {
        scene.setPaused(false);
        setPhase("playing");
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), banner.kind === "boss" ? 2600 : 1600);
    return () => clearTimeout(t);
  }, [banner]);

  const start = () => {
    setResult(null);
    setHud(null);
    setPhase("playing");
    sceneRef.current?.start();
  };
  const pause = () => {
    sceneRef.current?.setPaused(true);
    setPhase("paused");
  };
  const resume = () => {
    sceneRef.current?.setPaused(false);
    setPhase("playing");
  };

  return (
    <div className="ss-root">
      <div className="ss-stage" ref={mount} />
      {webglError && <p className="ss-error">你的浏览器不支持 WebGL，没法显示 3D 画面 😢</p>}

      {phase === "playing" && hud && (
        <div className="ss-hud">
          <div className="ss-hud-top">
            <div className="ss-hp" aria-label={`装甲 ${hud.hp}/${hud.maxHp}`}>
              {Array.from({ length: hud.maxHp }, (_, i) => (
                <span key={i} className={i < hud.hp ? "on" : "off"}>
                  ◆
                </span>
              ))}
            </div>
            <div className="ss-score">
              {hud.score.toLocaleString()}
              {hud.mult > 1 && (
                <span key={hud.mult} className="ss-mult">
                  ×{hud.mult}
                </span>
              )}
            </div>
            <button type="button" className="ss-icon" onClick={pause} aria-label="暂停">
              ❚❚
            </button>
          </div>
          <div className="ss-wave">WAVE {hud.wave}</div>
          {hud.boss && (
            <div className="ss-boss">
              <span>巨型战舰</span>
              <div className="ss-boss-bar">
                <div style={{ width: `${(hud.boss.hp / hud.boss.max) * 100}%` }} />
              </div>
            </div>
          )}
          {hud.powers.length > 0 && (
            <div className="ss-powers">
              {hud.powers.map((p) => (
                <span key={p.kind} className={`ss-power p-${p.kind}`}>
                  {POWER_LABEL[p.kind]}
                  <i style={{ width: `${(p.left / p.total) * 100}%` }} />
                </span>
              ))}
            </div>
          )}
          {hud.hp === 1 && <div className="ss-danger" />}
        </div>
      )}

      {banner && phase === "playing" && (
        <div key={banner.id} className={`ss-banner ${banner.kind}`}>
          {banner.text}
        </div>
      )}

      {phase === "ready" && (
        <div className="ss-overlay">
          <div className="ss-corner">
            <SoundToggle />
          </div>
          <h1 className="ss-title">星际穿梭</h1>
          <p className="ss-sub">SPACE RUN</p>
          <ul className="ss-help">
            <li>👆 按住屏幕任意位置拖动飞船（电脑上用方向键 / WASD）</li>
            <li>🔫 自动开火：打碎陨石、击落飞碟，连续击杀分数翻倍</li>
            <li>💎 能量块：🟢 修复 · 🔵 护盾 · 🟡 散射 · 🟣 急速</li>
            <li>👾 每撑过 45 秒，巨型战舰来袭</li>
          </ul>
          {best > 0 && <p className="ss-best">🏆 最高分 {best.toLocaleString()}</p>}
          <button type="button" className="ss-btn" onClick={start}>
            🚀 起飞
          </button>
          <button type="button" className="ss-btn ghost" onClick={onExit}>
            返回首页
          </button>
        </div>
      )}

      {phase === "paused" && (
        <div className="ss-overlay">
          <div className="ss-corner">
            <SoundToggle />
          </div>
          <h2 className="ss-title small">已暂停</h2>
          <button type="button" className="ss-btn" onClick={resume}>
            ▶ 继续
          </button>
          <button type="button" className="ss-btn ghost" onClick={onExit}>
            结束并返回首页
          </button>
        </div>
      )}

      {phase === "over" && result && (
        <div className="ss-overlay">
          <h2 className="ss-title small">飞船被击毁</h2>
          <div className="ss-final">{result.score.toLocaleString()}</div>
          {result.record ? <p className="ss-record">🎉 新纪录！</p> : <p className="ss-best">🏆 最高分 {best.toLocaleString()}</p>}
          <div className="ss-stats">
            <span>
              <b>{result.wave}</b>波次
            </span>
            <span>
              <b>{result.kills}</b>击毁
            </span>
            <span>
              <b>{formatTime(result.seconds)}</b>存活
            </span>
          </div>
          <button type="button" className="ss-btn" onClick={start}>
            🔁 再来一局
          </button>
          <button type="button" className="ss-btn ghost" onClick={onExit}>
            返回首页
          </button>
        </div>
      )}
    </div>
  );
}
