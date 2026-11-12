import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { GameMeta } from "@party/shared";

function hue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

/** 房间里每个玩家的头像地址（玩家 id → 图片地址），各游戏里的 Avatar 按 seed 自动取到 */
export const AvatarContext = createContext<ReadonlyMap<string, string>>(new Map());

/** 有上传头像就显示图片，否则用昵称首字 + 由 id 算出的固定颜色 */
export function Avatar({ name, seed, size = 32, src }: { name: string; seed: string; size?: number; src?: string | null }) {
  const fromRoom = useContext(AvatarContext).get(seed);
  const url = src ?? fromRoom;
  const [failed, setFailed] = useState<string | null>(null);
  const first = [...(name.trim() || "?")][0];
  if (url && failed !== url) {
    return (
      <img className="avatar" src={url} alt="" style={{ width: size, height: size }} onError={() => setFailed(url)} aria-hidden />
    );
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${hue(seed)} 65% 55%)` }}
      aria-hidden
    >
      {first}
    </span>
  );
}

/** 从底部弹出的面板，点背景或按 Esc 关闭 */
export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export function GameCard({
  meta,
  onClick,
  selected,
  isNew,
}: {
  meta: GameMeta;
  onClick: () => void;
  selected?: boolean;
  isNew?: boolean;
}) {
  return (
    <button
      type="button"
      className={`game-card ${selected ? "selected" : ""}`}
      style={{ "--c": meta.color } as CSSProperties}
      onClick={onClick}
    >
      {(isNew || meta.original) && (
        <span className="game-card-badges">
          {meta.original && <span className="game-card-original">原创</span>}
          {isNew && <span className="game-card-new">NEW</span>}
        </span>
      )}
      <span className="game-card-emoji">{meta.emoji}</span>
      <span className="game-card-name">{meta.name}</span>
      <span className="game-card-tagline">{meta.tagline}</span>
      <span className="game-card-meta">
        👥 {meta.minPlayers}~{meta.maxPlayers} 人 · ⏱ {meta.duration}
      </span>
    </button>
  );
}

export function GameDetail({ meta }: { meta: GameMeta }) {
  return (
    <div className="game-detail" style={{ "--c": meta.color } as CSSProperties}>
      <div className="game-detail-head">
        <span className="game-detail-emoji">{meta.emoji}</span>
        <div>
          <h2>
            {meta.name}
            {meta.original && <span className="game-detail-original">原创</span>}
          </h2>
          <div className="game-detail-meta">
            👥 {meta.minPlayers}~{meta.maxPlayers} 人 · ⏱ {meta.duration}
          </div>
        </div>
      </div>
      <div className="tags">
        {meta.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
      <p className="game-detail-desc">{meta.description}</p>
      <h3>怎么玩</h3>
      <ol className="rules-list">
        {meta.rules.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ol>
    </div>
  );
}

const ADJECTIVES = ["快乐的", "机智的", "害羞的", "勇敢的", "迷糊的", "暴躁的", "佛系的", "神秘的", "爱笑的", "倔强的"];
const NOUNS = ["小熊", "企鹅", "柯基", "仓鼠", "狐狸", "考拉", "海豹", "橘猫", "河豚", "羊驼"];

export function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)]!;
  return pick(ADJECTIVES) + pick(NOUNS);
}
