import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PROP_ITEMS, canThrowProps, type PropItem, type PropThrow, type RoomView } from "@party/shared";
import { Avatar } from "./components";
import { onThrow, throwProp } from "./party";
import { sfx, vibrate } from "./sound";
import { nameOf } from "./ui";
import "./throw.css";

/**
 * 扔道具：PROP_THROWERS 里的玩家点右下角按钮打开道具面板，选人、选道具就能扔。
 * 屏幕上有头像时也可以直接点头像选人。
 * 房间里所有人都能看到道具飞过去砸中：被砸的人头像在屏幕上就砸在头像上，
 * 不在屏幕上（很多对局界面没有头像）就临时浮出一个 Ta 的头像气泡来挨砸。
 * 被砸的人整个屏幕都会糊一下。纯娱乐，不影响任何游戏状态。
 */

interface ScreenFx {
  /** 满屏糊上几大坨，颜色在 CSS 里按道具区分 */
  blobs?: boolean;
  /** 从上往下落的小东西 */
  rain?: string[];
  /** 满屏随机盖几个大章 */
  stamps?: string;
  /** 屏幕正中一个大图 */
  big?: string;
  /** 整个页面晃一下 / 歪一下 */
  motion?: "shake" | "tilt";
}

interface PropDef {
  emoji: string;
  name: string;
  /** 送礼类的道具：提示文字用“送”而不是“扔” */
  gift?: boolean;
  /** 砸中时头像上冒出来的字 */
  hitText: string;
  /** 溅出来的小颗粒 */
  bits: string[];
  /** 飞行时转不转 */
  spin: boolean;
  sound: () => void;
  vibrate: number | number[];
  screen: ScreenFx;
}

const PROPS: Record<PropItem, PropDef> = {
  tomato: {
    emoji: "🍅", name: "西红柿", hitText: "啪叽！", bits: ["🔴", "💦", "🍅"], spin: true,
    sound: sfx.splat, vibrate: [60, 30, 40], screen: { blobs: true },
  },
  egg: {
    emoji: "🥚", name: "鸡蛋", hitText: "咔嚓！", bits: ["🟡", "⚪", "🍳"], spin: true,
    sound: sfx.eggCrack, vibrate: [30, 20, 60], screen: { blobs: true },
  },
  bucket: {
    emoji: "🪣", name: "一桶水", hitText: "哗啦！", bits: ["💧", "💦", "🫧"], spin: false,
    sound: sfx.waterSplash, vibrate: [120, 40, 120], screen: { rain: ["💧", "💦", "🫧"] },
  },
  slipper: {
    emoji: "🩴", name: "拖鞋", hitText: "啪！", bits: ["⭐", "💫", "✨"], spin: true,
    sound: sfx.slap, vibrate: 80, screen: { big: "🩴💥", motion: "shake" },
  },
  cake: {
    emoji: "🎂", name: "蛋糕", hitText: "糊脸！", bits: ["🍰", "⚪", "🍓"], spin: true,
    sound: sfx.cakeSplat, vibrate: [50, 30, 50], screen: { blobs: true },
  },
  watermelon: {
    emoji: "🍉", name: "西瓜", hitText: "嘭！", bits: ["🍉", "🔴", "⚫"], spin: true,
    sound: sfx.melonSmash, vibrate: [100, 30, 60], screen: { blobs: true, motion: "shake" },
  },
  firecracker: {
    emoji: "🧨", name: "鞭炮", hitText: "噼里啪啦！", bits: ["💥", "✨", "🎆"], spin: true,
    sound: sfx.crackle, vibrate: [30, 30, 30, 30, 30, 30, 60], screen: { big: "💥", rain: ["🎆", "💥", "✨", "🧧"], motion: "shake" },
  },
  ice: {
    emoji: "🧊", name: "冰块", hitText: "冻住！", bits: ["❄️", "🧊", "✨"], spin: true,
    sound: sfx.iceClink, vibrate: [20, 40, 20], screen: { rain: ["❄️", "🧊", "❄️"] },
  },
  banana: {
    emoji: "🍌", name: "香蕉皮", hitText: "滋溜～", bits: ["🍌", "💫", "⭐"], spin: true,
    sound: sfx.slip, vibrate: [40, 300, 120], screen: { big: "🍌", motion: "tilt" },
  },
  poop: {
    emoji: "💩", name: "便便", hitText: "噗！", bits: ["💩", "🟤", "🪰"], spin: true,
    sound: sfx.fart, vibrate: [60, 60, 60], screen: { blobs: true, rain: ["🪰"] },
  },
  flower: {
    emoji: "💐", name: "鲜花", gift: true, hitText: "爱你～", bits: ["🌸", "💖", "🌷"], spin: false,
    sound: sfx.bloom, vibrate: 0, screen: { rain: ["🌸", "💐", "💖", "🌷"] },
  },
  kiss: {
    emoji: "💋", name: "飞吻", gift: true, hitText: "啵～", bits: ["💋", "💕", "💗"], spin: false,
    sound: sfx.smooch, vibrate: 30, screen: { stamps: "💋" },
  },
  like: {
    emoji: "👍", name: "点赞", gift: true, hitText: "厉害！", bits: ["👍", "✨", "⭐"], spin: false,
    sound: sfx.thumbsUp, vibrate: 30, screen: { big: "👍", rain: ["👍", "✨", "⭐"] },
  },
};

const FLIGHT_MS = 650;
const HIT_MS = 2400;
const SCREEN_MS = 2800;
const GHOST_SIZE = 56;

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
  /** 落在临时头像气泡上（被砸的人头像不在屏幕上） */
  ghost: boolean;
}

interface Hit {
  id: number;
  item: PropItem;
  at: Point;
  size: number;
}

interface Ghost {
  id: number;
  playerId: string;
  at: Point;
}

interface ScreenHit {
  id: number;
  item: PropItem;
  from: string;
}

export function ThrowLayer({ room, me, allowArm }: { room: RoomView; me: string; allowArm: boolean }) {
  const myName = room.players.find((p) => p.id === me)?.name ?? "";
  const canThrow = canThrowProps(myName);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [screen, setScreen] = useState<ScreenHit | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const nextId = useRef(0);
  const roomRef = useRef(room);
  roomRef.current = room;

  const others = room.players.filter((p) => p.id !== me);
  // 选中的人离开房间了就清掉；只剩一个人可以砸时直接选上
  const validTarget = target && others.some((p) => p.id === target) ? target : others.length === 1 ? others[0]!.id : null;

  const close = useCallback(() => {
    setOpen(false);
    setHint(null);
  }, []);

  useEffect(() => {
    if (!canThrow || !allowArm) close();
  }, [canThrow, allowArm, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  /** 道具落到目标身上：头像（或临时气泡）上溅一下；如果砸的是我，整个屏幕糊一下 */
  const land = useCallback(
    (f: Pick<Flight, "item" | "target" | "thrower" | "ghost" | "to">) => {
      const def = PROPS[f.item];
      def.sound();
      const found = f.ghost ? null : findAvatar(f.target);
      const at = found ? center(found.rect) : f.to;
      const size = found ? Math.max(found.rect.width, 28) : GHOST_SIZE;
      const id = ++nextId.current;
      setHits((h) => [...h, { id, item: f.item, at, size }]);
      setTimeout(() => setHits((h) => h.filter((x) => x.id !== id)), HIT_MS);
      found?.el.animate(
        [
          { transform: "none" },
          { transform: "translateX(-5px) rotate(-10deg) scale(0.9)" },
          { transform: "translateX(5px) rotate(8deg)" },
          { transform: "translateX(-3px) rotate(-4deg)" },
          { transform: "none" },
        ],
        { duration: 450, easing: "ease-out" },
      );
      if (f.target === me) {
        if (def.vibrate) vibrate(def.vibrate);
        setScreen({ id: ++nextId.current, item: f.item, from: f.thrower });
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
        const fromName = t.from === me ? "你" : nameOf(r, t.from);
        const toName = t.to === me ? "你" : nameOf(r, t.to);
        setToast({
          id: ++nextId.current,
          text: def.gift
            ? `${def.emoji} ${fromName} 送给 ${toName} ${def.name}`
            : `${def.emoji} ${fromName} 朝 ${toName} 扔了${def.name}`,
        });
        sfx.whoosh();

        const found = findAvatar(t.to);
        let to: Point;
        if (found) {
          to = center(found.rect);
        } else {
          // 被砸的人头像不在屏幕上：浮出一个临时头像气泡来挨砸
          to = { x: innerWidth / 2, y: Math.max(140, innerHeight * 0.3) };
          const gid = ++nextId.current;
          setGhosts((g) => [...g, { id: gid, playerId: t.to, at: to }]);
          setTimeout(() => setGhosts((g) => g.filter((x) => x.id !== gid)), FLIGHT_MS + HIT_MS);
        }
        const src = findAvatar(t.from);
        const from = src
          ? center(src.rect)
          : t.from === me
            ? { x: innerWidth / 2, y: innerHeight + 30 }
            : { x: innerWidth * 0.15, y: innerHeight + 30 };
        setFlights((f) => [...f, { id: ++nextId.current, item: t.item, from, to, target: t.to, thrower: t.from, ghost: !found }]);
      }),
    [me],
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
      land(f);
    },
    [land],
  );

  /** 面板开着时点屏幕：点到别人的头像就选 Ta，点到别处就收起面板 */
  const tapScreen = (e: React.MouseEvent) => {
    const ids = new Set(roomRef.current.players.map((p) => p.id));
    const el = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((n): n is HTMLElement => n instanceof HTMLElement && !!n.dataset.avatarSeed && !n.closest(".throw-layer"));
    const id = el?.dataset.avatarSeed;
    if (!id || !ids.has(id)) {
      close();
      return;
    }
    if (id === me) {
      setHint("不能砸自己 😂");
      return;
    }
    setTarget(id);
    setHint(null);
  };

  const fire = (item: PropItem) => {
    if (!validTarget) {
      setHint("先选一个人 👆");
      return;
    }
    setHint(null);
    throwProp(validTarget, item).catch((err: Error) => setHint(err.message));
  };

  return (
    <div className="throw-layer">
      {open && (
        <>
          {/* 屏幕上别人的头像闪一闪，提示可以直接点；选中的人换成黄色 */}
          <style>{`[data-avatar-seed]:not([data-avatar-seed="${CSS.escape(me)}"]){outline:3px solid #ff5470;outline-offset:2px;animation:throw-pulse 0.9s ease-in-out infinite}${
            validTarget ? `[data-avatar-seed="${CSS.escape(validTarget)}"]{outline-color:#ffb400}` : ""
          }.throw-layer [data-avatar-seed]{outline:none!important;animation:none!important}`}</style>
          <div className="throw-catcher" onClick={tapScreen} />
          <div className="throw-panel" role="dialog" aria-label="扔道具">
            <div className="throw-panel-head">
              <span>扔给谁</span>
              <button type="button" className="throw-panel-close" onClick={close} aria-label="收起">
                ✕
              </button>
            </div>
            {others.length === 0 ? (
              <p className="throw-panel-hint">房间里还没有别人</p>
            ) : (
              <div className="throw-targets">
                {others.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`throw-target ${p.id === validTarget ? "selected" : ""}`}
                    onClick={() => {
                      setTarget(p.id);
                      setHint(null);
                    }}
                  >
                    <Avatar name={p.name} seed={p.id} src={p.avatar} size={26} />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="throw-items">
              {PROP_ITEMS.map((item) => (
                <button key={item} type="button" disabled={!validTarget} onClick={() => fire(item)}>
                  <span className="throw-item-emoji">{PROPS[item].emoji}</span>
                  <span className="throw-item-name">{PROPS[item].name}</span>
                </button>
              ))}
            </div>
            <p className="throw-panel-hint">{hint ?? "也可以直接点屏幕上的头像选人"}</p>
          </div>
        </>
      )}

      {canThrow && allowArm && !open && (
        <button type="button" className="throw-toggle" title="扔道具" onClick={() => setOpen(true)}>
          🍅
        </button>
      )}

      {ghosts.map((g) => (
        <div key={g.id} className="throw-ghost" style={{ left: g.at.x, top: g.at.y }}>
          <Avatar name={nameOf(room, g.playerId)} seed={g.playerId} size={GHOST_SIZE} />
          <span className="throw-ghost-name">{g.playerId === me ? "你" : nameOf(room, g.playerId)}</span>
        </div>
      ))}
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
      const rot = spin ? dir * 540 * t : dir * (-20 + 140 * t * t);
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

/** 砸在头像上：一摊颜色 + 溅出来的小颗粒 + 拟声字 */
function HitSplat({ hit }: { hit: Hit }) {
  const def = PROPS[hit.item];
  const spread = Math.max(50, hit.size * 1.4);
  const bits = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
        const d = spread * (0.6 + Math.random() * 0.6);
        return {
          char: def.bits[i % def.bits.length],
          style: {
            "--dx": `${Math.cos(angle) * d}px`,
            "--dy": `${Math.sin(angle) * d}px`,
            animationDelay: `${Math.random() * 0.08}s`,
          } as CSSProperties,
        };
      }),
    [def, spread],
  );
  const size = Math.max(56, hit.size * 1.9);
  return (
    <div className={`throw-hit throw-hit-${hit.item}`} style={{ left: hit.at.x, top: hit.at.y, "--s": `${size}px` } as CSSProperties}>
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
  const fx = def.screen;
  const blobs = useMemo(
    () =>
      Array.from({ length: fx.blobs ? 6 : 0 }, () => ({
        left: `${10 + Math.random() * 80}%`,
        top: `${10 + Math.random() * 70}%`,
        "--s": `${90 + Math.random() * 120}px`,
        "--r": `${Math.random() * 360}deg`,
        animationDelay: `${Math.random() * 0.15}s`,
      })) as CSSProperties[],
    [fx],
  );
  const stamps = useMemo(
    () =>
      Array.from({ length: fx.stamps ? 6 : 0 }, (_, i) => ({
        left: `${10 + Math.random() * 80}%`,
        top: `${10 + Math.random() * 70}%`,
        fontSize: `${60 + Math.random() * 50}px`,
        rotate: `${Math.random() * 60 - 30}deg`,
        animationDelay: `${i * 0.12}s`,
      })) as CSSProperties[],
    [fx],
  );
  const rain = useMemo(
    () =>
      (fx.rain ? Array.from({ length: 28 }) : []).map((_, i) => ({
        char: fx.rain![i % fx.rain!.length],
        style: {
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 0.6}s`,
          animationDuration: `${1.2 + Math.random() * 1.2}s`,
        } as CSSProperties,
      })),
    [fx],
  );

  useEffect(() => {
    if (fx.motion === "shake") {
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
    } else if (fx.motion === "tilt") {
      // 踩到香蕉皮：先滑一下再歪倒，最后弹回来
      document.body.animate(
        [
          { transform: "none" },
          { transform: "translateX(30px) rotate(0deg)", offset: 0.25 },
          { transform: "translateX(-10px) rotate(-12deg)", offset: 0.55 },
          { transform: "rotate(4deg)", offset: 0.8 },
          { transform: "none" },
        ],
        { duration: 1100, easing: "ease-out" },
      );
    }
  }, [fx]);

  return (
    <div className={`throw-screen throw-screen-${item}`}>
      {blobs.map((s, i) => (
        <span key={i} className="throw-screen-blob" style={s} />
      ))}
      {stamps.map((s, i) => (
        <span key={i} className="throw-screen-stamp" style={s}>
          {fx.stamps}
        </span>
      ))}
      {rain.map((r, i) => (
        <span key={i} className="throw-screen-rain" style={r.style}>
          {r.char}
        </span>
      ))}
      {fx.big && <span className="throw-screen-big">{fx.big}</span>}
      <div className="throw-screen-text">
        {from} {def.gift ? `送了你${def.name} ${def.emoji}` : `朝你扔了${def.name}！`}
      </div>
    </div>
  );
}
