import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SoundToggle } from "../fx";
import { sfx, vibrate } from "../sound";
import {
  SPREADS,
  SUITS,
  TAROT_DECK,
  TOPICS,
  cardReading,
  summarize,
  type DrawnCard,
  type SpreadId,
  type TarotTopic,
} from "./tarotData";
import "./Tarot.css";

const HISTORY_KEY = "party.solo.tarot.history";
const HISTORY_LIMIT = 20;
/** 抽到逆位的概率 */
const REVERSED_CHANCE = 0.4;
const SHUFFLE_MS = 1600;
const ROWS = 3;

interface Reading {
  time: number;
  topic: TarotTopic;
  spread: SpreadId;
  question: string;
  cards: DrawnCard[];
}

function loadHistory(): Reading[] {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Reading[];
    return Array.isArray(list) ? list.filter((r) => r && Array.isArray(r.cards) && r.spread in SPREADS && r.topic in TOPICS) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: Reading[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)));
}

function random(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}

function shuffledDeck(): DrawnCard[] {
  const ids = TAROT_DECK.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids.map((id) => ({ id, reversed: random() < REVERSED_CHANCE }));
}

function formatTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CardFront({ id, reversed }: DrawnCard) {
  const card = TAROT_DECK[id]!;
  const suit = card.suit ? SUITS[card.suit] : null;
  return (
    <span
      className={`tr-face ${suit ? "minor" : "major"}`}
      style={suit ? ({ "--suit": suit.color } as CSSProperties) : undefined}
    >
      <span className={`tr-face-inner ${reversed ? "rev" : ""}`}>
        <span className="tr-face-label">{card.label}</span>
        <span className="tr-face-symbol">{card.symbol}</span>
        <span className="tr-face-name">{card.name}</span>
        <span className="tr-face-en">{card.en}</span>
      </span>
    </span>
  );
}

function FlipCard({ drawn, flipped, onFlip, delay = 0 }: { drawn: DrawnCard; flipped: boolean; onFlip?: () => void; delay?: number }) {
  return (
    <button
      type="button"
      className={`tr-flip ${flipped ? "flipped" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
      onClick={onFlip}
      disabled={flipped || !onFlip}
      aria-label={flipped ? TAROT_DECK[drawn.id]!.name : "翻开这张牌"}
    >
      <span className="tr-flip-inner">
        <span className="tr-back" />
        <CardFront {...drawn} />
      </span>
    </button>
  );
}

type Phase = "setup" | "shuffle" | "pick" | "reveal";

export function Tarot({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [topic, setTopic] = useState<TarotTopic>("general");
  const [spreadId, setSpreadId] = useState<SpreadId>("three");
  const [question, setQuestion] = useState("");
  const [deck, setDeck] = useState<DrawnCard[]>([]);
  /** 抽中的是 deck 里的第几张 */
  const [picked, setPicked] = useState<number[]>([]);
  const [flipped, setFlipped] = useState<boolean[]>([]);
  const [history, setHistory] = useState<Reading[]>(loadHistory);
  /** 正在看的是历史记录（全部翻开，不再保存） */
  const [viewing, setViewing] = useState<Reading | null>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const spread = SPREADS[viewing?.spread ?? spreadId];
  const need = spread.positions.length;
  const drawn: DrawnCard[] = viewing ? viewing.cards : picked.map((i) => deck[i]!);
  const shownTopic = viewing?.topic ?? topic;
  const shownQuestion = viewing ? viewing.question : question.trim();
  const allFlipped = viewing !== null || (drawn.length === need && flipped.length === need && flipped.every(Boolean));

  const start = () => {
    setViewing(null);
    setDeck(shuffledDeck());
    setPicked([]);
    setFlipped([]);
    setPhase("shuffle");
    sfx.shuffle();
    timer.current = setTimeout(() => {
      sfx.shuffle();
      setPhase("pick");
    }, SHUFFLE_MS);
  };

  const pick = (i: number) => {
    if (picked.includes(i) || picked.length >= need) return;
    sfx.pick();
    vibrate(20);
    const next = [...picked, i];
    setPicked(next);
    if (next.length === need) {
      timer.current = setTimeout(() => {
        setFlipped(Array.from({ length: need }, () => false));
        setPhase("reveal");
      }, 500);
    }
  };

  const flip = (slot: number) => {
    sfx.flip();
    setFlipped((f) => f.map((v, i) => (i === slot ? true : v)));
  };
  const flipAll = () => {
    sfx.flip();
    setFlipped((f) => f.map(() => true));
  };

  // 全部翻开后保存到历史记录
  const saved = useRef(false);
  useEffect(() => {
    if (phase !== "reveal" || viewing || !allFlipped || saved.current) return;
    saved.current = true;
    sfx.seeFuture();
    const reading: Reading = { time: Date.now(), topic, spread: spreadId, question: question.trim(), cards: drawn };
    const list = [reading, ...history].slice(0, HISTORY_LIMIT);
    setHistory(list);
    saveHistory(list);
    timer.current = setTimeout(() => readingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFlipped, phase, viewing]);
  useEffect(() => {
    if (phase === "shuffle") saved.current = false;
  }, [phase]);

  const openHistory = (r: Reading) => {
    setViewing(r);
    setPhase("reveal");
  };
  const clearHistory = () => {
    if (!confirm("清空所有占卜记录？")) return;
    setHistory([]);
    saveHistory([]);
  };
  const backToSetup = () => {
    setViewing(null);
    setPhase("setup");
  };

  const rows = useMemo(() => {
    const per = Math.ceil(TAROT_DECK.length / ROWS);
    return Array.from({ length: ROWS }, (_, r) => Array.from({ length: Math.min(per, TAROT_DECK.length - r * per) }, (_, k) => r * per + k));
  }, []);

  return (
    <div className="tr-root">
      <div className="tr-stars" aria-hidden />
      <div className="tr-wrap">
        <header className="tr-bar">
          <button type="button" className="tr-link" onClick={phase === "setup" ? onExit : backToSetup}>
            ‹ {phase === "setup" ? "返回首页" : "重新开始"}
          </button>
          <SoundToggle />
        </header>

        {phase === "setup" && (
          <section className="tr-setup">
            <h1 className="tr-title">🔮 塔罗占卜</h1>
            <p className="tr-sub">TAROT · 78 张韦特塔罗</p>

            <h3 className="tr-h">想问什么方面</h3>
            <div className="tr-options four">
              {(Object.keys(TOPICS) as TarotTopic[]).map((t) => (
                <button key={t} type="button" className={`tr-option ${topic === t ? "on" : ""}`} onClick={() => setTopic(t)}>
                  <span className="tr-option-emoji">{TOPICS[t].emoji}</span>
                  {TOPICS[t].name}
                </button>
              ))}
            </div>

            <h3 className="tr-h">选一个牌阵</h3>
            <div className="tr-spreads">
              {(Object.keys(SPREADS) as SpreadId[]).map((id) => (
                <button key={id} type="button" className={`tr-spread ${spreadId === id ? "on" : ""}`} onClick={() => setSpreadId(id)}>
                  <span className="tr-spread-name">
                    {SPREADS[id].name} <span className="tr-spread-n">{SPREADS[id].positions.length} 张</span>
                  </span>
                  <span className="tr-spread-desc">{SPREADS[id].desc}</span>
                </button>
              ))}
            </div>

            <h3 className="tr-h">在心里默念你的问题（可以写下来）</h3>
            <input
              className="tr-question"
              value={question}
              maxLength={40}
              placeholder="比如：这次面试顺利吗？"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
            />

            <button type="button" className="tr-btn" onClick={start}>
              ✨ 开始洗牌
            </button>

            {history.length > 0 && (
              <div className="tr-history">
                <div className="tr-history-head">
                  <h3 className="tr-h">最近的占卜</h3>
                  <button type="button" className="tr-link small" onClick={clearHistory}>
                    清空
                  </button>
                </div>
                <ul>
                  {history.map((r) => (
                    <li key={r.time}>
                      <button type="button" onClick={() => openHistory(r)}>
                        <span className="tr-history-time">{formatTime(r.time)}</span>
                        <span className="tr-history-q">
                          {TOPICS[r.topic].emoji} {r.question || `${TOPICS[r.topic].name} · ${SPREADS[r.spread].name}`}
                        </span>
                        <span className="tr-history-cards">
                          {r.cards.map((c) => TAROT_DECK[c.id]?.name + (c.reversed ? "(逆)" : "")).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="tr-disclaimer">牌义仅供娱乐参考，重要的决定还是要靠你自己 ✨</p>
          </section>
        )}

        {phase === "shuffle" && (
          <section className="tr-shuffle">
            <div className="tr-shuffle-stack">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="tr-back" style={{ "--i": i } as CSSProperties} />
              ))}
            </div>
            <p className="tr-sub">正在洗牌……默念你的问题</p>
          </section>
        )}

        {phase === "pick" && (
          <section className="tr-pick">
            <h2 className="tr-h center">
              凭直觉抽 {need} 张牌（{picked.length}/{need}）
            </h2>
            {shownQuestion && <p className="tr-sub center">“{shownQuestion}”</p>}
            <div className="tr-fan">
              {rows.map((row, r) => (
                <div key={r} className="tr-fan-row">
                  {row.map((i) => (
                    <button
                      key={i}
                      type="button"
                      className={`tr-fan-card ${picked.includes(i) ? "taken" : ""}`}
                      style={{ "--k": (i % row.length) - row.length / 2, animationDelay: `${(i % row.length) * 15}ms` } as CSSProperties}
                      onClick={() => pick(i)}
                      aria-label={`第 ${i + 1} 张`}
                    >
                      <span className="tr-back" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="tr-slots preview">
              {spread.positions.map((p, i) => (
                <span key={p.name} className={`tr-slot ${i < picked.length ? "filled" : ""}`}>
                  {i < picked.length ? <span className="tr-back" /> : p.name}
                </span>
              ))}
            </div>
          </section>
        )}

        {phase === "reveal" && (
          <section className="tr-reveal">
            <h2 className="tr-h center">
              {TOPICS[shownTopic].emoji} {TOPICS[shownTopic].name} · {spread.name}
            </h2>
            {shownQuestion && <p className="tr-sub center">“{shownQuestion}”</p>}
            {viewing && <p className="tr-sub center">{formatTime(viewing.time)} 的占卜记录</p>}

            <div className={`tr-spread-cards n${need}`}>
              {drawn.map((d, i) => (
                <div key={i} className="tr-pos">
                  <FlipCard drawn={d} flipped={viewing !== null || !!flipped[i]} onFlip={viewing ? undefined : () => flip(i)} delay={i * 120} />
                  <span className="tr-pos-name">{spread.positions[i]!.name}</span>
                  {(viewing !== null || flipped[i]) && <span className={`tr-pos-orient ${d.reversed ? "rev" : ""}`}>{d.reversed ? "逆位" : "正位"}</span>}
                </div>
              ))}
            </div>

            {!allFlipped && (
              <>
                <p className="tr-sub center">点一下牌翻开它</p>
                <button type="button" className="tr-link center-block" onClick={flipAll}>
                  全部翻开
                </button>
              </>
            )}

            {allFlipped && (
              <div className="tr-reading" ref={readingRef}>
                {drawn.map((d, i) => {
                  const card = TAROT_DECK[d.id]!;
                  const pos = spread.positions[i]!;
                  return (
                    <article key={i} className="tr-read-card" style={{ animationDelay: `${i * 120}ms` }}>
                      <div className="tr-read-head">
                        <span className="tr-read-pos">{pos.name}</span>
                        <span className="tr-read-name">
                          {card.symbol} {card.name}
                          <span className={`tr-read-orient ${d.reversed ? "rev" : ""}`}>{d.reversed ? "逆位" : "正位"}</span>
                        </span>
                      </div>
                      <p className="tr-read-hint">{pos.hint}</p>
                      <p className="tr-read-kw">{d.reversed ? card.keywordsRev : card.keywordsUp}</p>
                      {cardReading(card, d.reversed, shownTopic).map((line, k) => (
                        <p key={k} className="tr-read-line">
                          {line}
                        </p>
                      ))}
                    </article>
                  );
                })}
                <article className="tr-read-card summary">
                  <div className="tr-read-head">
                    <span className="tr-read-name">🌙 整体解读</span>
                  </div>
                  {summarize(drawn).map((line, k) => (
                    <p key={k} className="tr-read-line">
                      {line}
                    </p>
                  ))}
                </article>
                <button type="button" className="tr-btn" onClick={backToSetup}>
                  🔮 再占一次
                </button>
                <button type="button" className="tr-btn ghost" onClick={onExit}>
                  返回首页
                </button>
                <p className="tr-disclaimer">牌义仅供娱乐参考，重要的决定还是要靠你自己 ✨</p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
