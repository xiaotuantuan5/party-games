import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  BOMB_CAT_CARDS,
  BOMB_CAT_CAT_TYPES,
  type BombCatCardType,
  type BombCatLogEntry,
  type BombCatView,
} from "@party/shared";
import { Confetti, FxLayer, SoundToggle, useFreshCards, useFx } from "../fx";
import { sfx, vibrate } from "../sound";
import { nameOf, useRun, type GameProps } from "../ui";
import "./BombCat.css";

const isCat = (t: BombCatCardType) => (BOMB_CAT_CAT_TYPES as BombCatCardType[]).includes(t);
const cardLabel = (t: BombCatCardType) => `${BOMB_CAT_CARDS[t].emoji} ${BOMB_CAT_CARDS[t].name}`;

const CARD_SOUND: Partial<Record<BombCatCardType, () => void>> = {
  attack: sfx.attack,
  skip: sfx.skip,
  shuffle: sfx.shuffle,
  seeFuture: sfx.seeFuture,
  favor: sfx.favor,
};

/** 根据服务端下发的新事件播放音效和特效 */
function useGameEffects(g: BombCatView, me: string, name: (id?: string | null) => string) {
  const { fx, show, shaking, shake } = useFx();
  const [deckBump, setDeckBump] = useState(0);
  const [confetti, setConfetti] = useState(false);
  const lastSeq = useRef<number | null>(null);
  const prevWinner = useRef<string | null | undefined>(undefined);
  const wasMyTurn = useRef(false);

  const onEvent = (e: BombCatLogEntry) => {
    const who = e.playerId === me ? "你" : name(e.playerId);
    const target = e.targetId === me ? "你" : name(e.targetId);
    switch (e.kind) {
      case "draw":
        sfx.draw();
        setDeckBump((n) => n + 1);
        break;
      case "explode":
        sfx.explode();
        shake();
        setDeckBump((n) => n + 1);
        show({ kind: "explode", icon: "💥", text: e.playerId === me ? "你爆炸了！" : `${who} 爆炸了！` });
        if (e.playerId === me) vibrate([300, 100, 500]);
        break;
      case "defuse":
        sfx.defuse();
        setDeckBump((n) => n + 1);
        show({ kind: "success", icon: "🔧", text: `${who}拆除了炸弹猫！` });
        if (e.playerId === me) vibrate(150);
        break;
      case "placeBomb":
        sfx.placeBomb();
        show({ kind: "toast", icon: "🤫", text: `${who}把炸弹猫悄悄藏回了牌堆` });
        break;
      case "give":
        sfx.give();
        break;
      case "pair":
        sfx.steal();
        show({ kind: "toast", icon: BOMB_CAT_CARDS[e.card ?? "tacoCat"].emoji, text: `${who}从${target}手里偷走一张牌` });
        if (e.targetId === me) vibrate(80);
        break;
      case "play":
        (CARD_SOUND[e.card!] ?? sfx.play)();
        if (e.card === "attack") {
          show({
            kind: "toast",
            icon: "⚔️",
            text: e.targetId === me ? "你被攻击了！要连续进行 2 个回合" : `${who}攻击了${target}`,
          });
          if (e.targetId === me) {
            shake();
            vibrate(120);
          }
        } else if (e.card === "shuffle") {
          setDeckBump((n) => n + 1);
        }
        break;
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

  useEffect(() => {
    if (prevWinner.current === undefined) {
      prevWinner.current = g.winnerId;
      return;
    }
    if (g.winnerId && !prevWinner.current) {
      setConfetti(true);
      sfx.win();
    }
    prevWinner.current = g.winnerId;
  }, [g.winnerId]);

  // 只看“是不是我的回合”，等待索要 / 放炸弹时不重复提示
  const isMyTurn = g.phase === "playing" && g.currentPlayerId === me;
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) {
      sfx.myTurn();
      vibrate(60);
    }
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  return { fx, shaking, deckBump, confetti };
}

const CAT_SHARDS = ["🔥", "💥", "✨", "🐱"];
const CAT_CONFETTI = ["🎉", "✨", "🐱", "🎊", "⭐"];

function Card({
  cardType,
  className = "",
  ...rest
}: { cardType: BombCatCardType } & Omit<ComponentProps<"button">, "type">) {
  return (
    <button
      type="button"
      className={`bc-card t-${cardType} ${className}`}
      title={BOMB_CAT_CARDS[cardType].description}
      {...rest}
    >
      <span className="bc-card-emoji">{BOMB_CAT_CARDS[cardType].emoji}</span>
      <span className="bc-card-name">{BOMB_CAT_CARDS[cardType].name}</span>
    </button>
  );
}

export function BombCat({ room, me, actions }: GameProps) {
  const g = room.game as BombCatView;
  const { error, run } = useRun();
  const [selected, setSelected] = useState<number[]>([]);
  const [target, setTarget] = useState("");
  const [position, setPosition] = useState(1);

  const name = (id?: string | null) => nameOf(room, id);
  const { fx, shaking, deckBump, confetti } = useGameEffects(g, me, name);
  const fresh = useFreshCards(g.myHand);

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

  const danger = g.deckCount > 0 ? g.bombCount / g.deckCount : 0;
  const dangerLevel = danger >= 0.34 ? "high" : danger >= 0.15 ? "mid" : "low";
  const lastDiscardSeq = [...g.log].reverse().find((e) => e.kind !== "draw" && e.kind !== "give" && e.kind !== "placeBomb")?.seq ?? 0;

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
  if (g.phase === "ended") status = g.winnerId === me ? "🏆 你活到了最后，获胜！" : `🏆 ${name(g.winnerId)} 活到了最后，获胜！`;
  else if (g.pending?.type === "favor")
    status = favorFromMe
      ? `🙏 ${name(g.pending.fromId)} 向你索要一张牌，点一张手牌给他`
      : `等待 ${name(g.pending.toId)} 给 ${name(g.pending.fromId)} 一张牌…`;
  else if (g.pending?.type === "defuse")
    status = placingBomb ? "🤫 选择把炸弹猫放回牌堆的位置" : `${name(g.pending.playerId)} 正在把炸弹猫藏回牌堆…`;
  else if (myTurn)
    status = g.turnsLeft > 1 ? `轮到你了（被攻击，还剩 ${g.turnsLeft} 个回合）` : "轮到你了：可以先出牌，最后摸一张牌结束回合";
  else status = `等待 ${name(g.currentPlayerId)} 行动…`;

  return (
    <>
      <FxLayer fx={fx} shards={CAT_SHARDS} />
      {confetti && <Confetti chars={CAT_CONFETTI} />}

      <section className={`bc-root ${shaking ? "fx-shake" : ""}`}>
        <div className="bc-head">
          <h2>🐱 炸弹猫</h2>
          <SoundToggle />
        </div>

        <div className="bc-table">
          <div className="bc-pile-wrap">
            <div key={deckBump} className={`bc-pile bc-deck ${deckBump ? "bump" : ""}`}>
              <span className="bc-pile-count">{g.deckCount}</span>
            </div>
            <span className="bc-pile-label">牌堆</span>
          </div>
          <div className="bc-pile-wrap">
            <div key={lastDiscardSeq} className={`bc-pile bc-discard ${g.discardTop ? `has t-${g.discardTop} pop` : ""}`}>
              {g.discardTop ? (
                <>
                  <span className="bc-card-emoji">{BOMB_CAT_CARDS[g.discardTop].emoji}</span>
                  <span className="bc-card-name">{BOMB_CAT_CARDS[g.discardTop].name}</span>
                </>
              ) : (
                "空"
              )}
            </div>
            <span className="bc-pile-label">弃牌堆</span>
          </div>
        </div>

        {g.phase === "playing" && (
          <div className={`bc-danger ${dangerLevel}`}>
            💣 牌堆里还有 {g.bombCount} 只炸弹猫，下一张摸到的概率约 {Math.round(danger * 100)}%
            <div className="bc-danger-bar">
              <div className="bc-danger-fill" style={{ width: `${Math.max(4, danger * 100)}%` }} />
            </div>
          </div>
        )}

        <ul className="bc-players">
          {g.order.map((id) => {
            const current = id === g.currentPlayerId && g.phase === "playing";
            const out = !g.alive.includes(id);
            return (
              <li key={id} className={`${out ? "out" : ""} ${current ? "current" : ""} ${id === g.winnerId ? "winner" : ""}`}>
                {out ? "💥 " : current ? "👉 " : id === g.winnerId ? "🏆 " : ""}
                {name(id)}
                {id === me && "（我）"} · 🃏{g.handCounts[id] ?? 0}
                {current && g.turnsLeft > 1 && ` ×${g.turnsLeft}`}
              </li>
            );
          })}
        </ul>

        <p className={g.phase === "ended" ? "big bc-win-text" : "hint bc-status"}>{status}</p>
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
            <div>🔮 牌堆顶（从上到下），只有你能看到：</div>
            <div className="bc-future-cards">
              {g.future.map((t, i) => (
                <span
                  key={`${g.future!.length}-${i}`}
                  className={`bc-card mini t-${t} bc-flip`}
                  style={{ animationDelay: `${i * 0.15}s` }}
                >
                  <span className="bc-card-emoji">{BOMB_CAT_CARDS[t].emoji}</span>
                  <span className="bc-card-name">{BOMB_CAT_CARDS[t].name}</span>
                </span>
              ))}
            </div>
            {g.future[0] === "bomb" && <div className="bc-warn">⚠️ 下一张就是炸弹猫！</div>}
          </div>
        )}

        {alive && (
          <>
            <h3>我的手牌</h3>
            <div className="bc-hand">
              {hand.map((c) => {
                const order = fresh.get(c.id);
                return (
                  <Card
                    key={c.id}
                    cardType={c.type}
                    className={`${selected.includes(c.id) ? "selected" : ""} ${order !== undefined ? "deal" : ""} ${favorFromMe ? "giveable" : ""}`}
                    style={order !== undefined ? { animationDelay: `${order * 70}ms` } : undefined}
                    disabled={!myTurn && !favorFromMe}
                    onClick={() => toggle(c.id)}
                  />
                );
              })}
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
                        {name(id)}（{g.handCounts[id]} 张）
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
                  <button className={`bc-draw ready ${dangerLevel === "high" ? "danger" : ""}`} onClick={draw}>
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
          {g.log.slice(-8).reverse().map((e) => (
            <li key={e.seq} className={`bc-log-${e.kind}`}>
              <strong>{name(e.playerId)}</strong> {e.text.replace("{target}", name(e.targetId))}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
