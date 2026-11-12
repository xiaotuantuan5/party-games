import { useEffect, useRef, useState } from "react";
import {
  MOYU_COFFEE_COST,
  MOYU_COST,
  MOYU_DOOR,
  MOYU_GEAR,
  MOYU_PREP_S,
  MOYU_REPAIR_RATIO,
  MOYU_TOTAL_S,
  MOYU_TURRET,
  moyuBossDps,
  moyuClock,
  moyuMaxLevel,
  moyuRepairCost,
  type MoyuAction,
  type MoyuDeskView,
  type MoyuItem,
  type MoyuLogEntry,
  type MoyuView,
} from "@party/shared";
import { Avatar } from "../components";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./Moyu.css";

const SHARDS = ["📄", "💥", "🐟", "📎"];

/** 去掉 gameId 的操作，逐个分支 Omit，保留联合类型 */
type MoyuCommand = { [K in MoyuAction["type"]]: Omit<Extract<MoyuAction, { type: K }>, "gameId"> }[MoyuAction["type"]];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** 根据服务端下发的新事件播放音效和特效 */
function useGameEffects(g: MoyuView, me: string, name: (id?: string) => string) {
  const { fx, show, shaking, shake } = useFx();
  const [confetti, setConfetti] = useState(false);
  const lastSeq = useRef<number | null>(null);

  const onEvent = (e: MoyuLogEntry) => {
    switch (e.kind) {
      case "wake":
        sfx.bossWarning();
        show({ kind: "toast", icon: "👔", text: "早会结束，老板出来巡查了！" });
        break;
      case "target":
        if (e.targetId === me) {
          sfx.bossWarning();
          vibrate([120, 80, 120]);
          show({ kind: "toast", icon: "🚨", text: "老板朝你走过来了！快加固隔板" });
        }
        break;
      case "caught":
        if (e.targetId === me) {
          sfx.explode();
          shake();
          vibrate([300, 100, 300]);
          show({ kind: "explode", icon: "🫣", text: "摸鱼被抓了！", sub: "只能围观同事了" });
        } else {
          sfx.lose();
          show({ kind: "toast", icon: "💥", text: `${name(e.targetId)} 摸鱼被抓了` });
        }
        break;
      case "retreat":
        sfx.dawn();
        show({ kind: "toast", icon: "🍵", text: "老板被打疼了，回办公室喝茶" });
        break;
      case "level":
        sfx.creak();
        show({ kind: "toast", icon: "📈", text: e.text });
        break;
      case "coffee":
        sfx.pick();
        show({ kind: "toast", icon: "☕", text: `${name(e.playerId)} 给老板递了咖啡` });
        break;
      case "help":
        if (e.targetId === me) show({ kind: "toast", icon: "🔧", text: `${name(e.playerId)} 帮你修了隔板` });
        break;
      case "giveUp":
        if (e.targetId === me) show({ kind: "toast", icon: "😮‍💨", text: "老板敲不动你，走了" });
        break;
      case "end": {
        const won = g.result?.winners.includes(me);
        if (won) {
          sfx.win();
          setConfetti(true);
        } else sfx.lose();
        break;
      }
      case "upgrade":
      case "leave":
        break;
    }
  };

  useEffect(() => {
    const maxSeq = g.log.at(-1)?.seq ?? 0;
    // 第一次渲染（包括刷新重连）不重放历史事件
    if (lastSeq.current === null) {
      lastSeq.current = maxSeq;
      return;
    }
    const fresh = g.log.filter((e) => e.seq > lastSeq.current!);
    lastSeq.current = Math.max(lastSeq.current, maxSeq);
    fresh.forEach(onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.log]);

  return { fx, shaking, confetti };
}

function Bar({ value, max, kind }: { value: number; max: number; kind: "door" | "boss" | "time" }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const level = kind === "door" ? (ratio < 0.25 ? "danger" : ratio < 0.5 ? "warn" : "") : "";
  return (
    <span className={`my-bar my-bar-${kind} ${level}`}>
      <span className="my-bar-fill" style={{ width: `${ratio * 100}%` }} />
    </span>
  );
}

function bossStatus(g: MoyuView, deskName: (i: number) => string): string {
  const b = g.boss;
  switch (b.mode) {
    case "meeting":
      return `在会议室开早会，还有 ${Math.max(0, MOYU_PREP_S - g.t)} 秒出来`;
    case "walking":
      return `正走向 ${deskName(b.desk)} 的工位（${b.etaS} 秒）`;
    case "attacking":
      return b.stunS > 0 ? `在 ${deskName(b.desk)} 工位前喝咖啡发呆（${b.stunS} 秒）` : `正在敲 ${deskName(b.desk)} 的隔板！`;
    case "retreating":
      return `回办公室喝茶（${b.etaS} 秒）`;
    case "resting":
      return "在办公室喝茶回血";
  }
}

function Desk({
  g,
  index,
  desk,
  me,
  name,
  canRepair,
  onRepair,
}: {
  g: MoyuView;
  index: number;
  desk: MoyuDeskView;
  me: string;
  name: (id: string) => string;
  canRepair: boolean;
  onRepair: () => void;
}) {
  const b = g.boss;
  const here = b.desk === index && (b.mode === "walking" || b.mode === "attacking");
  const knocking = here && b.mode === "attacking" && b.stunS === 0;
  const mine = desk.ownerId === me;
  const stats = g.players[desk.ownerId];
  const out = desk.broken || desk.vacant;
  const winner = g.result?.winners.includes(desk.ownerId);

  return (
    <li
      className={`my-desk ${mine ? "mine" : ""} ${out ? "out" : ""} ${here ? "targeted" : ""} ${knocking ? "knocking" : ""} ${
        g.result ? (winner ? "won" : "lost") : ""
      }`}
    >
      {here && (
        <span className={`my-boss-pin ${b.mode}`}>
          {b.mode === "walking" ? `👣 ${b.etaS}s` : b.stunS > 0 ? `☕ ${b.stunS}s` : "👔 咚咚咚"}
        </span>
      )}
      <div className="my-desk-head">
        <Avatar name={name(desk.ownerId)} seed={desk.ownerId} size={28} />
        <span className="my-desk-name">
          {name(desk.ownerId)}
          {mine && "（我）"}
        </span>
        {g.result && <span>{winner ? "🏆" : "💀"}</span>}
      </div>
      {out ? (
        <div className="my-desk-out">{desk.vacant ? "🏃 提前溜了" : `🫣 ${stats?.caughtAt != null ? moyuClock(stats.caughtAt) : ""} 被抓`}</div>
      ) : (
        <>
          <div className="my-desk-door">
            <span title={MOYU_DOOR[desk.doorLv]!.name}>{MOYU_DOOR[desk.doorLv]!.icon}</span>
            <Bar value={desk.doorHp} max={desk.doorMax} kind="door" />
            <span className="my-desk-hp">{desk.doorHp}</span>
          </div>
          <div className="my-desk-gear">
            <span title={`摸鱼装备：${MOYU_GEAR[desk.gearLv]!.name}`}>{MOYU_GEAR[desk.gearLv]!.icon}</span>
            {desk.turretLv > 0 && <span title={`炮台：${MOYU_TURRET[desk.turretLv]!.name}`}>{MOYU_TURRET[desk.turretLv]!.icon}</span>}
            <span className="my-desk-coins">🐟 {stats?.coins ?? 0}</span>
          </div>
          {!mine && canRepair && (
            <button type="button" className="my-help" onClick={onRepair}>
              🔧 帮修 {moyuRepairCost(desk.doorLv)}
            </button>
          )}
        </>
      )}
    </li>
  );
}

function UpgradeButton({
  item,
  level,
  coins,
  disabled,
  onClick,
}: {
  item: MoyuItem;
  level: number;
  coins: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const max = moyuMaxLevel(item);
  const next = level + 1;
  const table = { gear: MOYU_GEAR, door: MOYU_DOOR, turret: MOYU_TURRET }[item];
  const label = { gear: "摸鱼装备", door: "隔板", turret: "炮台" }[item];
  const cur = table[level]!;
  if (level >= max) {
    return (
      <button type="button" className="my-upgrade maxed" disabled>
        <span className="my-upgrade-icon">{cur.icon}</span>
        <span className="my-upgrade-name">{label}</span>
        <span className="my-upgrade-desc">{cur.name} · 满级</span>
      </button>
    );
  }
  const nxt = table[next]!;
  const cost = MOYU_COST[item][next]!;
  const effect =
    item === "gear"
      ? `🐟 ${MOYU_GEAR[level]!.income}→${MOYU_GEAR[next]!.income}/秒`
      : item === "door"
        ? `耐久 ${MOYU_DOOR[level]!.hp}→${MOYU_DOOR[next]!.hp}`
        : `伤害 ${MOYU_TURRET[level]!.dps}→${MOYU_TURRET[next]!.dps}/秒`;
  const short = coins < cost;
  return (
    <button type="button" className={`my-upgrade ${short ? "short" : ""}`} disabled={disabled || short} onClick={onClick}>
      <span className="my-upgrade-icon">{nxt.icon}</span>
      <span className="my-upgrade-name">
        {label} → {nxt.name}
      </span>
      <span className="my-upgrade-desc">{effect}</span>
      <span className="my-upgrade-cost">🐟 {cost}</span>
    </button>
  );
}

export function Moyu({ room, me, actions }: GameProps) {
  const g = room.game as MoyuView;
  const { error, run } = useRun();
  const plain = (id?: string | null) => nameOf(room, id);
  const name = (id?: string | null) => (id === me ? "你" : plain(id));
  const { fx, shaking, confetti } = useGameEffects(g, me, name);

  const myDesk = g.desks[g.myDesk];
  const myStats = g.players[me];
  const alive = !!myDesk && !myDesk.broken && !myDesk.vacant;
  const playing = g.phase !== "ended";
  const canAct = alive && playing;
  const coins = myStats?.coins ?? 0;
  const b = g.boss;
  const deskName = (i: number) => name(g.desks[i]?.ownerId);
  const targetedMe = b.desk === g.myDesk && (b.mode === "walking" || b.mode === "attacking");

  // 老板在敲自己的隔板：每秒一声敲门，隔板快烂了手机震一下
  useEffect(() => {
    if (!myDesk || b.desk !== g.myDesk || b.mode !== "attacking" || b.stunS > 0 || !alive) return;
    sfx.woodTap();
    if (myDesk.doorHp < myDesk.doorMax * 0.25) vibrate(40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.t]);

  const act = (a: MoyuCommand, onOk?: () => void) =>
    run(
      actions.act({ gameId: "moyu", ...a } as MoyuAction).then(() => {
        onOk?.();
      }),
    );

  const repairable = (d: MoyuDeskView) =>
    canAct && !d.broken && !d.vacant && d.doorHp < d.doorMax && g.myRepairCooldownS === 0 && coins >= moyuRepairCost(d.doorLv);

  const remaining = Math.max(0, MOYU_TOTAL_S - g.t);
  const outcome = g.result?.outcome;
  const won = g.result?.winners.includes(me);

  // 排行：先看有没有撑到最后，再看摸到的鱼
  const ranking = [...g.desks].sort((x, y) => {
    const ax = g.result?.winners.includes(x.ownerId) ? 1 : 0;
    const ay = g.result?.winners.includes(y.ownerId) ? 1 : 0;
    return ay - ax || (g.players[y.ownerId]?.earned ?? 0) - (g.players[x.ownerId]?.earned ?? 0);
  });

  return (
    <>
      <FxLayer fx={fx} shards={SHARDS} />
      {confetti && <Confetti chars={["🎉", "🐟", "🏃", "✨"]} />}

      <section className={`my-root ${shaking ? "fx-shake" : ""} ${targetedMe && playing ? "alarm" : ""}`}>
        <div className="my-head">
          <h2>🐟 工位摸鱼</h2>
          <span className="my-clock">🕘 {moyuClock(g.t)}</span>
          <SoundToggle />
        </div>
        <div className="my-time">
          <Bar value={g.t} max={MOYU_TOTAL_S} kind="time" />
          <span className="hint">{playing ? `距 18:00 下班还有 ${mmss(remaining)}` : "下班了"}</span>
        </div>

        {/* ---------- 老板 ---------- */}
        <div className={`my-boss ${b.mode}`}>
          <span className="my-boss-face">{b.mode === "resting" ? "🍵" : b.stunS > 0 ? "☕" : "👔"}</span>
          <div className="my-boss-info">
            <div className="my-boss-title">
              老板 Lv.{b.level}
              <span className="hint">
                {" "}
                · 敲 {moyuBossDps(b.level, g.desks.length)}/秒 · 🍵×{b.retreatsLeft}
                {b.nextLevelS !== null && b.mode !== "meeting" && ` · ${b.nextLevelS} 秒后升级`}
              </span>
            </div>
            <Bar value={b.hp} max={b.maxHp} kind="boss" />
            <div className="my-boss-status">{playing ? bossStatus(g, deskName) : outcome === "bossDown" ? "被气得提前回家了" : "下班了"}</div>
          </div>
        </div>

        {/* ---------- 结算 ---------- */}
        {g.result && (
          <div className={`my-result ${won ? "won" : "lost"}`}>
            <p className="big">
              {outcome === "allCaught" ? "😱 全员被抓，老板获胜" : outcome === "bossDown" ? "🎉 老板被气走，提前下班！" : "🎉 18:00，下班！"}
            </p>
            <p>{won ? "你撑到了最后，摸鱼成功！" : "你没能撑到下班…"}</p>
            <table className="my-stats">
              <thead>
                <tr>
                  <th />
                  <th>🐟 摸鱼</th>
                  <th>🎯 伤害</th>
                  <th>🔧 帮忙</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((d) => {
                  const p = g.players[d.ownerId]!;
                  return (
                    <tr key={d.ownerId} className={d.ownerId === me ? "me" : ""}>
                      <td>
                        {g.result!.winners.includes(d.ownerId) ? "🏆" : "💀"} {plain(d.ownerId)}
                      </td>
                      <td>{p.earned}</td>
                      <td>{p.damage}</td>
                      <td>{p.helps}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ---------- 办公区 ---------- */}
        <ul className="my-office">
          {g.desks.map((d, i) => (
            <Desk
              key={d.ownerId}
              g={g}
              index={i}
              desk={d}
              me={me}
              name={plain}
              canRepair={repairable(d) && d.doorHp < d.doorMax * (1 - MOYU_REPAIR_RATIO / 2)}
              onRepair={() => act({ type: "repair", desk: i }, () => sfx.plate())}
            />
          ))}
        </ul>

        {/* ---------- 我的工位 ---------- */}
        {myDesk && playing && alive && (
          <div className={`my-panel ${targetedMe ? "danger" : ""}`}>
            <div className="my-wallet">
              <span className="my-coins" key={coins}>
                🐟 {coins}
              </span>
              <span className="hint">
                每秒 +{MOYU_GEAR[myDesk.gearLv]!.income}
                {g.phase === "prep" && " · 老板开会中，抓紧升级"}
              </span>
            </div>
            <div className="my-upgrades">
              {(["door", "gear", "turret"] as const).map((item) => (
                <UpgradeButton
                  key={item}
                  item={item}
                  level={{ door: myDesk.doorLv, gear: myDesk.gearLv, turret: myDesk.turretLv }[item]}
                  coins={coins}
                  disabled={!canAct}
                  onClick={() => act({ type: "upgrade", item }, () => sfx.powerup())}
                />
              ))}
            </div>
            <div className="my-actions">
              <button
                type="button"
                disabled={!repairable(myDesk)}
                onClick={() => act({ type: "repair", desk: g.myDesk }, () => sfx.plate())}
              >
                🔧 修隔板 +{Math.ceil(myDesk.doorMax * MOYU_REPAIR_RATIO)}
                <small>
                  {g.myRepairCooldownS > 0 ? ` 冷却 ${g.myRepairCooldownS}s` : ` 🐟${moyuRepairCost(myDesk.doorLv)}`}
                </small>
              </button>
              <button
                type="button"
                className="my-coffee"
                disabled={b.mode !== "attacking" || b.stunS > 0 || g.coffeeCooldownS > 0 || coins < MOYU_COFFEE_COST}
                onClick={() => act({ type: "coffee" })}
              >
                ☕ 递咖啡
                <small>{g.coffeeCooldownS > 0 ? ` 冷却 ${g.coffeeCooldownS}s` : ` 🐟${MOYU_COFFEE_COST}`}</small>
              </button>
            </div>
            <p className="hint">
              {targetedMe
                ? "🚨 老板盯上你了！升级隔板会直接补上多出来的耐久，炮台会打他"
                : "同事隔板快烂时，点 Ta 工位上的“帮修”；老板在敲谁都可以递咖啡"}
            </p>
          </div>
        )}
        {myDesk && playing && !alive && <p className="my-spectate">🫣 你被抓了，现在只能围观。给同事加油！</p>}

        {error && <p className="error">{error}</p>}

        <ul className="history">
          {g.log
            .slice(-6)
            .reverse()
            .map((e) => (
              <li key={e.seq}>
                <span className="my-log-time">{moyuClock(e.t)}</span>{" "}
                {e.text.replace("{player}", plain(e.playerId)).replaceAll("{target}", plain(e.targetId))}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
