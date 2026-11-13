import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AVALON_ROLES, GAMES, WEREWOLF_ROLES, type GameView, type RoomView } from "@party/shared";
import { Avatar } from "./components";
import { sfx, vibrate } from "./sound";
import { nameOf } from "./ui";
import "./victory.css";

/**
 * 所有多人游戏共用的胜利结算动画：一局刚结束时盖在游戏上面放一段。
 * 鼓点 → 闪光 → 标题和获胜者头像落下、戴上皇冠 → 烟花 + 号角。点一下或 8 秒后收起，露出游戏自己的结算界面。
 * 只在亲眼看到“进行中 → 结束”时播放，刷新页面、中途重连回来不会重播。
 */

/** 先让游戏自己的结局（爆炸、开枪、翻牌）演完 */
const START_DELAY_MS = 1800;
/** 鼓点长度，之后揭晓 */
const REVEAL_MS = 1100;
const AUTO_CLOSE_MS = 8500;

type Theme = "gold" | "evil" | "team";

interface Ceremony {
  winners: string[];
  /** 大标题，例如 “叮当 获胜！”、“狼人阵营胜利！” */
  title: string;
  sub?: string;
  theme: Theme;
}

const others = (room: RoomView, loserId: string | null) => room.players.map((p) => p.id).filter((id) => id !== loserId);

function teamOf<R extends string>(reveal: Record<string, R> | null, teamOfRole: (r: R) => string, team: string): string[] {
  return reveal ? Object.entries(reveal).filter(([, r]) => teamOfRole(r as R) === team).map(([id]) => id) : [];
}

/** 从各个游戏的结束视图里找出谁赢了 */
function ceremonyFor(g: GameView, room: RoomView): Ceremony | null {
  const name = (id: string | null | undefined) => nameOf(room, id);
  let c: Ceremony;
  switch (g.gameId) {
    case "numberBomb":
      c = { winners: others(room, g.loserId), title: "躲过炸弹！", sub: g.loserId ? `💣 ${name(g.loserId)} 踩中了炸弹` : undefined, theme: "team" };
      break;
    case "jenga":
      c = { winners: others(room, g.loserId), title: "稳如泰山！", sub: g.loserId ? `🧱 ${name(g.loserId)} 推倒了塔` : undefined, theme: "team" };
      break;
    case "bombCat":
    case "liarsBar":
    case "uno":
    case "holdem":
      c = { winners: g.winnerId ? [g.winnerId] : [], title: "", theme: "gold" };
      break;
    case "catapult":
    case "icecool":
      c = { winners: g.winnerIds, title: g.winnerIds.length > 1 ? "并列第一！" : "", theme: "gold" };
      break;
    case "moyu":
      c = {
        winners: g.result?.winners ?? [],
        title: g.result?.outcome === "bossDown" ? "老板被打跑了！" : "准点下班！",
        sub: "🐟 摸鱼成功的打工人",
        theme: "team",
      };
      break;
    case "midway":
      c = {
        winners: Object.entries(g.result?.outcomes ?? {}).filter(([, o]) => o.won).map(([id]) => id),
        title: "",
        theme: "gold",
      };
      break;
    case "avalon":
      c = {
        winners: teamOf(g.reveal, (r) => AVALON_ROLES[r].team, g.winner ?? ""),
        title: g.winner === "evil" ? "邪恶阵营胜利！" : "正义阵营胜利！",
        theme: g.winner === "evil" ? "evil" : "team",
      };
      break;
    case "werewolf":
      c = {
        winners: teamOf(g.reveal, (r) => WEREWOLF_ROLES[r].team, g.winner ?? ""),
        title: g.winner === "wolf" ? "狼人阵营胜利！" : "好人阵营胜利！",
        theme: g.winner === "wolf" ? "evil" : "team",
      };
      break;
    case "undercover":
      c = {
        winners: teamOf(g.reveal?.roles ?? null, (r) => r, g.winner ?? ""),
        title: g.winner === "undercover" ? "卧底胜利！" : "平民胜利！",
        sub: g.reveal ? `平民词「${g.reveal.civilianWord}」· 卧底词「${g.reveal.undercoverWord}」` : undefined,
        theme: g.winner === "undercover" ? "evil" : "team",
      };
      break;
    case "quest":
      c = { winners: g.order, title: "全员通关！", sub: "⛩ 秘境已被征服", theme: "team" };
      break;
    default:
      return null;
  }
  // 中途退出的人不上台
  const winners = c.winners.filter((id) => room.players.some((p) => p.id === id));
  if (!winners.length) return null;
  const title = c.title || (winners.length === 1 ? `${name(winners[0])} 获胜！` : "获胜！");
  return { ...c, winners, title };
}

export function Victory({ room, me }: { room: RoomView; me: string }) {
  const phase = room.game?.phase ?? null;
  const prev = useRef(phase);
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [stage, setStage] = useState<"roll" | "reveal" | null>(null);
  const [closable, setClosable] = useState(false);
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    const was = prev.current;
    prev.current = phase;
    if (phase !== "ended" || was === null || was === "ended") return;
    const t = setTimeout(() => {
      const r = roomRef.current;
      const c = r.game?.phase === "ended" ? ceremonyFor(r.game, r) : null;
      if (c) setCeremony(c);
    }, START_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // 回到大厅时立刻收起
  useEffect(() => {
    if (!room.game) setCeremony(null);
  }, [room.game]);

  useEffect(() => {
    if (!ceremony) {
      setStage(null);
      setClosable(false);
      return;
    }
    setStage("roll");
    sfx.drumRoll(REVEAL_MS / 1000);
    const timers = [
      setTimeout(() => {
        setStage("reveal");
        sfx.fanfare();
        if (ceremony.winners.includes(me)) vibrate([80, 60, 80, 60, 200]);
      }, REVEAL_MS),
      setTimeout(() => setClosable(true), REVEAL_MS + 1500),
      setTimeout(() => setCeremony(null), AUTO_CLOSE_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [ceremony, me]);

  if (!ceremony || !stage) return null;
  const won = ceremony.winners.includes(me);
  const meta = room.game ? GAMES[room.game.gameId] : null;
  const n = ceremony.winners.length;
  const size = n === 1 ? 112 : n <= 3 ? 80 : n <= 6 ? 60 : 46;

  return (
    <div
      className={`victory victory-${ceremony.theme} is-${stage}`}
      role="dialog"
      aria-label="本局结算"
      onClick={() => closable && setCeremony(null)}
    >
      <div className="victory-rays" />
      {stage === "reveal" && <Fireworks theme={ceremony.theme} />}
      {stage === "reveal" && <div className="victory-flash" />}

      {stage === "roll" ? (
        <div className="victory-roll">
          <span>{meta?.emoji}</span>
          <span>最终结果</span>
        </div>
      ) : (
        <div className="victory-stage">
          {meta && (
            <div className="victory-game">
              {meta.emoji} {meta.name}
            </div>
          )}
          <h1 className="victory-title">
            {[...ceremony.title].map((ch, i) => (
              <span key={i} style={{ animationDelay: `${0.15 + i * 0.05}s` }}>
                {ch}
              </span>
            ))}
          </h1>
          <ul className={`victory-winners ${n === 1 ? "solo" : ""}`}>
            {ceremony.winners.map((id, i) => (
              <li key={id} style={{ "--d": `${0.45 + i * 0.12}s`, "--size": `${size}px` } as CSSProperties}>
                <span className="victory-crown">👑</span>
                <span className="victory-ring">
                  <Avatar name={nameOf(room, id)} seed={id} size={size} />
                </span>
                <span className="victory-name">
                  {nameOf(room, id)}
                  {id === me && "（我）"}
                </span>
              </li>
            ))}
          </ul>
          {n === 1 && <div className="victory-podium">1</div>}
          {ceremony.sub && <p className="victory-sub">{ceremony.sub}</p>}
          <div className={`victory-me ${won ? "won" : ""}`}>{won ? "🎉 你赢了！" : "下局再接再厉 💪"}</div>
          <p className={`victory-hint ${closable ? "show" : ""}`}>点任意处继续</p>
        </div>
      )}
    </div>
  );
}

const PALETTES: Record<Theme, string[]> = {
  gold: ["#ffd84d", "#ffb400", "#fff3b0", "#ff8a3d", "#ffffff"],
  team: ["#ffd84d", "#4dd8ff", "#7cff8a", "#ff6bd5", "#ffffff"],
  evil: ["#ff3355", "#ff8a3d", "#b04dff", "#ffd84d", "#ffffff"],
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  /** 0 = 烟花火星，1 = 彩带纸片 */
  kind: 0 | 1;
  rot: number;
  vr: number;
}

/** 画布烟花 + 彩带。用 lighter 叠加，火星拖尾 */
function Fireworks({ theme }: { theme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const palette = PALETTES[theme];
  const reduced = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const parts: Particle[] = [];
    const pick = () => palette[Math.floor(Math.random() * palette.length)]!;
    const burst = (x: number, y: number, count: number) => {
      const color = pick();
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 5.5;
        parts.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 50 + Math.random() * 40,
          color: Math.random() < 0.8 ? color : "#fff", size: 1.5 + Math.random() * 2, kind: 0, rot: 0, vr: 0,
        });
      }
    };
    const confetti = (count: number) => {
      for (let i = 0; i < count; i++) {
        parts.push({
          x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
          vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 2.5, life: 0, max: 400,
          color: pick(), size: 5 + Math.random() * 6, kind: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        });
      }
    };

    const scale = reduced ? 0.3 : 1;
    // 揭晓瞬间：头像两侧各炸一朵，再撒一大把彩带
    burst(innerWidth * 0.22, innerHeight * 0.3, 90 * scale);
    burst(innerWidth * 0.78, innerHeight * 0.3, 90 * scale);
    confetti(120 * scale);
    sfx.firework(0);

    let shots = 0;
    const timer = setInterval(() => {
      if (shots++ > 7) return;
      burst(innerWidth * (0.1 + Math.random() * 0.8), innerHeight * (0.1 + Math.random() * 0.35), 70 * scale);
      if (shots % 2) sfx.firework(0);
      if (shots % 3 === 0) confetti(30 * scale);
    }, 650);

    let raf = 0;
    const frame = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        p.life++;
        if (p.life > p.max || p.y > innerHeight + 30) {
          parts.splice(i, 1);
          continue;
        }
        if (p.kind === 0) {
          const px = p.x;
          const py = p.y;
          p.vx *= 0.96;
          p.vy = p.vy * 0.96 + 0.08;
          p.x += p.vx;
          p.y += p.vy;
          const alpha = 1 - p.life / p.max;
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(px - p.vx * 2, py - p.vy * 2);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else {
          p.x += p.vx + Math.sin((p.life + p.rot * 20) / 18) * 0.8;
          p.y += p.vy;
          p.rot += p.vr;
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          // 纸片翻转：宽度随时间变化，看起来像在空中翻
          ctx.scale(Math.cos(p.life / 6 + p.rot), 1);
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      window.removeEventListener("resize", resize);
    };
  }, [palette, reduced]);

  return <canvas ref={ref} className="victory-canvas" aria-hidden />;
}
