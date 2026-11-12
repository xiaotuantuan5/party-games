import { useEffect, useRef, useState } from "react";
import { AVALON_MAX_REJECTS, AVALON_ROLES, type AvalonLogEntry, type AvalonView } from "@party/shared";
import { Avatar } from "../components";
import { Confetti, FxLayer, SoundToggle, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./Avalon.css";

const EVIL_SHARDS = ["🗡", "🩸", "💀", "🔥"];
const GOOD_CONFETTI = ["🏰", "⚔", "✨", "🏆"];
const EVIL_CONFETTI = ["🗡", "😈", "🩸", "🌑"];

/** 根据服务端下发的新事件播放音效和特效 */
function useGameEffects(g: AvalonView, me: string) {
  const { fx, show, shaking, shake } = useFx();
  const [confetti, setConfetti] = useState(false);
  const lastSeq = useRef<number | null>(null);

  const onEvent = (e: AvalonLogEntry) => {
    switch (e.kind) {
      case "propose":
        sfx.flip();
        break;
      case "approved":
        sfx.play();
        show({ kind: "toast", icon: "✅", text: e.playerIds?.includes(me) ? "组队通过，你要出征了" : "组队通过" });
        if (e.playerIds?.includes(me)) vibrate(60);
        break;
      case "rejected":
        sfx.skip();
        show({ kind: "toast", icon: "❌", text: "组队被否决，换下一位队长" });
        break;
      case "questSuccess":
        sfx.safe();
        show({ kind: "success", icon: "🏆", text: "任务成功" });
        break;
      case "questFail":
        sfx.explode();
        shake();
        show({ kind: "explode", icon: "💥", text: "任务失败", sub: e.text });
        break;
      case "assassin":
        sfx.heartbeat();
        show({ kind: "toast", icon: "🗡", text: "刺客准备刺杀梅林…" });
        break;
      case "end": {
        const myRole = g.reveal?.[me] ?? g.myRole;
        if (AVALON_ROLES[myRole].team === g.winner) sfx.win();
        else sfx.lose();
        if (g.winReason === "assassinHit") shake();
        setConfetti(true);
        break;
      }
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
function RoleCard({ g, name }: { g: AvalonView; name: (id?: string) => string }) {
  const [open, setOpen] = useState(false);
  const role = AVALON_ROLES[g.myRole];
  const seen = g.sight.map((s) => name(s.playerId)).join("、");
  let sightText: string | null = null;
  if (g.myRole === "merlin") sightText = seen ? `坏人：${seen}` : "你没看到坏人（莫德雷德藏起来了）";
  else if (g.myRole === "percival") sightText = `梅林和莫甘娜是：${seen}（分不清谁是谁）`;
  else if (g.myRole === "oberon") sightText = "你不认识其他坏人";
  else if (role.team === "evil") sightText = seen ? `坏人队友：${seen}` : "你的队友藏得很深";

  return (
    <button type="button" className={`av-role ${open ? "open" : ""} t-${role.team}`} onClick={() => setOpen((v) => !v)}>
      {open ? (
        <>
          <span className="av-role-emoji">{role.emoji}</span>
          <span className="av-role-text">
            <strong>
              你是{role.name}
              <small>（{role.team === "evil" ? "坏人阵营" : "好人阵营"}）</small>
            </strong>
            <span>{role.description}</span>
            {sightText && <span className="av-sight">👁 {sightText}</span>}
          </span>
        </>
      ) : (
        <span className="av-role-hidden">🂠 点击查看身份（别让别人看到）</span>
      )}
    </button>
  );
}

/** 5 个任务的进度条 */
function QuestTrack({ g }: { g: AvalonView }) {
  return (
    <div className="av-track">
      <ol className="av-quests">
        {g.questSizes.map((size, i) => {
          const q = g.quests[i];
          const current = !q && i === g.questIndex && g.phase !== "ended" && g.phase !== "assassin";
          return (
            <li key={i} className={`av-quest ${q ? (q.success ? "ok" : "fail") : ""} ${current ? "current" : ""}`}>
              <span className="av-quest-main">{q ? (q.success ? "✔" : "✘") : size}</span>
              <span className="av-quest-sub">
                {q ? (q.fails ? `${q.fails} 失败` : "全成功") : g.failsNeeded[i]! > 1 ? "需 2 失败" : `${size} 人`}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="av-rejects" title="同一个任务连续 5 次组队被否决，坏人获胜">
        <span>组队否决</span>
        {Array.from({ length: AVALON_MAX_REJECTS }, (_, i) => (
          <span key={i} className={`av-reject-dot ${i < g.rejects ? "on" : ""} ${i === AVALON_MAX_REJECTS - 1 ? "last" : ""}`} />
        ))}
      </div>
    </div>
  );
}

export function Avalon({ room, me, actions }: GameProps) {
  const g = room.game as AvalonView;
  const { error, run } = useRun();
  const [picked, setPicked] = useState<string[]>([]);
  const { fx, shaking, confetti } = useGameEffects(g, me);

  const name = (id?: string | null) => (id === me ? "你" : nameOf(room, id));
  const plain = (id?: string | null) => nameOf(room, id);
  const names = (ids: string[]) => ids.map((id) => plain(id)).join("、");
  const seat = (id: string) => g.order.indexOf(id) + 1;

  const myTeam = AVALON_ROLES[g.myRole].team;
  const isLeader = g.leaderId === me;
  const size = g.questSizes[g.questIndex] ?? 0;
  const onQuest = g.team.includes(me);
  const isAssassin = g.phase === "assassin" && g.assassinId === me;
  const lastVote = g.voteResults.at(-1);

  // 阶段变化时清掉本地选择
  const stage = `${g.phase}-${g.questIndex}-${g.rejects}`;
  useEffect(() => setPicked([]), [stage]);

  // 轮到自己做事时提示
  const needsMe =
    (g.phase === "team" && isLeader) ||
    (g.phase === "vote" && g.myVote === null) ||
    (g.phase === "quest" && onQuest && g.myQuestCard === null) ||
    isAssassin;
  const prevNeeds = useRef(false);
  useEffect(() => {
    if (needsMe && !prevNeeds.current) {
      sfx.myTurn();
      vibrate(60);
    }
    prevNeeds.current = needsMe;
  }, [needsMe]);

  let selectable: (id: string) => boolean = () => false;
  let maxPick = 0;
  if (g.phase === "team" && isLeader) {
    selectable = () => true;
    maxPick = size;
  } else if (isAssassin) {
    selectable = (id) => !g.evilIds?.includes(id);
    maxPick = 1;
  }
  const toggle = (id: string) => {
    if (picked.includes(id)) setPicked(picked.filter((x) => x !== id));
    else if (maxPick === 1) setPicked([id]);
    else if (picked.length < maxPick) setPicked([...picked, id]);
  };

  const act = (a: Parameters<typeof actions.act>[0]) => run(actions.act(a).then(() => setPicked([])));

  const questNo = g.questIndex + 1;
  const phaseTitle =
    g.phase === "ended"
      ? "游戏结束"
      : g.phase === "assassin"
        ? "🗡 刺杀"
        : `任务 ${questNo} · 第 ${g.rejects + 1} 次组队`;

  let status: string;
  if (g.phase === "ended") status = g.winner === "good" ? "⚔ 好人获胜！" : "🗡 坏人获胜！";
  else if (g.phase === "team")
    status = isLeader ? `👑 你是队长：挑 ${size} 个人去执行任务` : `👑 队长 ${plain(g.leaderId)} 正在挑 ${size} 个人…`;
  else if (g.phase === "vote") status = g.myVote === null ? "🗳 你同意这支队伍出征吗？" : "已投票，等其他人…";
  else if (g.phase === "quest")
    status = onQuest
      ? g.myQuestCard === null
        ? "📜 暗中交出你的任务牌"
        : "任务牌已交，等队友…"
      : `📜 ${names(g.team)} 正在执行任务…`;
  else status = isAssassin ? "🗡 你是刺客：和队友商量，指认谁是梅林" : `🗡 刺客 ${plain(g.assassinId)} 正在寻找梅林…`;

  return (
    <>
      <FxLayer fx={fx} shards={EVIL_SHARDS} />
      {confetti && <Confetti chars={g.winner === "evil" ? EVIL_CONFETTI : GOOD_CONFETTI} />}

      <section className={`av-root ${g.phase === "assassin" ? "is-dark" : ""} ${shaking ? "fx-shake" : ""}`}>
        <div className="av-head">
          <h2>🏰 阿瓦隆</h2>
          <span className="av-phase">{phaseTitle}</span>
          <SoundToggle />
        </div>

        <RoleCard g={g} name={plain} />
        <QuestTrack g={g} />

        <p className={g.phase === "ended" ? "big av-end-text" : "av-status"}>{status}</p>

        <ul className="av-seats">
          {g.order.map((id) => {
            const can = selectable(id);
            const role = g.reveal?.[id];
            const evil = g.evilIds?.includes(id);
            const isPicked = picked.includes(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`av-seat ${can ? "can" : ""} ${isPicked ? "selected" : ""} ${g.team.includes(id) ? "on-team" : ""} ${
                    evil ? "evil" : ""
                  } ${g.assassinTargetId === id ? "stabbed" : ""}`}
                  disabled={!can}
                  onClick={() => toggle(id)}
                >
                  <span className="av-seat-no">{seat(id)}</span>
                  {id === g.leaderId && g.phase !== "ended" && g.phase !== "assassin" && (
                    <span className="av-seat-leader" title="队长">
                      👑
                    </span>
                  )}
                  <Avatar name={plain(id)} seed={id} size={40} />
                  <span className="av-seat-name">
                    {plain(id)}
                    {id === me && "（我）"}
                  </span>
                  <span className="av-seat-tags">
                    {role ? AVALON_ROLES[role].emoji : evil && "😈"}
                    {g.team.includes(id) && "🛡"}
                    {g.phase === "vote" && g.votedIds.includes(id) && "🗳"}
                    {g.phase === "quest" && g.questPlayedIds.includes(id) && "📜"}
                    {g.assassinTargetId === id && "🗡"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* ---------- 组队 ---------- */}
        {g.phase === "team" && isLeader && (
          <div className="av-panel">
            <p className="hint">
              点头像选人，可以选自己。已选 {picked.length}/{size}
            </p>
            <button
              type="button"
              disabled={picked.length !== size}
              onClick={() => act({ gameId: "avalon", type: "propose", teamIds: picked })}
            >
              🛡 {picked.length === size ? `提名 ${names(picked)}` : `还要选 ${size - picked.length} 人`}
            </button>
          </div>
        )}

        {/* ---------- 投票 ---------- */}
        {g.phase === "vote" && (
          <div className="av-panel">
            <p>
              队长 {plain(g.leaderId)} 提名：<strong>{names(g.team)}</strong>
            </p>
            <p className="hint">
              已投票 {g.votedIds.length}/{g.order.length}，全部投完后公开每个人的选择
              {g.rejects === AVALON_MAX_REJECTS - 1 && "。⚠ 这次再被否决，坏人直接获胜！"}
            </p>
            {g.myVote === null ? (
              <div className="av-actions">
                <button type="button" className="av-approve" onClick={() => act({ gameId: "avalon", type: "vote", approve: true })}>
                  👍 赞成
                </button>
                <button type="button" className="av-reject" onClick={() => act({ gameId: "avalon", type: "vote", approve: false })}>
                  👎 反对
                </button>
              </div>
            ) : (
              <p className="hint">你投了{g.myVote ? "👍 赞成" : "👎 反对"}</p>
            )}
          </div>
        )}

        {/* ---------- 任务 ---------- */}
        {g.phase === "quest" && (
          <div className="av-panel">
            <p className="hint">
              已交任务牌 {g.questPlayedIds.length}/{g.team.length}
              {g.failsNeeded[g.questIndex]! > 1 && "，这个任务要 2 张失败才算失败"}
            </p>
            {onQuest && g.myQuestCard === null && (
              <div className="av-cards">
                <button type="button" className="av-card success" onClick={() => act({ gameId: "avalon", type: "quest", success: true })}>
                  <span>🏆</span>成功
                </button>
                {myTeam === "evil" && (
                  <button type="button" className="av-card fail" onClick={() => act({ gameId: "avalon", type: "quest", success: false })}>
                    <span>💀</span>失败
                  </button>
                )}
              </div>
            )}
            {onQuest && g.myQuestCard !== null && <p className="hint">你交了{g.myQuestCard ? "成功" : "失败"}，别说出去</p>}
          </div>
        )}

        {/* ---------- 刺杀 ---------- */}
        {g.phase === "assassin" && (
          <div className="av-panel">
            <p>
              😈 坏人亮明身份：<strong>{names(g.evilIds ?? [])}</strong>
            </p>
            {isAssassin && (
              <button
                type="button"
                className="av-reject"
                disabled={picked.length !== 1}
                onClick={() => act({ gameId: "avalon", type: "assassinate", targetId: picked[0]! })}
              >
                🗡 {picked.length === 1 ? `刺杀 ${plain(picked[0])}` : "点一个你认为是梅林的人"}
              </button>
            )}
          </div>
        )}

        {/* ---------- 结束 ---------- */}
        {g.phase === "ended" && g.reveal && (
          <ul className="av-reveal">
            {g.order.map((id) => {
              const r = AVALON_ROLES[g.reveal![id]!];
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

        {lastVote && g.phase !== "ended" && (
          <div className="av-votes">
            <h3>
              任务 {lastVote.questIndex + 1} 第 {lastVote.attempt} 次组队：{lastVote.approved ? "✅ 通过" : "❌ 否决"}
            </h3>
            <p className="hint">
              队长 {plain(lastVote.leaderId)}，队伍 {names(lastVote.team)}
            </p>
            <ul>
              {g.order
                .filter((id) => id in lastVote.votes)
                .map((voter) => (
                  <li key={voter} className={lastVote.votes[voter] ? "yes" : "no"}>
                    {lastVote.votes[voter] ? "👍" : "👎"} {name(voter)}
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
                {e.text.replace("{players}", names(e.playerIds ?? [])).replace("{target}", plain(e.targetId))}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
