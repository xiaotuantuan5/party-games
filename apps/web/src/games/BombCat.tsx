import { useEffect, useMemo, useState } from "react";
import { BOMB_CAT_CARDS, BOMB_CAT_CAT_TYPES, type BombCatCardType, type BombCatView } from "@party/shared";
import { nameOf, useRun, type GameProps } from "../ui";

const isCat = (t: BombCatCardType) => (BOMB_CAT_CAT_TYPES as BombCatCardType[]).includes(t);
const cardLabel = (t: BombCatCardType) => `${BOMB_CAT_CARDS[t].emoji} ${BOMB_CAT_CARDS[t].name}`;

export function BombCat({ room, me, actions }: GameProps) {
  const g = room.game as BombCatView;
  const { error, run } = useRun();
  const [selected, setSelected] = useState<number[]>([]);
  const [target, setTarget] = useState("");
  const [position, setPosition] = useState(1);

  const alive = g.alive.includes(me);
  const myTurn = g.phase === "playing" && g.currentPlayerId === me && !g.pending;
  const favorFromMe = g.pending?.type === "favor" && g.pending.toId === me;
  const placingBomb = g.pending?.type === "defuse" && g.pending.playerId === me;

  const hand = useMemo(() => [...g.myHand].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id), [g.myHand]);

  // 手牌变化后去掉已经不在手里的选择
  useEffect(() => {
    setSelected((sel) => sel.filter((id) => g.myHand.some((c) => c.id === id)));
  }, [g.myHand]);

  const selectedTypes = selected.map((id) => g.myHand.find((c) => c.id === id)?.type).filter(Boolean) as BombCatCardType[];
  const first = selectedTypes[0];
  const playKind: "none" | "single" | "pair" | "invalid" =
    selectedTypes.length === 0
      ? "none"
      : selectedTypes.length === 1
        ? first === "defuse" || isCat(first!)
          ? "invalid"
          : "single"
        : selectedTypes.length === 2 && isCat(first!) && selectedTypes[1] === first
          ? "pair"
          : "invalid";
  const needsTarget = playKind === "pair" || (playKind === "single" && first === "favor");
  const targets = g.alive.filter((id) => id !== me && (g.handCounts[id] ?? 0) > 0);

  const toggle = (id: number) => {
    if (favorFromMe) {
      run(actions.act({ gameId: "bombCat", type: "giveFavor", cardId: id }));
      return;
    }
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(-2)));
  };

  const playSelected = () =>
    run(
      actions
        .act({ gameId: "bombCat", type: "play", cardIds: selected, targetId: needsTarget ? target : undefined })
        .then(() => setSelected([])),
    );
  const draw = () => run(actions.act({ gameId: "bombCat", type: "draw" }));
  const placeBomb = (pos: number) =>
    run(actions.act({ gameId: "bombCat", type: "placeBomb", position: pos }).then(() => setPosition(1)));

  let status: string;
  if (g.phase === "ended") status = `🏆 ${nameOf(room, g.winnerId)} 活到了最后，获胜！`;
  else if (g.pending?.type === "favor")
    status = favorFromMe
      ? `${nameOf(room, g.pending.fromId)} 向你索要一张牌，点一张手牌给他`
      : `等待 ${nameOf(room, g.pending.toId)} 给 ${nameOf(room, g.pending.fromId)} 一张牌…`;
  else if (g.pending?.type === "defuse")
    status = placingBomb ? "选择把炸弹猫放回牌堆的位置" : `${nameOf(room, g.pending.playerId)} 正在把炸弹猫放回牌堆…`;
  else if (myTurn) status = g.turnsLeft > 1 ? `轮到你了（被攻击，还剩 ${g.turnsLeft} 个回合）` : "轮到你了：可以先出牌，最后摸一张牌结束回合";
  else status = `等待 ${nameOf(room, g.currentPlayerId)} 行动…`;

  return (
    <section>
      <h2>🐱 炸弹猫</h2>

      <div className="bc-table">
        <span>🂠 牌堆 {g.deckCount} 张</span>
        <span>弃牌堆：{g.discardTop ? cardLabel(g.discardTop) : "空"}</span>
      </div>

      <ul className="bc-players">
        {g.order.map((id) => (
          <li
            key={id}
            className={`${g.alive.includes(id) ? "" : "out"} ${id === g.currentPlayerId && g.phase === "playing" ? "current" : ""}`}
          >
            {g.alive.includes(id) ? "" : "💥 "}
            {nameOf(room, id)}
            {id === me && "（我）"} · {g.handCounts[id] ?? 0} 张
          </li>
        ))}
      </ul>

      <p className={g.phase === "ended" ? "big" : "hint"}>{status}</p>
      {!alive && g.phase === "playing" && <p className="hint">你已出局，可以继续观战</p>}

      {placingBomb && (
        <div className="bc-place">
          <label>
            放在第几张（1 = 牌堆顶，{g.deckCount + 1} = 牌堆底）
            <input
              type="number"
              min={1}
              max={g.deckCount + 1}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          </label>
          <div className="row">
            <button onClick={() => placeBomb(position - 1)}>放回</button>
            <button className="secondary" onClick={() => placeBomb(0)}>
              顶部
            </button>
            <button className="secondary" onClick={() => placeBomb(g.deckCount)}>
              底部
            </button>
            <button className="secondary" onClick={() => placeBomb(Math.floor(Math.random() * (g.deckCount + 1)))}>
              随机
            </button>
          </div>
        </div>
      )}

      {g.future && g.future.length > 0 && (
        <div className="bc-future">
          🔮 牌堆顶（从上到下）：
          {g.future.map((t, i) => (
            <span key={i} className={`bc-card mini ${t === "bomb" ? "bomb" : ""}`}>
              {cardLabel(t)}
            </span>
          ))}
        </div>
      )}

      {alive && (
        <>
          <h3>我的手牌</h3>
          <div className="bc-hand">
            {hand.map((c) => (
              <button
                key={c.id}
                className={`bc-card ${selected.includes(c.id) ? "selected" : ""}`}
                title={BOMB_CAT_CARDS[c.type].description}
                disabled={!myTurn && !favorFromMe}
                onClick={() => toggle(c.id)}
              >
                {cardLabel(c.type)}
              </button>
            ))}
            {hand.length === 0 && <p className="hint">没有手牌</p>}
          </div>

          {first && myTurn && <p className="hint">{BOMB_CAT_CARDS[first].description}</p>}

          {myTurn && (
            <div className="bc-actions">
              {needsTarget && (
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">选择目标玩家</option>
                  {targets.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(room, id)}（{g.handCounts[id]} 张）
                    </option>
                  ))}
                </select>
              )}
              <div className="row">
                <button
                  disabled={playKind === "none" || playKind === "invalid" || (needsTarget && !target)}
                  onClick={playSelected}
                >
                  出牌
                </button>
                <button className="bc-draw" onClick={draw}>
                  摸牌（结束回合）
                </button>
              </div>
              {playKind === "invalid" && <p className="hint">只能出一张功能牌，或两张相同的猫咪牌</p>}
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      <ul className="history">
        {[...g.log].reverse().map((e, i) => (
          <li key={g.log.length - i}>
            <strong>{nameOf(room, e.playerId)}</strong> {e.text.replace("{target}", nameOf(room, e.targetId))}
          </li>
        ))}
      </ul>
    </section>
  );
}
