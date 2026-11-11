export type BombCatCatType = "tacoCat" | "beardCat" | "rainbowCat" | "potatoCat" | "melonCat";

export type BombCatCardType =
  | "bomb"
  | "defuse"
  | "attack"
  | "skip"
  | "favor"
  | "shuffle"
  | "seeFuture"
  | BombCatCatType;

export interface BombCatCard {
  id: number;
  type: BombCatCardType;
}

export const BOMB_CAT_CAT_TYPES: BombCatCatType[] = ["tacoCat", "beardCat", "rainbowCat", "potatoCat", "melonCat"];

export const BOMB_CAT_CARDS: Record<BombCatCardType, { name: string; emoji: string; description: string }> = {
  bomb: { name: "炸弹猫", emoji: "💣", description: "摸到就爆炸出局，除非你有拆除牌。" },
  defuse: { name: "拆除", emoji: "🔧", description: "摸到炸弹猫时自动使用，然后把炸弹猫悄悄放回牌堆任意位置。" },
  attack: { name: "攻击", emoji: "⚔️", description: "结束你的回合且不摸牌，下一位玩家要连续进行 2 个回合。" },
  skip: { name: "跳过", emoji: "⏭️", description: "结束一个回合且不摸牌。" },
  favor: { name: "索要", emoji: "🙏", description: "指定一位玩家，他必须挑一张手牌给你。" },
  shuffle: { name: "洗牌", emoji: "🔀", description: "把牌堆重新洗乱。" },
  seeFuture: { name: "预言", emoji: "🔮", description: "偷看牌堆顶的 3 张牌。" },
  tacoCat: { name: "卷饼猫", emoji: "🌮", description: "两张相同的猫咪牌一起打出，可以随机抽走一位玩家的一张手牌。" },
  beardCat: { name: "胡子猫", emoji: "🧔", description: "两张相同的猫咪牌一起打出，可以随机抽走一位玩家的一张手牌。" },
  rainbowCat: { name: "彩虹猫", emoji: "🌈", description: "两张相同的猫咪牌一起打出，可以随机抽走一位玩家的一张手牌。" },
  potatoCat: { name: "土豆猫", emoji: "🥔", description: "两张相同的猫咪牌一起打出，可以随机抽走一位玩家的一张手牌。" },
  melonCat: { name: "西瓜猫", emoji: "🍉", description: "两张相同的猫咪牌一起打出，可以随机抽走一位玩家的一张手牌。" },
};

export type BombCatEventKind = "draw" | "play" | "pair" | "give" | "defuse" | "explode" | "placeBomb" | "leave";

/** text 中的 {target} 由前端替换成 targetId 对应的昵称 */
export interface BombCatLogEntry {
  /** 单局内递增，前端据此识别新事件并播放动画和音效 */
  seq: number;
  kind: BombCatEventKind;
  /** play / pair 时打出的牌 */
  card?: BombCatCardType;
  playerId: string;
  targetId?: string;
  text: string;
}

export type BombCatPending =
  /** fromId 打出了索要，等待 toId 选一张牌给他 */
  | { type: "favor"; fromId: string; toId: string }
  /** playerId 拆除了炸弹猫，等待他选择放回的位置 */
  | { type: "defuse"; playerId: string };

export interface BombCatView {
  gameId: "bombCat";
  phase: "playing" | "ended";
  /** 座位顺序（包括已出局的玩家） */
  order: string[];
  alive: string[];
  currentPlayerId: string;
  /** 当前玩家还剩几个回合（被攻击时为 2） */
  turnsLeft: number;
  myHand: BombCatCard[];
  handCounts: Record<string, number>;
  deckCount: number;
  /** 牌堆里还剩几只炸弹猫。实体游戏里大家也能数出来，所以公开。 */
  bombCount: number;
  discardTop: BombCatCardType | null;
  pending: BombCatPending | null;
  /** 自己用“预言”看到的牌堆顶（从顶部开始） */
  future: BombCatCardType[] | null;
  log: BombCatLogEntry[];
  winnerId: string | null;
}

export type BombCatAction =
  /** 打出一张功能牌，或两张相同的猫咪牌。索要和猫咪对需要 targetId。 */
  | { gameId: "bombCat"; type: "play"; cardIds: number[]; targetId?: string }
  | { gameId: "bombCat"; type: "draw" }
  | { gameId: "bombCat"; type: "giveFavor"; cardId: number }
  /** position：0 表示牌堆顶，deckCount 表示牌堆底 */
  | { gameId: "bombCat"; type: "placeBomb"; position: number };
