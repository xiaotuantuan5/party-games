import { useState } from "react";
import type { RoomView } from "@party/shared";
import type { PartyActions } from "./party";

/** 执行一个异步操作，把错误展示在界面上 */
export function useRun() {
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: Error) => setError(e.message));
  };
  return { error, run };
}

export interface GameProps {
  room: RoomView;
  me: string;
  actions: PartyActions;
}

export function nameOf(room: RoomView, id: string | null | undefined): string {
  return room.players.find((p) => p.id === id)?.name ?? "（已离开）";
}
