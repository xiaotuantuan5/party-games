import type { GameAction, GameMeta, GameView, PlayerInfo, QuestMove } from "@party/shared";

/** 游戏规则抛出的、可直接展示给玩家的错误 */
export class GameError extends Error {}

/**
 * 每个游戏实现这个接口即可接入房间系统。
 * 服务端是唯一可信的状态源：客户端只发 action，服务端校验后更新状态，
 * 再通过 viewFor 给每个玩家生成“只含自己可见信息”的视图。
 */
export interface GameEngine<S, A extends GameAction = GameAction, V extends GameView = GameView> {
  meta: GameMeta;
  setup(players: PlayerInfo[]): S;
  /** 校验并执行动作，非法动作抛 GameError。直接修改 state。 */
  handleAction(state: S, playerId: string, action: A): void;
  viewFor(state: S, playerId: string): V;
  /** 玩家中途退出房间时调用。返回 false 表示游戏无法继续，房间回到大厅。 */
  removePlayer(state: S, playerId: string): boolean;
  /**
   * 可选：实时游戏的高频位置上报。返回 null 表示丢弃；
   * relay 是校验过的数据，转发给其他人；changed 表示离散状态变了，需要给所有人推送一次完整视图。
   */
  move?(state: S, playerId: string, data: unknown): { relay: QuestMove; changed: boolean } | null;
  /**
   * 可选：随时间推进的游戏（比如工位摸鱼）。房间每 TICK_MS 调用一次，
   * 返回 true 表示状态变了，需要给所有人推送视图。
   */
  tick?(state: S): boolean;
}

/** 有 tick 的游戏多久结算一次 */
export const TICK_MS = 1000;

// 房间层不关心具体游戏的状态类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameEngine = GameEngine<any, any, any>;

export function randomInt(minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1));
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
