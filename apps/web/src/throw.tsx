import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PROP_ITEMS, canThrowProps, type PropItem, type PropThrow, type RoomView } from "@party/shared";
import { onThrow, throwProp } from "./party";
import { sfx, vibrate } from "./sound";
import { nameOf } from "./ui";
import "./throw.css";

/**
 * 扔道具：PROP_THROWERS 里的玩家打开“道具模式”后，点别人的头像选个道具扔过去。
 * 房间里所有人都能看到道具从扔的人飞到被砸的人头像上，被砸的人整个屏幕都会被糊一下。
 * 纯娱乐，不影响任何游戏状态。
 */

interface PropDef {
  emoji: string;
  name: string;
  /** 砸中时头像上冒出来的字 */
  hitText: string;
  /** 溅出来的小颗粒 */
  bits: string[];
  /** 飞行时转不转（水桶不转，倒着泼） */
  spin: boolean;
  sound: () => void;
  vibrate: number | number[];
}

const PROPS: Record<PropItem, PropDef> = {
  tomato: { emoji: "🍅", name: "西红柿", hitText: "啪叽！", bits: ["🔴", "💦", "🍅"], spin: true, sound: sfx.splat, vibrate: [60, 30, 40] },
  egg: { emoji: "🥚", name: "鸡蛋", hitText: "咔嚓！", bits: ["🟡", "⚪", "🍳"], spin: true, sound: sfx.eggCrack, vibrate: [30, 20, 60] },
  bucket: { emoji: "🪣", name: "一桶水", hitText: "哗啦！", bits: ["💧", "💦", "🫧"], spin: false, sound: sfx.waterSplash, vibrate: [120, 40, 120] },
  slipper: { emoji: "🩴", name: "拖鞋", hitText: "啪！", bits: ["⭐", "💫", "✨"], spin: true, sound: sfx.slap, vibrate: 80 },
  flower: { emoji: "💐", name: "鲜花", hitText: "爱你～", bits: ["🌸", "💖", "🌷"], spin: false, sound: sfx.bloom, vibrate: 0 },
};

const FLIGHT_MS = 650;
const HIT_MS = 2400;
const SCREEN_MS = 2800;

type Point = { x: number; y: number };

/** 在屏幕上找到某个玩家的头像（同一个人可能出现多次，取第一个看得见的） */
function findAvatar(id: string): { el: HTMLElement; rect: DOMRect } | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-avatar-seed="${CSS.escape(id)}"]`)) {
    if (el.closest(".throw-layer")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth) {
      return { el, rect };
    }
  }
  return null;
}

const center = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

interface Flight {
  id: number;
  item: PropItem;
  from: Point;
  to: Point;
  target: string;
  thrower: string;
}

interface Hit {
  id: number;
  item: PropItem;
  at: Point;
  size: number;
}

interface ScreenHit {
  id: number;
  item: PropItem;
  from: string;
}

export function ThrowLayer({ room, me, allowArm }: { room: RoomView; me: string; allowArm: boolean }) {
  const myName = room.players.find((p) => p.id === me)?.name ?? "";
  const canThrow = canThrowProps(myName);
  const [armed, setArmed] = useState(false);
  const [picker, setPicker] = useState<{ target: string; at: Point } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [screen, setScreen] = useState<ScreenHit | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const nextId = useRef(0);
  const roomRef = useRef(room);
  roomRef.current = room;

  const disarm = useCallback(() => {
    setArmed(false);
    setPicker(null);
    setHint(null);
  }, []);

  // 道具模式只在有权限、界面允许时可用；条件变了自动收起
  useEffect(() => {
    if (!canThrow || !allowArm) disarm();
  }, [canThrow, allowArm, disarm]);

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && disarm();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, disarm]);

  /** 道具落到目标身上：头像上溅一下；如果砸的是我，整个屏幕糊一下 */
  const land = useCallback(
    (item: PropItem, target: string, from: string) => {
      const def = PROPS[item];
      def.sound();
      const found = findAvatar(target);
      if (found) {
        const id = ++nextId.current;
        setHits((h) => [...h, { id, item, at: center(found.rect), size: Math.max(found.rect.width, 28) }]);
        setTimeout(() => setHits((h) => h.filter((x) => x.id !== id)), HIT_MS);
        found.el.animate(
          [
            { transform: "none" },
            { transform: "translateX(-5px) rotate(-10deg) scale(0.9)" },
            { transform: "translateX(5px) rotate(8deg)" },
            { transform: "translateX(-3px) rotate(-4deg)" },
            { transform: "none" },
          ],
          { duration: 450, easing: "ease-out" },
        );
      }
      if (target === me) {
        if (def.vibrate) vibrate(def.vibrate);
        setScreen({ id: ++nextId.current, item, from });
      }
    },
    [me],
  );

  // 收到服务端广播：算出起点终点，开始飞
  useEffect(
    () =>
      onThrow((t: PropThrow) => {
        const r = roomRef.current;
        const def = PROPS[t.item];
        if (!def) return;
        const fromName = nameOf(r, t.from);
        const toName = t.to === me ? "你" : nameOf(r, t.to);
        setToast({ id: ++nextId.current, text: `${def.emoji} ${fromName} 朝 ${toName} 扔了${def.name}` });

        const target = findAvatar(t.to);
        sfx.whoosh();
        if (!target) {
          // 看不到被砸的人的头像（比如在 3D 游戏里），只在 Ta 自己的屏幕上糊一下
          setTimeout(() => land(t.item, t.to, t.from), FLIGHT_MS);
          return;
        }
        const src = findAvatar(t.from);
        const from = src
          ? center(src.rect)
          : t.from === me
            ? { x: innerWidth / 2, y: innerHeight - 40 }
            : { x: innerWidth / 2, y: -40 };
        setFlights((f) => [
          ...f,
          { id: ++nextId.current, item: t.item, from, to: center(target.rect), target: t.to, thrower: t.from },
        ]);
      }),
    [me, land],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!screen) return;
    const t = setTimeout(() => setScreen(null), SCREEN_MS);
    return () => clearTimeout(t);
  }, [screen]);

  const onFlightDone = useCallback(
    (f: Flight) => {
      setFlights((list) => list.filter((x) => x.id !== f.id));
      land(f.item, f.target, f.thrower);
    },
    [land],
  );

  /** 道具模式下点屏幕：看手指下面有没有别人的头像 */
  const pickTarget = (e: React.MouseEvent) => {
    const ids = new Set(roomRef.current.players.map((p) => p.id));
    const el = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((n): n is HTMLElement => n instanceof HTMLElement && !!n.dataset.avatarSeed && !n.closest(".throw-layer"));
    const id = el?.dataset.avatarSeed;
    if (!id || !ids.has(id)) {
      setPicker(null);
      setHint("点别人的头像才能扔哦");
      return;
    }
    if (id === me) {
      setPicker(null);
      setHint("不能砸自己 😂");
      return;
    }
    setHint(null);
    setPicker({ target: id, at: { x: e.clientX, y: e.clientY } });
  };

  const fire = (item: PropItem) => {
    if (!picker) return;
    const target = picker.target;
    setPicker(null);
    throwProp(target, item).catch((err: Error) => setHint(err.message));
  };

  return (
    <div className="throw-layer">
      {armed && (
        <>
          {/* 头像高亮：除了自己以外的头像都闪一闪 */}
          <style>{`[data-avatar-seed]:not([data-avatar-seed="${CSS.escape(me)}"]){outline:3px solid #ff5470;outline-offset:2px;animation:throw-pulse 0.9s ease-in-out infinite}`}</style>
          <div className="throw-catcher" onClick={pickTarget} />
          <div className="throw-banner">{hint ?? "🎯 点别人的头像扔道具"}</div>
        </>
      )}

      {picker && <Picker target={nameOf(room, picker.target)} at={picker.at} onPick={fire} />}

      {canThrow && allowArm && (
        <button
          type="button"
          className={`throw-toggle ${armed ? "armed" : ""}`}
          title={armed ? "收起道具" : "扔道具"}
          onClick={() => (armed ? disarm() : setArmed(true))}
        >
          {armed ? "✕" : "🍅"}
        </button>
      )}

      {flights.map((f) => (
        <FlyingProp key={f.id} flight={f} onDone={onFlightDone} />
      ))}
      {hits.map((h) => (
        <HitSplat key={h.id} hit={h} />
      ))}
      {screen && <ScreenSplat key={screen.id} item={screen.item} from={nameOf(room, screen.from)} />}
      {toast && (
        <div className="throw-toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Picker({ target, at, onPick }: { target: string; at: Point; onPick: (item: PropItem) => void }) {
  const width = 300;
  const left = Math.min(Math.max(8, at.x - width / 2), innerWidth - width - 8);
  // 点的位置靠下时，面板放在手指上方
  const top = at.y > innerHeight - 150 ? at.y - 120 : at.y + 24;
  return (
    <div className="throw-picker" style={{ left, top, width }} onClick={(e) => e.stopPropagation()}>
      <div className="throw-picker-title">扔给 {target}</div>
      <div className="throw-picker-items">
        {PROP_ITEMS.map((item) => (
          <button key={item} type="button" onClick={() => onPick(item)}>
            <span className="throw-picker-emoji">{PROPS[item].emoji}</span>
            <span className="throw-picker-name">{PROPS[item].name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 一条抛物线飞过去 */
function FlyingProp({ flight, onDone }: { flight: Flight; onDone: (f: Flight) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { from, to } = flight;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const arc = Math.min(220, 60 + dist * 0.35);
    const spin = PROPS[flight.item].spin;
    const dir = to.x >= from.x ? 1 : -1;
    const steps = 16;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t - arc * 4 * t * (1 - t);
      const rot = spin ? dir * 540 * t : dir * (-20 + 140 * t); // 水桶在快到的时候倒扣过去
      const scale = 1 + 0.5 * Math.sin(Math.PI * t);
      frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${scale})` });
    }
    const anim = el.animate(frames, { duration: FLIGHT_MS, easing: "linear", fill: "forwards" });
    anim.onfinish = () => done.current(flight);
    return () => {
      anim.onfinish = null;
      anim.cancel();
    };
  }, [flight]);

  return (
    <span ref={ref} className="throw-flying">
      {PROPS[flight.item].emoji}
    </span>
  );
}

function useBits(chars: string[], n: number, spread: number) {
  return useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const angle = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const d = spread * (0.6 + Math.random() * 0.6);
        return {
          char: chars[i % chars.length],
          style: {
            "--dx": `${Math.cos(angle) * d}px`,
            "--dy": `${Math.sin(angle) * d}px`,
            animationDelay: `${Math.random() * 0.08}s`,
          } as CSSProperties,
        };
      }),
    [chars, n, spread],
  );
}

/** 砸在头像上：一摊颜色 + 溅出来的小颗粒 + 拟声字 */
function HitSplat({ hit }: { hit: Hit }) {
  const def = PROPS[hit.item];
  const bits = useBits(def.bits, 10, Math.max(50, hit.size * 1.4));
  const size = Math.max(56, hit.size * 1.9);
  return (
    <div
      className={`throw-hit throw-hit-${hit.item}`}
      style={{ left: hit.at.x, top: hit.at.y, "--s": `${size}px` } as CSSProperties}
    >
      <span className="throw-stain" />
      {bits.map((b, i) => (
        <span key={i} className="throw-bit" style={b.style}>
          {b.char}
        </span>
      ))}
      <span className="throw-hit-text">{def.hitText}</span>
    </div>
  );
}

/** 砸的是我：整个屏幕糊上 */
function ScreenSplat({ item, from }: { item: PropItem; from: string }) {
  const def = PROPS[item];
  const blobs = useMemo(
    () =>
      Array.from({ length: item === "tomato" || item === "egg" ? 6 : 0 }, () => ({
        left: `${10 + Math.random() * 80}%`,
        top: `${10 + Math.random() * 70}%`,
        "--s": `${90 + Math.random() * 120}px`,
        "--r": `${Math.random() * 360}deg`,
        animationDelay: `${Math.random() * 0.15}s`,
      })) as CSSProperties[],
    [item],
  );
  const rain = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        char: def.bits[i % def.bits.length],
        style: {
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 0.6}s`,
          animationDuration: `${1.2 + Math.random() * 1.2}s`,
        } as CSSProperties,
      })),
    [def],
  );

  useEffect(() => {
    if (item === "slipper") {
      document.body.animate(
        [
          { transform: "none" },
          { transform: "translate(-10px, 4px)" },
          { transform: "translate(8px, -6px)" },
          { transform: "translate(-5px, 3px)" },
          { transform: "none" },
        ],
        { duration: 420, easing: "ease-out" },
      );
    }
  }, [item]);

  return (
    <div className={`throw-screen throw-screen-${item}`}>
      {blobs.map((s, i) => (
        <span key={i} className="throw-screen-blob" style={s} />
      ))}
      {(item === "bucket" || item === "flower") &&
        rain.map((r, i) => (
          <span key={i} className="throw-screen-rain" style={r.style}>
            {r.char}
          </span>
        ))}
      {item === "slipper" && <span className="throw-screen-big">🩴💥</span>}
      <div className="throw-screen-text">
        {from} {item === "flower" ? "送了你一束花 💐" : `朝你扔了${def.name}！`}
      </div>
    </div>
  );
}
