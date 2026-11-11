import type { BombCatAction, BombCatView } from "./bombCat.js";
import type { JengaAction, JengaView } from "./jenga.js";
import type { LiarsBarAction, LiarsBarView } from "./liarsBar.js";
import type { NumberBombAction, NumberBombView } from "./numberBomb.js";
import type { UndercoverAction, UndercoverView } from "./undercover.js";
import type { UnoAction, UnoView } from "./uno.js";

export * from "./bombCat.js";
export * from "./jenga.js";
export * from "./liarsBar.js";
export * from "./numberBomb.js";
export * from "./undercover.js";
export * from "./uno.js";

export type GameId = "numberBomb" | "undercover" | "bombCat" | "liarsBar" | "uno" | "jenga";

export interface GameMeta {
  id: GameId;
  name: string;
  emoji: string;
  /** 一句话卖点，显示在游戏卡片上 */
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** 一局大约多久 */
  duration: string;
  tags: string[];
  rules: string[];
  /** 卡片主色 */
  color: string;
}

export const GAMES: Record<GameId, GameMeta> = {
  uno: {
    id: "uno",
    name: "UNO",
    emoji: "🃏",
    tagline: "同色同数就能出，剩一张记得喊 UNO",
    description: "经典 UNO：跟颜色或数字出牌，用禁止、反转、+2、变色 +4 坑别人，第一个出完手牌的人获胜。",
    minPlayers: 2,
    maxPlayers: 10,
    duration: "10~20 分钟",
    tags: ["卡牌", "经典", "坑队友"],
    rules: [
      "每人 7 张牌，翻开一张作为起始牌。轮到你时，出一张和桌面同颜色、或同数字 / 同符号的牌。",
      "⊘ 禁止：下家跳过一回合。⇄ 反转：出牌方向反过来（2 人时相当于禁止）。+2：下家摸 2 张并跳过回合。",
      "★ 变色：任何时候都能出，并指定下一个颜色。+4：指定颜色，下家摸 4 张并跳过回合。",
      "没有能出的牌（或者不想出）就摸一张；摸到的牌能出可以马上打出，否则轮到下家。",
      "出倒数第二张牌时要点“UNO!”。剩 1 张没喊被别人抓到，罚摸 2 张；在下一个人行动前补喊也算数。",
      "第一个出完手牌的人获胜。本版本不能叠加 +2 / +4，也不能质疑 +4。",
    ],
    color: "#e8333a",
  },
  jenga: {
    id: "jenga",
    name: "层层叠",
    emoji: "🧱",
    tagline: "3D 木塔，手一抖就塌",
    description: "18 层木塔，大家轮流抽出一根木块放到塔顶。拖动可以转着看，抽的时候比拼手稳，推倒塔的人输。",
    minPlayers: 2,
    maxPlayers: 8,
    duration: "5~15 分钟",
    tags: ["3D", "手稳", "惩罚游戏"],
    rules: [
      "塔有 18 层，每层 3 根木块，相邻两层方向交错。单指拖动旋转视角，双指 / 滚轮缩放。",
      "轮到你时，点一根木块选中，再点“抽出”。抽出的木块会自动放到塔顶。",
      "最上面一层完整层和它上面的木块不能抽。",
      "抽的时候会出现一个来回摆动的指针，指针越靠近中间时按下，手越稳，越不容易塌。",
      "一层只剩一边的木块必倒；只剩中间一根还能撑住。越往下抽、塔越空越高，越容易塌。",
      "把塔推倒的人输，可以配合惩罚：表演节目、喝一杯、说一个秘密……",
    ],
    color: "#c8873a",
  },
  liarsBar: {
    id: "liarsBar",
    name: "骗子酒馆",
    emoji: "🍺",
    tagline: "睁眼说瞎话，输了就开枪",
    description: "每轮指定一种桌牌，大家轮流盖牌声称是桌牌。觉得上家在骗人就喊“骗子！”，说错的一方要玩俄罗斯轮盘。",
    minPlayers: 2,
    maxPlayers: 6,
    duration: "10~15 分钟",
    tags: ["吹牛", "心理战", "刺激"],
    rules: [
      "每轮随机指定一种桌牌（K、Q 或 A），每人发 5 张牌。🃏 王是万能牌，算作任何桌牌。",
      "轮到你时，盖着打出 1~3 张牌，并声称它们全是桌牌。可以说真话，也可以撒谎。",
      "下一位玩家可以接着出牌，也可以喊“骗子！”翻开上家的牌。",
      "牌里有不是桌牌的，上家撒谎，上家开枪；全是桌牌或王，喊错的人开枪。",
      "每人一把 6 发的左轮，里面只有 1 颗子弹，每次扣扳机都会更危险。中弹出局。",
      "有人开枪后，重新洗牌、换桌牌，开始新一轮。活到最后的人获胜。",
    ],
    color: "#b5651d",
  },
  bombCat: {
    id: "bombCat",
    name: "炸弹猫",
    emoji: "🐱",
    tagline: "摸到炸弹猫就爆炸",
    description: "轮流出牌、摸牌，摸到炸弹猫又没有拆除牌就出局。用攻击、跳过、预言等功能牌躲开炸弹，活到最后的人获胜。",
    minPlayers: 2,
    maxPlayers: 10,
    duration: "10~20 分钟",
    tags: ["卡牌", "运气", "坑队友"],
    rules: [
      "每人 7 张牌加 1 张拆除。牌堆里藏着（人数 − 1）只炸弹猫。",
      "回合内可以先出任意张功能牌，最后必须摸一张牌结束回合。",
      "摸到炸弹猫时自动用拆除化解，并把炸弹猫悄悄放回牌堆任意位置；没有拆除就出局。",
      "攻击：下家连续 2 回合。跳过：不摸牌。索要：让别人给你一张牌。洗牌：打乱牌堆。预言：偷看牌堆顶 3 张。",
      "两张相同的猫咪牌一起打出，可以随机抽走别人一张牌。",
      "活到最后的人获胜。",
    ],
    color: "#2cb67d",
  },
  numberBomb: {
    id: "numberBomb",
    name: "数字炸弹",
    emoji: "💣",
    tagline: "1~100，谁猜中谁爆炸",
    description: "系统在 1~100 中藏一个炸弹数字，大家轮流猜，范围不断缩小，猜中的人“爆炸”出局。",
    minPlayers: 2,
    maxPlayers: 12,
    duration: "3~5 分钟",
    tags: ["简单", "暖场", "惩罚游戏"],
    rules: [
      "系统在 1~100 中藏了一个炸弹数字。",
      "大家轮流在数字格子里点一个数，系统告诉所有人炸弹比它大还是小。",
      "范围越来越小，猜中炸弹的人输。",
      "适合配合惩罚：输的人表演节目、喝一杯、说一个秘密……",
    ],
    color: "#e53170",
  },
  undercover: {
    id: "undercover",
    name: "谁是卧底",
    emoji: "🕵️",
    tagline: "说得太像会暴露，说得太偏会被投",
    description: "平民拿到同一个词，卧底拿到相近的词。轮流描述、投票，找出卧底。",
    minPlayers: 4,
    maxPlayers: 12,
    duration: "10~15 分钟",
    tags: ["语言", "推理", "经典"],
    rules: [
      "平民拿到同一个词，卧底拿到一个相近的词（7 人及以上有 2 个卧底）。你不知道自己是不是卧底。",
      "每轮按顺序用一句话描述自己的词，不能直接说出这个词。",
      "所有人描述完后投票，得票最多的人出局；平票则本轮无人出局。",
      "卧底全部出局，平民获胜；卧底人数不少于平民，卧底获胜。",
    ],
    color: "#7f5af0",
  },
};

/** 首页展示顺序 */
export const GAME_ORDER: GameId[] = ["uno", "jenga", "liarsBar", "bombCat", "numberBomb", "undercover"];

export type GameView = NumberBombView | UndercoverView | BombCatView | LiarsBarView | UnoView | JengaView;
export type GameAction =
  | NumberBombAction
  | UndercoverAction
  | BombCatAction
  | LiarsBarAction
  | UnoAction
  | JengaAction;
