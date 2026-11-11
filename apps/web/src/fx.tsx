import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { isMuted, setMuted } from "./sound";
import "./fx.css";

/** 各个游戏共用的全屏特效：爆炸、成功、顶部提示、彩带、屏幕震动 */

export type Fx = { id: number; kind: "explode" | "success" | "toast"; icon: string; text: string; sub?: string };

export function useFx() {
  const [fx, setFx] = useState<Fx | null>(null);
  const [shaking, setShaking] = useState(false);
  const nextId = useRef(0);

  const show = useCallback((f: Omit<Fx, "id">) => setFx({ ...f, id: ++nextId.current }), []);
  const shake = useCallback(() => setShaking(true), []);

  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShaking(false), 600);
    return () => clearTimeout(t);
  }, [shaking]);

  useEffect(() => {
    if (!fx) return;
    const t = setTimeout(() => setFx(null), fx.kind === "toast" ? 1800 : 2200);
    return () => clearTimeout(t);
  }, [fx]);

  return { fx, show, shaking, shake };
}

function ExplosionShards({ chars }: { chars: string[] }) {
  const shards = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const dist = 140 + Math.random() * 120;
        return {
          char: chars[i % chars.length],
          style: {
            "--dx": `${Math.cos(angle) * dist}px`,
            "--dy": `${Math.sin(angle) * dist}px`,
            animationDelay: `${Math.random() * 0.1}s`,
          } as CSSProperties,
        };
      }),
    [chars],
  );
  return (
    <>
      {shards.map((s, i) => (
        <span key={i} className="fx-shard" style={s.style}>
          {s.char}
        </span>
      ))}
    </>
  );
}

const DEFAULT_SHARDS = ["🔥", "💥", "✨"];

export function FxLayer({ fx, shards = DEFAULT_SHARDS }: { fx: Fx | null; shards?: string[] }) {
  if (!fx) return null;
  if (fx.kind === "toast") {
    return (
      <div className="fx fx-toast" key={fx.id}>
        <div className="fx-toast-pill">
          {fx.icon} {fx.text}
        </div>
      </div>
    );
  }
  return (
    <div className={`fx fx-${fx.kind}`} key={fx.id}>
      {fx.kind === "explode" && <ExplosionShards chars={shards} />}
      <div className="fx-icon">{fx.icon}</div>
      <div className="fx-text">{fx.text}</div>
      {fx.sub && <div className="fx-sub">{fx.sub}</div>}
    </div>
  );
}

/** delay：让彩带在爆炸特效之后再落下 */
export function Confetti({ chars = ["🎉", "✨", "🎊", "⭐"], delay = 0.8 }: { chars?: string[]; delay?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        char: chars[i % chars.length],
        style: {
          left: `${Math.random() * 100}%`,
          animationDelay: `${delay + Math.random()}s`,
          animationDuration: `${2.2 + Math.random() * 1.5}s`,
          "--rot": `${Math.random() * 720 - 360}deg`,
        } as CSSProperties,
      })),
    [chars, delay],
  );
  return (
    <div className="fx-confetti">
      {pieces.map((p, i) => (
        <span key={i} style={p.style}>
          {p.char}
        </span>
      ))}
    </div>
  );
}

/** 音效和震动开关，设置保存在 localStorage */
export function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted());
  return (
    <button
      type="button"
      className="fx-sound"
      title={muted ? "打开音效和震动" : "关闭音效和震动"}
      onClick={() => {
        setMuted(!muted);
        setMutedState(!muted);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
