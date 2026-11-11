/** 初始层数，每层 3 根木块，相邻两层方向互相垂直 */
export const JENGA_LAYERS = 18;
export const JENGA_PER_LAYER = 3;

/**
 * 塔的状态：layers[0] 是最底层；每层 3 个槽位，存木块 id，被抽走的槽位为 null。
 * 偶数层木块沿 x 轴摆放，奇数层沿 z 轴摆放。
 */
export type JengaLayers = (number | null)[][];

export interface JengaSlot {
  layer: number;
  pos: number;
}

/** 一层抽掉某些木块后的危险度：0 = 稳稳的，1 = 必倒 */
export function jengaLayerRisk(slots: (number | null)[]): number {
  const [a, b, c] = slots.map((s) => s !== null);
  const n = Number(a) + Number(b) + Number(c);
  if (n === 3) return 0;
  if (n === 0) return 1;
  if (n === 1) return b ? 0.05 : 1; // 只剩中间还能立住，只剩一边必倒
  if (b) return 0.03; // 中间 + 一边
  return 0.02; // 两边
}

/** 最高的一层完整层的下标；它和它上面的层都不能抽 */
export function jengaTopCompleteLayer(layers: JengaLayers): number {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (layers[i]!.every((s) => s !== null)) return i;
  }
  return -1;
}

export function jengaCanPull(layers: JengaLayers, layer: number, pos: number): boolean {
  if (layer < 0 || layer >= jengaTopCompleteLayer(layers)) return false;
  return layers[layer]?.[pos] != null;
}

/**
 * 抽走 (layer, pos) 后倒塌的概率。
 * steadiness 是手稳程度（0~1，抽木块时的小游戏决定），越稳概率越低。
 * 规则：
 * - 抽完这一层只剩一边（或空了）必倒
 * - 被抽的层越靠下，上面压的越多，越危险
 * - 整座塔已经被抽空的地方越多、塔越高，整体越不稳
 */
export function jengaPullRisk(layers: JengaLayers, layer: number, pos: number, steadiness: number): number {
  const after = layers[layer]!.map((s, i) => (i === pos ? null : s));
  const own = jengaLayerRisk(after);
  if (own >= 1) return 1;

  const top = layers.length - 1;
  const load = 0.5 + 0.5 * ((top - layer) / Math.max(1, top));
  let fragility = 0;
  for (let i = 0; i < top; i++) if (i !== layer) fragility += jengaLayerRisk(layers[i]!);
  const height = Math.max(0, layers.length - JENGA_LAYERS) * 0.004;

  const s = Math.min(1, Math.max(0, steadiness));
  const hand = 0.4 + 1.6 * (1 - s);
  return Math.min(0.9, (0.01 + own * load + fragility * 0.15 + height) * hand);
}

/** 抽出的木块放到塔顶的哪个槽位：先放两边再放中间，放满一层再开新的一层 */
export function jengaNextTopSlot(layers: JengaLayers): JengaSlot {
  const top = layers.length - 1;
  const slots = layers[top]!;
  if (slots.every((s) => s !== null)) return { layer: top + 1, pos: 0 };
  for (const pos of [0, 2, 1]) if (slots[pos] === null) return { layer: top, pos };
  return { layer: top + 1, pos: 0 };
}

export type JengaEventKind = "pull" | "collapse" | "leave";

export interface JengaLogEntry {
  /** 单局内递增，前端据此识别新事件并播放动画 */
  seq: number;
  kind: JengaEventKind;
  playerId: string;
  blockId?: number;
  from?: JengaSlot;
  /** 成功抽出后放到的位置 */
  to?: JengaSlot;
  /** 手稳程度 0~1 */
  steadiness?: number;
  text: string;
}

export interface JengaCollapse {
  playerId: string;
  blockId: number;
  /** 被抽的木块原来的位置，从这一层开始往上倒 */
  layer: number;
  pos: number;
  /** 倒下的方向（弧度），所有人看到的一样 */
  angle: number;
}

export interface JengaView {
  gameId: "jenga";
  phase: "playing" | "ended";
  order: string[];
  currentPlayerId: string;
  layers: JengaLayers;
  /** 一共成功抽了几根，用来调节小游戏的速度 */
  pulls: number;
  /** 每个人成功抽了几根 */
  pullCounts: Record<string, number>;
  collapse: JengaCollapse | null;
  /** 推倒塔的人（输家） */
  loserId: string | null;
  log: JengaLogEntry[];
}

export type JengaAction = { gameId: "jenga"; type: "pull"; blockId: number; steadiness: number };
