import { useState } from "react";
import type { NumberBombView } from "@party/shared";
import { nameOf, useRun, type GameProps } from "../ui";

export function NumberBomb({ room, me, actions }: GameProps) {
  const g = room.game as NumberBombView;
  const [value, setValue] = useState("");
  const { error, run } = useRun();
  const myTurn = g.phase === "playing" && g.currentPlayerId === me;

  const submit = () => {
    run(actions.act({ gameId: "numberBomb", type: "guess", value: Number(value) }).then(() => setValue("")));
  };

  return (
    <section>
      <h2>💣 数字炸弹</h2>
      {g.phase === "ended" ? (
        <p className="big">
          💥 {nameOf(room, g.loserId)} 猜中了炸弹 <strong>{g.bomb}</strong>！
        </p>
      ) : (
        <>
          <p className="big">
            {g.low + 1} ~ {g.high - 1}
          </p>
          <p className="hint">{myTurn ? "轮到你了！" : `等待 ${nameOf(room, g.currentPlayerId)} 猜数字…`}</p>
          {myTurn && (
            <div className="row">
              <input
                type="number"
                inputMode="numeric"
                value={value}
                min={g.low + 1}
                max={g.high - 1}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && value && submit()}
                autoFocus
              />
              <button disabled={!value} onClick={submit}>
                猜
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <ol className="history">
        {g.history.map((h, i) => (
          <li key={i}>
            {nameOf(room, h.playerId)}：{h.guess}
          </li>
        ))}
      </ol>
    </section>
  );
}
