import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { SoundToggle } from "../fx";
import { getBest, saveBest } from "./soloGames";
import { GRADES, MAP_NAME, SKILLS, STATS, type Card, type Grade } from "./stickmanData";
import { StickmanScene, type StickAction, type StickBanner, type StickHud, type StickResult } from "./stickmanScene";
import "./Stickman.css";

type Phase = "ready" | "playing" | "paused" | "cards" | "dead" | "over";

const GRADE_KEY = "party.solo.stickman.grade";
const SKILL_KEYS = ["U", "I", "O", "Y", "H", "N"];

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function bestGrade(): Grade | null {
  const g = localStorage.getItem(GRADE_KEY);
  return GRADES.includes(g as Grade) ? (g as Grade) : null;
}

function saveGrade(g: Grade): void {
  const old = bestGrade();
  if (!old || GRADES.indexOf(g) < GRADES.indexOf(old)) localStorage.setItem(GRADE_KEY, g);
}

function cardInfo(c: Card): { tag: string; icon: string; title: string; desc: string } {
  if (c.kind === "skill") {
    const s = SKILLS[c.skill];
    return { tag: "新技能", icon: s.icon, title: s.name, desc: s.desc };
  }
  if (c.kind === "upgrade") {
    const s = SKILLS[c.skill];
    const u = s.upgrades.find((x) => x.id === c.upgrade)!;
    return { tag: "技能强化", icon: s.icon, title: `${s.name} · ${u.name}`, desc: u.desc };
  }
  const s = STATS[c.stat];
  return { tag: "属性", icon: s.icon, title: s.name, desc: s.desc };
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

async function enterLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  } catch {
    /* 有的浏览器不允许全屏，忽略 */
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
  } catch {
    /* iOS Safari 不支持锁定方向，只能靠提示 */
  }
}

function leaveLandscape(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* 忽略 */
  }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

export function Stickman({ onExit }: { onExit: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StickmanScene | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState<StickHud | null>(null);
  const [banner, setBanner] = useState<(StickBanner & { id: number }) | null>(null);
  const [combo, setCombo] = useState<(StickBanner & { id: number }) | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [canRevive, setCanRevive] = useState(false);
  const [result, setResult] = useState<(StickResult & { record: boolean }) | null>(null);
  const [best, setBest] = useState(() => getBest("stickman"));
  const [grade, setGrade] = useState(bestGrade);
  const [cine, setCine] = useState(false);
  const [cineOn, setCineOn] = useState(true);
  const [flash, setFlash] = useState<{ kind: "white" | "red"; id: number } | null>(null);
  const [fade, setFade] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [touch] = useState(isTouch);
  const [webglError, setWebglError] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let scene: StickmanScene;
    let id = 0;
    try {
      scene = new StickmanScene(mount.current!, {
        onHud: setHud,
        onBanner: (b) => (b.kind === "element" ? setCombo({ ...b, id: ++id }) : setBanner({ ...b, id: ++id })),
        onCards: (c) => {
          setCards(c);
          setPhase("cards");
        },
        onDeath: (can) => {
          setCanRevive(can);
          setPhase("dead");
        },
        onResult: (r) => {
          const record = saveBest("stickman", r.score);
          saveGrade(r.grade);
          setBest(getBest("stickman"));
          setGrade(bestGrade());
          setResult({ ...r, record });
          setPhase("over");
        },
        onCine: setCine,
        onFlash: (kind) => setFlash({ kind, id: ++id }),
        onFade: setFade,
      });
    } catch {
      setWebglError(true);
      return;
    }
    sceneRef.current = scene;
    setCineOn(scene.cinematics);

    const pause = () => {
      if (phaseRef.current !== "playing") return;
      scene.setPaused(true);
      setPhase("paused");
    };
    const onHidden = () => document.hidden && pause();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "p") return;
      if (phaseRef.current === "playing") pause();
      else if (phaseRef.current === "paused") {
        scene.setPaused(false);
        setPhase("playing");
      }
    };
    // 竖屏时盖一层提示并暂停
    const onResize = () => {
      const p = window.innerHeight > window.innerWidth && isTouch();
      setPortrait(p);
      if (p) pause();
    };
    onResize();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      scene.dispose();
      sceneRef.current = null;
      leaveLandscape();
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), banner.kind === "boss" ? 2400 : 1500);
    return () => clearTimeout(t);
  }, [banner]);
  useEffect(() => {
    if (!combo) return;
    const t = setTimeout(() => setCombo(null), 1100);
    return () => clearTimeout(t);
  }, [combo]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.kind === "white" ? 450 : 250);
    return () => clearTimeout(t);
  }, [flash]);

  const start = () => {
    if (touch) void enterLandscape();
    setResult(null);
    setHud(null);
    setCards([]);
    setPhase("playing");
    sceneRef.current?.start();
  };
  const resume = () => {
    sceneRef.current?.setPaused(false);
    setShowSkills(false);
    setPhase("playing");
  };
  const exit = () => {
    leaveLandscape();
    onExit();
  };
  const choose = (c: Card) => {
    sceneRef.current?.chooseCard(c);
    setCards([]);
    setPhase("playing");
  };
  const toggleCine = () => {
    const next = !cineOn;
    sceneRef.current?.setCinematics(next);
    setCineOn(next);
  };

  const playing = phase === "playing";

  return (
    <div className="sm-root">
      <div className="sm-stage" ref={mount} />
      {webglError && <p className="sm-error">你的浏览器不支持 WebGL，没法显示 3D 画面 😢</p>}

      {playing && hud && !cine && <Hud hud={hud} onPause={() => { sceneRef.current?.setPaused(true); setPhase("paused"); }} />}
      {playing && hud && !cine && sceneRef.current && <Controls scene={sceneRef.current} hud={hud} touch={touch} />}

      {cine && playing && (
        <button type="button" className="sm-cine" onPointerDown={() => sceneRef.current?.skipCine()}>
          <span className="sm-cine-bar top" />
          <span className="sm-cine-bar bottom" />
          <span className="sm-cine-skip">点击跳过 ▶▶</span>
        </button>
      )}

      {banner && playing && (
        <div key={banner.id} className={`sm-banner ${banner.kind}`}>
          {banner.text}
        </div>
      )}
      {combo && playing && (
        <div key={combo.id} className="sm-element">
          {combo.text}
        </div>
      )}
      {flash && <div key={flash.id} className={`sm-flash ${flash.kind}`} />}
      <div className={`sm-fade ${fade ? "on" : ""}`} />

      {phase === "ready" && (
        <div className="sm-overlay">
          <div className="sm-corner">
            <SoundToggle />
          </div>
          <h1 className="sm-title">火柴人刷图</h1>
          <p className="sm-sub">STICKMAN DUNGEON · {MAP_NAME}</p>
          <div className="sm-help">
            <p>🗡 清掉每个房间的怪物，开门进下一间，最后打倒哥布林酋长</p>
            <p>✨ 每清完一间，三选一：学新技能、强化技能或加属性</p>
            <p>🔥❄️⚡ 换着元素打：火 + 冰 = 蒸汽爆炸，雷 + 火 = 过载，冻住时重击 = 碎冰</p>
            <p>🌟 觉醒技「万剑归宗」：打怪攒满能量后释放</p>
            {touch ? (
              <p>🎮 左边拖动移动；右边是攻击、跳跃、闪避和技能键</p>
            ) : (
              <p>⌨️ WASD / 方向键移动 · J 攻击 · K 跳 · L 闪避 · U I O Y H N 技能 · 空格觉醒 · Esc 暂停</p>
            )}
          </div>
          {best > 0 && (
            <p className="sm-best">
              🏆 最高分 {best.toLocaleString()}
              {grade && <b className={`sm-grade-tag g-${grade}`}>{grade}</b>}
            </p>
          )}
          <button type="button" className="sm-btn" onClick={start}>
            ⚔️ 进入地下城
          </button>
          <button type="button" className="sm-btn ghost" onClick={exit}>
            返回首页
          </button>
        </div>
      )}

      {phase === "cards" && (
        <div className="sm-overlay sm-cards-wrap">
          <h2 className="sm-title small">选择一项奖励</h2>
          <div className="sm-cards">
            {cards.map((c, i) => {
              const info = cardInfo(c);
              return (
                <button key={i} type="button" className={`sm-card k-${c.kind}`} onClick={() => choose(c)}>
                  <span className="sm-card-tag">{info.tag}</span>
                  <span className="sm-card-icon">{info.icon}</span>
                  <span className="sm-card-title">{info.title}</span>
                  <span className="sm-card-desc">{info.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === "paused" && !portrait && (
        <div className="sm-overlay">
          <div className="sm-corner">
            <SoundToggle />
          </div>
          <h2 className="sm-title small">已暂停</h2>
          {showSkills && sceneRef.current ? (
            <ul className="sm-skill-list">
              {sceneRef.current.loadout().map((s) => (
                <li key={s.id}>
                  <b>
                    {SKILLS[s.id].icon} {SKILLS[s.id].name}
                    {s.upgrades.length > 0 && <em> · {s.upgrades.join(" · ")}</em>}
                  </b>
                  <span>{SKILLS[s.id].desc}</span>
                </li>
              ))}
              <li>
                <b>🌟 万剑归宗（觉醒）</b>
                <span>展开 100 把光剑射向全屏敌人，最后巨剑劈下</span>
              </li>
            </ul>
          ) : null}
          <button type="button" className="sm-btn" onClick={resume}>
            ▶ 继续
          </button>
          <div className="sm-row">
            <button type="button" className="sm-btn ghost small" onClick={() => setShowSkills((v) => !v)}>
              {showSkills ? "收起技能说明" : "📖 技能说明"}
            </button>
            <button type="button" className="sm-btn ghost small" onClick={toggleCine}>
              🎬 技能运镜：{cineOn ? "开" : "关"}
            </button>
          </div>
          <button type="button" className="sm-btn ghost" onClick={() => sceneRef.current?.giveUp()}>
            放弃本局
          </button>
        </div>
      )}

      {phase === "dead" && (
        <div className="sm-overlay">
          <h2 className="sm-title small">你倒下了</h2>
          {canRevive ? (
            <>
              <p className="sm-best">每局可以复活一次，复活后评分降一档</p>
              <button
                type="button"
                className="sm-btn"
                onClick={() => {
                  sceneRef.current?.revive();
                  setPhase("playing");
                }}
              >
                ✨ 复活
              </button>
            </>
          ) : null}
          <button type="button" className="sm-btn ghost" onClick={() => sceneRef.current?.giveUp()}>
            查看结算
          </button>
        </div>
      )}

      {phase === "over" && result && (
        <div className="sm-overlay">
          <h2 className="sm-title small">{result.victory ? "🏆 通关！" : "挑战失败"}</h2>
          <div className={`sm-grade g-${result.grade}`}>{result.grade}</div>
          <div className="sm-final">{result.score.toLocaleString()}</div>
          {result.record ? <p className="sm-record">🎉 新纪录！</p> : <p className="sm-best">🏆 最高分 {best.toLocaleString()}</p>}
          <div className="sm-breakdown">
            {result.breakdown.map((b) => (
              <span key={b.label}>
                {b.label}
                <b>+{b.value.toLocaleString()}</b>
              </span>
            ))}
          </div>
          <div className="sm-stats">
            <span>
              <b>{formatTime(result.seconds)}</b>用时
            </span>
            <span>
              <b>{result.kills}</b>击杀
            </span>
            <span>
              <b>{result.maxCombo}</b>最大连击
            </span>
            <span>
              <b>{result.elementCombos}</b>元素组合
            </span>
            <span>
              <b>{result.hitsTaken}</b>被击
            </span>
          </div>
          {result.revived && <p className="sm-best">复活过一次，评分降了一档</p>}
          <button type="button" className="sm-btn" onClick={start}>
            🔁 再来一局
          </button>
          <button type="button" className="sm-btn ghost" onClick={exit}>
            返回首页
          </button>
        </div>
      )}

      {portrait && (
        <div className="sm-rotate">
          <div className="sm-rotate-phone">📱</div>
          <p>请把手机横过来</p>
          {phase === "paused" && <p className="sm-best">转过来后点「继续」</p>}
        </div>
      )}
    </div>
  );
}

function Hud({ hud, onPause }: { hud: StickHud; onPause: () => void }) {
  return (
    <div className="sm-hud">
      <div className="sm-hud-left">
        <div className="sm-bar hp">
          <i style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }} />
          <span>
            {hud.hp} / {hud.maxHp}
          </span>
        </div>
        <div className="sm-bar mp">
          <i style={{ width: `${(hud.mp / hud.maxMp) * 100}%` }} />
        </div>
      </div>
      {hud.boss ? (
        <div className="sm-boss">
          <div className="sm-boss-name">
            {hud.boss.name}
            <b>×{Math.max(1, Math.ceil((hud.boss.hp / hud.boss.max) * hud.boss.bars))}</b>
          </div>
          <div className="sm-boss-bar">
            <i style={{ width: `${(((hud.boss.hp / hud.boss.max) * hud.boss.bars) % 1 || (hud.boss.hp > 0 ? 1 : 0)) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="sm-map" aria-label={`第 ${hud.room + 1} 个房间，共 ${hud.rooms} 个`}>
          {Array.from({ length: hud.rooms }, (_, i) => (
            <span key={i} className={i < hud.room ? "done" : i === hud.room ? "here" : ""}>
              {i === hud.rooms - 1 ? "☠" : ""}
            </span>
          ))}
          <em>{hud.roomName}</em>
        </div>
      )}
      <div className="sm-hud-right">
        {hud.combo > 1 && (
          <div key={hud.combo} className="sm-combo">
            <b>{hud.combo}</b> HIT
          </div>
        )}
        <div className="sm-score">{hud.score.toLocaleString()}</div>
      </div>
      <button type="button" className="sm-pause" onClick={onPause} aria-label="暂停">
        ❚❚
      </button>
      {hud.hp < hud.maxHp * 0.25 && <div className="sm-danger" />}
      {hud.doorOpen && <div className="sm-door">门开了 →</div>}
    </div>
  );
}

/** 触屏操作：左边是浮动摇杆，右边是动作键；电脑上只显示按键提示 */
function Controls({ scene, hud, touch }: { scene: StickmanScene; hud: StickHud; touch: boolean }) {
  const stickRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const R = 52;

  useEffect(() => () => scene.setStick(0, 0), [scene]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stickRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stickRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setKnob({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stickRef.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = e.clientX - s.x;
    let dy = e.clientY - s.y;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    scene.setStick(dx / R, -dy / R);
    setKnob({ x: s.x, y: s.y, dx, dy });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stickRef.current?.id !== e.pointerId) return;
    stickRef.current = null;
    scene.setStick(0, 0);
    setKnob(null);
  };
  const press = (a: StickAction) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scene.press(a);
  };

  const awakenReady = hud.awaken >= 1;
  return (
    <div className={`sm-controls ${touch ? "touch" : "desk"}`}>
      {touch && (
        <div className="sm-stick-zone" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {knob ? (
            <>
              <span className="sm-stick-base" style={{ left: knob.x, top: knob.y }} />
              <span className="sm-stick-knob" style={{ left: knob.x + knob.dx, top: knob.y + knob.dy }} />
            </>
          ) : (
            <span className="sm-stick-hint">拖动移动</span>
          )}
        </div>
      )}
      <div className="sm-pad">
        <div className="sm-skills">
          {hud.skills.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`sm-skill ${s.cd > 0 ? "cd" : ""} ${s.mpOk ? "" : "nomp"} ${s.id === "airDance" && !hud.air ? "dim" : ""}`}
              onPointerDown={press(i)}
              aria-label={s.name}
            >
              <span className="sm-skill-icon">{s.icon}</span>
              {s.cd > 0 && <span className="sm-skill-cd" style={{ "--p": `${s.cd * 360}deg` } as CSSProperties} />}
              {s.level > 0 && <span className={`sm-skill-lv lv${s.level}`} />}
              <span className="sm-skill-name">{touch ? s.name : `${SKILL_KEYS[i]} ${s.name}`}</span>
            </button>
          ))}
        </div>
        {touch && (
          <div className="sm-actions">
            <button type="button" className={`sm-act dodge ${hud.dodgeCd > 0 ? "cd" : ""}`} onPointerDown={press("dodge")}>
              闪
            </button>
            <button type="button" className="sm-act jump" onPointerDown={press("jump")}>
              跳
            </button>
            <button type="button" className="sm-act attack" onPointerDown={press("attack")}>
              ⚔
            </button>
          </div>
        )}
        <button
          type="button"
          className={`sm-awaken ${awakenReady ? "ready" : ""}`}
          style={{ "--p": `${hud.awaken * 360}deg` } as CSSProperties}
          onPointerDown={press("awaken")}
          aria-label="觉醒：万剑归宗"
        >
          <span>{awakenReady ? "觉醒" : `${Math.floor(hud.awaken * 100)}%`}</span>
          {!touch && <em>空格</em>}
        </button>
      </div>
    </div>
  );
}
