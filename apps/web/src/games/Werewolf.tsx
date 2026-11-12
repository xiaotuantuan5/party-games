import { useEffect, useRef, useState } from "react";
import { WEREWOLF_ROLES, type WerewolfLogEntry, type WerewolfView } from "@party/shared";
import { Avatar } from "../components";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./Werewolf.css";

const WOLF_SHARDS = ["🩸", "🐺", "🌕", "💀"];
const GOOD_CONFETTI = ["🎉", "☀️", "✨", "🌻"];
const WOLF_CONFETTI = ["🐺", "🌕", "🩸", "🌙"];

/** 根据服务端下发的新事件播放音效和特效 */
function useGameEffects(g: WerewolfView, me: string, names: (ids?: string[]) => string, name: (id?: string) => string) {
  const { fx, show, shaking, shake } = useFx();
  const [confetti, setConfetti] = useState(false);
  const lastSeq = useRef<number | null>(null);

  const onEvent = (e: WerewolfLogEntry) => {
    switch (e.kind) {
      case "night":
        sfx.night();
        show({ kind: "toast", icon: "🌙", text: "天黑请闭眼" });
        break;
      case "dawn": {
        sfx.dawn();
        const dead = e.playerIds ?? [];
        if (dead.includes(me)) vibrate([300, 100, 300]);
        show(
          dead.length
            ? { kind: "explode", icon: "💀", text: dead.includes(me) ? "你昨晚死了" : `昨晚 ${names(dead)} 死了` }
            : { kind: "success", icon: "☀️", text: "昨晚是平安夜" },
        );
        break;
      }
      case "exile":
        sfx.liar();
        show({ kind: "toast", icon: "🗳", text: `${names(e.playerIds)} 被投出局` });
        if (e.playerIds?.includes(me)) vibrate(200);
        break;
      case "vote":
        sfx.skip();
        show({ kind: "toast", icon: "🤝", text: "今天没有人出局" });
        break;
      case "shot":
        if (e.targetId) {
          sfx.gunshot();
          shake();
          if (e.targetId === me) vibrate([300, 100, 500]);
          show({ kind: "explode", icon: "🔫", text: `猎人带走了 ${e.targetId === me ? "你" : name(e.targetId)}` });
        }
        break;
      case "end": {
        const iWon = g.reveal && WEREWOLF_ROLES[g.reveal[me] ?? g.myRole].team === g.winner;
        if (iWon) sfx.win();
        else sfx.lose();
        setConfetti(true);
        break;
      }
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

/** 点一下翻开身份牌，再点一下盖上，防止旁边的人偷看 */
function RoleCard({ g, name }: { g: WerewolfView; name: (id?: string) => string }) {
  const [open, setOpen] = useState(false);
  const role = WEREWOLF_ROLES[g.myRole];
  return (
    <button type="button" className={`ww-role ${open ? "open" : ""} r-${g.myRole}`} onClick={() => setOpen((v) => !v)}>
      {open ? (
        <>
          <span className="ww-role-emoji">{role.emoji}</span>
          <span className="ww-role-text">
            <strong>
              你是{role.name}
              <small>（{role.team === "wolf" ? "狼人阵营" : "好人阵营"}）</small>
            </strong>
            <span>{role.description}</span>
            {g.wolfTeam && <span>狼队友：{g.wolfTeam.map((id) => name(id)).join("、")}</span>}
            {g.potions && (
              <span>
                解药 {g.potions.antidote ? "✅" : "❌"} · 毒药 {g.potions.poison ? "✅" : "❌"}
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="ww-role-hidden">🂠 点击查看身份（别让别人看到）</span>
      )}
    </button>
  );
}

export function Werewolf({ room, me, actions }: GameProps) {
  const g = room.game as WerewolfView;
  const { error, run } = useRun();
  const [target, setTarget] = useState<string | null>(null);
  const [poisoning, setPoisoning] = useState(false);

  const name = (id?: string | null) => (id === me ? "你" : nameOf(room, id));
  const plain = (id?: string | null) => nameOf(room, id);
  const names = (ids?: string[]) => (ids ?? []).map((id) => name(id)).join("、");
  const seat = (id: string) => g.order.indexOf(id) + 1;
  const { fx, shaking, confetti } = useGameEffects(g, me, names, name);

  const alive = g.alive.includes(me);
  const night = g.night;
  const task = night && !night.done ? night.task : null;
  const isHunterTurn = g.phase === "hunter" && g.hunterId === me;
  const lastVote = g.voteResults.at(-1);

  // 阶段或任务变化时清掉本地选择
  const stage = `${g.phase}-${g.round}-${task}-${g.votedIds.includes(me)}`;
  useEffect(() => {
    setTarget(null);
    setPoisoning(false);
  }, [stage]);

  // 白天轮到自己投票 / 猎人开枪时提示。夜里不响，免得旁边的人听出谁有身份。
  const needsMe = (g.phase === "vote" && alive && !g.votedIds.includes(me)) || isHunterTurn;
  const prevNeeds = useRef(false);
  useEffect(() => {
    if (needsMe && !prevNeeds.current) {
      sfx.myTurn();
      vibrate(60);
    }
    prevNeeds.current = needsMe;
  }, [needsMe]);

  /** 当前操作可以选哪些人 */
  let selectable: (id: string) => boolean = () => false;
  if (task === "wolf") selectable = (id) => g.alive.includes(id) && !g.wolfTeam?.includes(id);
  else if (task === "seer") selectable = (id) => g.alive.includes(id) && id !== me;
  else if (task === "witch" && poisoning) selectable = (id) => g.alive.includes(id) && id !== me;
  else if (g.phase === "vote" && alive && !g.votedIds.includes(me)) selectable = (id) => g.alive.includes(id) && id !== me;
  else if (isHunterTurn) selectable = (id) => g.alive.includes(id) && id !== me;

  const act = (a: Parameters<typeof actions.act>[0]) => run(actions.act(a).then(() => setTarget(null)));

  const seerResult = g.seerChecks?.at(-1);
  const checked = new Map(g.seerChecks?.map((c) => [c.targetId, c.isWolf]));
  const wolfPicks = night?.wolfVotes ?? {};
  const pickedBy = (id: string) => Object.entries(wolfPicks).filter(([, t]) => t === id).map(([w]) => w);

  const phaseTitle =
    g.phase === "night" ? `🌙 第 ${g.round} 夜` : g.phase === "ended" ? "游戏结束" : `☀️ 第 ${g.round} 天`;

  let status: string;
  if (g.phase === "ended") status = g.winner === "good" ? "☀️ 好人获胜！" : "🐺 狼人获胜！";
  else if (!alive && !isHunterTurn) status = "你已经出局了，请保持安静 🤫";
  else if (g.phase === "night") {
    if (task === "wolf") status = "🐺 狼人请睁眼：和队友选同一个人刀掉";
    else if (task === "seer") status = "🔮 预言家请睁眼：选一个人查验";
    else if (task === "witch") status = "🧪 女巫请睁眼";
    else if (night?.done && g.myRole === "wolf") status = "🔒 刀口已锁定，请闭眼等天亮…";
    else status = "🌙 天黑请闭眼，等待其他人行动…";
  } else if (g.phase === "hunter") status = isHunterTurn ? "🔫 你是猎人，可以开枪带走一个人" : `🔫 猎人 ${plain(g.hunterId)} 正在决定要不要开枪…`;
  else if (g.phase === "day") status = "按顺序发言，说完了点“准备投票”";
  else status = g.votedIds.includes(me) ? "已投票，等其他人…" : "投票：选一个你觉得是狼的人";

  return (
    <>
      <FxLayer fx={fx} shards={WOLF_SHARDS} />
      {confetti && <Confetti chars={g.winner === "wolf" ? WOLF_CONFETTI : GOOD_CONFETTI} />}

      <section className={`ww-root ${g.phase === "night" ? "is-night" : "is-day"} ${shaking ? "fx-shake" : ""}`}>
        <div className="ww-head">
          <h2>🐺 狼人杀</h2>
          <span className="ww-phase">{phaseTitle}</span>
          <SoundToggle />
        </div>

        <RoleCard g={g} name={plain} />

        <p className={g.phase === "ended" ? "big ww-end-text" : "ww-status"}>{status}</p>

        {g.lastNightDeaths && g.phase !== "ended" && (
          <p className="ww-dawn">
            {g.lastNightDeaths.length ? `💀 昨晚死亡：${names(g.lastNightDeaths)}` : "☀️ 昨晚是平安夜"}
          </p>
        )}

        <ul className="ww-seats">
          {g.order.map((id) => {
            const dead = !g.alive.includes(id);
            const can = selectable(id);
            const role = g.reveal?.[id];
            const wolfMate = g.wolfTeam?.includes(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`ww-seat ${dead ? "dead" : ""} ${can ? "can" : ""} ${target === id ? "selected" : ""} ${
                    g.phase === "hunter" && g.hunterId === id ? "hunter" : ""
                  }`}
                  disabled={!can}
                  onClick={() => setTarget(target === id ? null : id)}
                >
                  <span className="ww-seat-no">{seat(id)}</span>
                  <Avatar name={plain(id)} seed={id} size={40} />
                  <span className="ww-seat-name">
                    {plain(id)}
                    {id === me && "（我）"}
                  </span>
                  <span className="ww-seat-tags">
                    {dead && "💀"}
                    {role && WEREWOLF_ROLES[role].emoji}
                    {!role && wolfMate && "🐺"}
                    {!role && checked.has(id) && (
                      <span className={`ww-check ${checked.get(id) ? "wolf" : "good"}`}>{checked.get(id) ? "查杀" : "金水"}</span>
                    )}
                    {g.phase === "day" && g.readyIds.includes(id) && "✋"}
                    {g.phase === "vote" && g.votedIds.includes(id) && "🗳"}
                  </span>
                  {task === "wolf" && pickedBy(id).length > 0 && (
                    <span className="ww-seat-knife">🔪 {pickedBy(id).map((w) => plain(w)).join("、")}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* ---------- 夜晚 ---------- */}
        {task === "wolf" && (
          <div className="ww-panel">
            <p className="hint">队友的选择会标在头像下面，所有狼人选同一个人才会锁定。</p>
            <button type="button" disabled={!target} onClick={() => act({ gameId: "werewolf", type: "wolfKill", targetId: target! })}>
              🔪 {target ? `刀 ${plain(target)}` : "先点一个人"}
            </button>
          </div>
        )}
        {task === "seer" && (
          <div className="ww-panel">
            <button type="button" disabled={!target} onClick={() => act({ gameId: "werewolf", type: "seerCheck", targetId: target! })}>
              🔮 {target ? `查验 ${plain(target)}` : "先点一个人"}
            </button>
          </div>
        )}
        {g.phase === "night" && g.myRole === "seer" && night?.done && seerResult?.round === g.round && (
          <p className={`ww-seer-result ${seerResult.isWolf ? "wolf" : "good"}`}>
            {plain(seerResult.targetId)} 是 {seerResult.isWolf ? "🐺 狼人！" : "👍 好人"}
          </p>
        )}
        {task === "witch" && g.potions && (
          <div className="ww-panel">
            <p>
              {!g.potions.antidote
                ? "解药已经用过了，看不到今晚的刀口。"
                : night?.wolfTargetId
                  ? `今晚 ${name(night.wolfTargetId)} 被狼人刀了。`
                  : "今晚没有人被刀。"}
            </p>
            {!poisoning ? (
              <div className="ww-witch-actions">
                {g.potions.antidote && night?.wolfTargetId && night.wolfTargetId !== me && (
                  <button type="button" className="ww-save" onClick={() => act({ gameId: "werewolf", type: "witch", save: true })}>
                    💊 用解药救他
                  </button>
                )}
                {night?.wolfTargetId === me && g.potions.antidote && <p className="hint">女巫不能自救。</p>}
                {g.potions.poison && (
                  <button type="button" className="ww-poison" onClick={() => setPoisoning(true)}>
                    ☠️ 用毒药…
                  </button>
                )}
                <button type="button" className="secondary" onClick={() => act({ gameId: "werewolf", type: "witch" })}>
                  什么都不做
                </button>
              </div>
            ) : (
              <div className="ww-witch-actions">
                <button
                  type="button"
                  className="ww-poison"
                  disabled={!target}
                  onClick={() => act({ gameId: "werewolf", type: "witch", poisonId: target })}
                >
                  ☠️ {target ? `毒死 ${plain(target)}` : "点一个人下毒"}
                </button>
                <button type="button" className="secondary" onClick={() => setPoisoning(false)}>
                  返回
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------- 猎人 ---------- */}
        {isHunterTurn && (
          <div className="ww-panel">
            <div className="ww-witch-actions">
              <button
                type="button"
                className="ww-poison"
                disabled={!target}
                onClick={() => act({ gameId: "werewolf", type: "hunterShoot", targetId: target })}
              >
                🔫 {target ? `带走 ${plain(target)}` : "点一个人"}
              </button>
              <button type="button" className="secondary" onClick={() => act({ gameId: "werewolf", type: "hunterShoot", targetId: null })}>
                不开枪
              </button>
            </div>
          </div>
        )}

        {/* ---------- 白天 ---------- */}
        {g.phase === "day" && (
          <div className="ww-panel">
            <div className="ww-speak">
              发言顺序：
              {g.speakOrder.map((id, i) => (
                <span key={id} className={g.readyIds.includes(id) ? "done" : ""}>
                  {i > 0 && " → "}
                  {seat(id)}号{plain(id)}
                </span>
              ))}
            </div>
            <p className="hint">
              准备投票 {g.readyIds.length}/{g.alive.length}
            </p>
            {alive && (
              <button
                type="button"
                className={g.readyIds.includes(me) ? "secondary" : ""}
                onClick={() => act({ gameId: "werewolf", type: "ready", ready: !g.readyIds.includes(me) })}
              >
                {g.readyIds.includes(me) ? "取消准备（还想再说两句）" : "✋ 我说完了，准备投票"}
              </button>
            )}
          </div>
        )}
        {g.phase === "vote" && (
          <div className="ww-panel">
            <p className="hint">
              已投票 {g.votedIds.length}/{g.alive.length}，全部投完后公开结果
            </p>
            {alive && !g.votedIds.includes(me) && (
              <div className="ww-witch-actions">
                <button type="button" disabled={!target} onClick={() => act({ gameId: "werewolf", type: "vote", targetId: target })}>
                  🗳 {target ? `投 ${plain(target)}` : "点一个人"}
                </button>
                <button type="button" className="secondary" onClick={() => act({ gameId: "werewolf", type: "vote", targetId: null })}>
                  弃票
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------- 结束 ---------- */}
        {g.phase === "ended" && g.reveal && (
          <ul className="ww-reveal">
            {g.order.map((id) => {
              const r = WEREWOLF_ROLES[g.reveal![id]!];
              const won = r.team === g.winner;
              return (
                <li key={id} className={won ? "won" : ""}>
                  {seat(id)}号 {plain(id)}：{r.emoji} {r.name}
                  {won && " 🏆"}
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="error">{error}</p>}

        {lastVote && g.phase !== "night" && (
          <div className="ww-votes">
            <h3>第 {lastVote.round} 天投票</h3>
            <ul>
              {Object.entries(lastVote.votes).map(([voter, t]) => (
                <li key={voter}>
                  {plain(voter)} → {t ? plain(t) : "弃票"}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="history">
          {g.log
            .slice(-8)
            .reverse()
            .map((e) => (
              <li key={e.seq}>
                {e.text
                  .replace("{players}", (e.playerIds ?? []).map((id) => plain(id)).join("、"))
                  .replace("{target}", plain(e.targetId))}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
