import { useState } from "react";
import { UNDERCOVER_MAX_DESCRIPTION, type UndercoverView } from "@party/shared";
import { nameOf, useRun, type GameProps } from "../ui";

export function Undercover({ room, me, actions }: GameProps) {
  const g = room.game as UndercoverView;
  const [text, setText] = useState("");
  const [showWord, setShowWord] = useState(false);
  const { error, run } = useRun();

  const alive = g.alive.includes(me);
  const lastResult = g.results.at(-1);
  const rounds = [...new Set(g.descriptions.map((d) => d.round))].reverse();

  const describe = () =>
    run(actions.act({ gameId: "undercover", type: "describe", text }).then(() => setText("")));
  const vote = (targetId: string) => run(actions.act({ gameId: "undercover", type: "vote", targetId }));

  return (
    <section>
      <h2>🕵️ 谁是卧底 · 第 {g.round} 轮</h2>

      <button className="word" onClick={() => setShowWord((v) => !v)}>
        {showWord ? `你的词：${g.myWord}` : "点击查看我的词（注意别让别人看到）"}
      </button>
      {!alive && g.phase !== "ended" && <p className="hint">你已出局，可以继续观战</p>}

      {lastResult && g.phase !== "ended" && (
        <p className="hint">
          上一轮：{lastResult.eliminatedId ? `${nameOf(room, lastResult.eliminatedId)} 被投出局` : "平票，无人出局"}
        </p>
      )}

      {g.phase === "describe" && (
        <>
          <p className="hint">
            {g.currentSpeakerId === me ? "轮到你描述了" : `等待 ${nameOf(room, g.currentSpeakerId)} 描述…`}
          </p>
          {g.currentSpeakerId === me && (
            <div className="row">
              <input
                value={text}
                maxLength={UNDERCOVER_MAX_DESCRIPTION}
                placeholder="用一句话描述你的词"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && text.trim() && describe()}
                autoFocus
              />
              <button disabled={!text.trim()} onClick={describe}>
                发送
              </button>
            </div>
          )}
        </>
      )}

      {g.phase === "vote" && (
        <>
          <p className="hint">
            投票阶段：已投 {g.votedPlayerIds.length}/{g.alive.length}
            {alive && g.votedPlayerIds.includes(me) && "，等待其他人…"}
          </p>
          {alive && !g.votedPlayerIds.includes(me) && (
            <div className="vote-list">
              {g.alive
                .filter((id) => id !== me)
                .map((id) => (
                  <button key={id} onClick={() => vote(id)}>
                    投 {nameOf(room, id)}
                  </button>
                ))}
            </div>
          )}
        </>
      )}

      {g.phase === "ended" && g.reveal && (
        <div className="result">
          <p className="big">{g.winner === "civilian" ? "🎉 平民获胜！" : "🕵️ 卧底获胜！"}</p>
          <p>
            平民词：<strong>{g.reveal.civilianWord}</strong>，卧底词：<strong>{g.reveal.undercoverWord}</strong>
          </p>
          <p>
            卧底：
            {Object.entries(g.reveal.roles)
              .filter(([, r]) => r === "undercover")
              .map(([id]) => nameOf(room, id))
              .join("、")}
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {rounds.map((r) => (
        <div key={r} className="history">
          <h3>第 {r} 轮描述</h3>
          <ul>
            {g.descriptions
              .filter((d) => d.round === r)
              .map((d) => (
                <li key={d.playerId}>
                  <strong>{nameOf(room, d.playerId)}</strong>：{d.text}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
