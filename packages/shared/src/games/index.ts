import type { AvalonAction, AvalonView } from "./avalon.js";
import type { BombCatAction, BombCatView } from "./bombCat.js";
import type { JengaAction, JengaView } from "./jenga.js";
import type { MidwayAction, MidwayView } from "./midway.js";
import type { MoyuAction, MoyuView } from "./moyu.js";
import type { LiarsBarAction, LiarsBarView } from "./liarsBar.js";
import type { NumberBombAction, NumberBombView } from "./numberBomb.js";
import type { QuestAction, QuestView } from "./quest.js";
import type { UndercoverAction, UndercoverView } from "./undercover.js";
import type { UnoAction, UnoView } from "./uno.js";
import type { WerewolfAction, WerewolfView } from "./werewolf.js";

export * from "./avalon.js";
export * from "./bombCat.js";
export * from "./jenga.js";
export * from "./liarsBar.js";
export * from "./midway.js";
export * from "./moyu.js";
export * from "./numberBomb.js";
export * from "./quest.js";
export * from "./undercover.js";
export * from "./uno.js";
export * from "./werewolf.js";

export type GameId = "numberBomb" | "undercover" | "bombCat" | "liarsBar" | "uno" | "jenga" | "werewolf" | "avalon" | "quest" | "midway" | "moyu";

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
  /** 本项目原创的玩法，卡片上标“原创” */
  original?: boolean;
}

export const GAMES: Record<GameId, GameMeta> = {
  moyu: {
    id: "moyu",
    name: "工位摸鱼",
    emoji: "🐟",
    tagline: "老板来查岗了！快升级隔板",
    description:
      "实时合作生存，玩法参考《猛鬼宿舍》。每人一个工位，坐着就能摸鱼赚钱，用来升级隔板、摸鱼装备和桌面炮台。老板开完早会就开始巡查敲隔板，撑到 18:00 下班就赢。",
    minPlayers: 5,
    maxPlayers: 8,
    duration: "约 6 分钟",
    tags: ["实时", "合作", "生存经营"],
    rules: [
      "每人分到一个工位。从 09:00 开始，每秒自动摸到 🐟 摸鱼币，装备越好摸得越多。整局约 5 分半，到 18:00 下班。",
      "前 30 秒老板在开早会，抓紧升级。之后老板会挑一个工位走过去（要走 4 秒，所有人都能看到他去哪），站在隔板前一直敲。",
      "隔板被敲烂，这个工位的人就被抓了，只能围观。老板接着找下一家；在一家敲了 30 秒还敲不开，也会换人。",
      "🪵 隔板：升级加耐久。💻 摸鱼装备：升级加收入。📎 桌面炮台：老板在你工位前时每秒打他，伤害随等级提升。",
      "🔧 修隔板：花钱恢复 30% 耐久，每人每 10 秒能修一次，可以帮同事修。",
      "☕ 递咖啡：老板在敲隔板时，任何人花 50 币请他喝咖啡，他会发呆 5 秒不敲（炮台照打），全场共用 30 秒冷却。",
      "老板每 40 秒升一级，越来越凶、血越来越厚。血量低于 30% 会回办公室喝茶回满血，一局最多回去 2 次，之后就硬刚到底。",
      "撑到 18:00 下班，或者用炮台把老板打到 0 血气走他，没被抓的人都赢；所有人都被抓，老板赢。",
    ],
    color: "#0f766e",
  },
  midway: {
    id: "midway",
    name: "不上不下",
    emoji: "⚖",
    tagline: "别当最多的，也别当最少的，小心那个 0",
    description:
      "原创心理战。每人一张数字牌，写 3 个数字，结算时自己的数字被写得最多或最少都算输。可以随便撒谎，也可以当场指认别人的牌。",
    minPlayers: 4,
    maxPlayers: 10,
    duration: "10~15 分钟",
    tags: ["原创", "心理战", "撒谎"],
    rules: [
      "发牌：0 一定会发出，其余每人从 1~9 里各拿一张不重复的牌，只有自己能看到。发出去的这些数字叫“在场数字”，所有统计只看它们。",
      "首轮：每人写 3 个不同的数字（0~9），必须包含自己的牌；拿到 0 的人可以不写 0。全部交完后公布在场数字里被写得最多和最少的数字。",
      "自由交流（建议 5 分钟）：可以声称自己是任何数字，可以撒谎，不能给别人看手机。大家都点“结束讨论”就进入修改。",
      "指认：交流期间随时可以指认某人的牌是几。指对：对方出局、亮牌和纸条（纸条照样计入统计），你可以私下问一个数字现在被写了几次。指错：你的纸条公开，指错 2 次直接失败。",
      "指认别人是 0 却指错了：除了公开纸条，被你指认的人还会挑你纸上一个数字改成 0（你已经写了 0 就不改）。",
      "修改：每个还在场的人可以把 3 个数字中的 1 个换掉，也可以把自己的牌号换掉。",
      "结算：统计在场数字最终被写了几次。自己的数字是最多的（并列也算）或最少的（并列也算，被写 0 次也算）就输；所有在场数字次数都一样时没有最多最少。",
      "0 的规则：没人写 0，拿 0 的人单独获胜，其他人全输。0 是唯一最多或唯一最少，拿 0 的人和所有写了 0 的人一起输。0 和别的数字并列最多或最少，所有写 0 的人和拿 0 的人都不算输。",
    ],
    color: "#c2410c",
    original: true,
  },
  avalon: {
    id: "avalon",
    name: "阿瓦隆",
    emoji: "🏰",
    tagline: "没有人出局，只有人在撒谎",
    description: "亚瑟的忠臣对抗莫德雷德的爪牙。队长组队、全员投票、出征任务，好人要完成 3 个任务，还得保护好梅林。",
    minPlayers: 5,
    maxPlayers: 10,
    duration: "30~45 分钟",
    tags: ["推理", "阵营", "全员在场"],
    rules: [
      "身份：好人有梅林、派西维尔和忠臣；坏人有刺客、莫甘娜，7 人起加莫德雷德，10 人加奥伯伦。5~6 人 2 坏，7~9 人 3 坏，10 人 4 坏。",
      "梅林看得到坏人（看不到莫德雷德）；派西维尔看得到梅林和莫甘娜，但分不清谁是谁；坏人互相认识（奥伯伦除外）。",
      "共 5 个任务，每个任务的出征人数在任务进度条上。队长挑人组队，然后所有人同时投票赞成或反对，过半数赞成才出发，否则换下一位当队长。",
      "同一个任务连续 5 次组队被否决，坏人直接获胜。",
      "出征的人暗中交任务牌：好人只能交成功，坏人可以交成功或失败。有 1 张失败任务就失败（7 人及以上第 4 个任务要 2 张失败）。只公布失败张数，不公布是谁。",
      "3 个任务失败，坏人获胜。3 个任务成功后，坏人亮明身份，由刺客指认一个人：刺中梅林坏人翻盘，否则好人获胜。",
      "没有人会出局，所有人从头玩到尾。白天随便讨论、带节奏、互相怀疑都可以。",
    ],
    color: "#1f4e79",
  },
  quest: {
    id: "quest",
    name: "秘境闯关",
    emoji: "⛩️",
    tagline: "3D 实时合作，一起穿过浮空岛",
    description:
      "卡通渲染的 3D 浮空岛冒险。大家同时在线、各自操控角色：跳石柱、一起踩机关打开结界、躲开史莱姆、从高台滑翔过深渊，全员到达神像就算通关。",
    minPlayers: 2,
    maxPlayers: 6,
    duration: "5~10 分钟",
    tags: ["3D", "实时合作", "闯关"],
    rules: [
      "左半边屏幕按住拖动是摇杆，右半边拖动转视角；电脑上用 WASD / 方向键移动，空格跳跃，鼠标拖动转视角。",
      "跳跃按钮在右下角。人在空中时再按一次跳跃，打开风之翼滑翔，再按一次收起。",
      "第一段：跳过石柱到第二座岛。岛上有两块机关石板，需要两个人同时站上去才能打开石桥上的结界。",
      "第二段：过桥后小心史莱姆，被撞到会被弹开。顺着石台跳上高台。",
      "第三段：从高台跳下并打开风之翼，滑翔到最后一座岛。掉下去会回到当前岛重来。",
      "所有人同时站进神像前的光圈就算通关。路上的星辉水晶捡得越多，评价越高。",
    ],
    color: "#2fb5a3",
  },
  werewolf: {
    id: "werewolf",
    name: "狼人杀",
    emoji: "🐺",
    tagline: "天黑请闭眼，狼人请睁眼",
    description: "简化版狼人杀：狼人、预言家、女巫、猎人、村民。手机代替法官，夜里各自在手机上行动，白天面对面讨论、投票。",
    minPlayers: 6,
    maxPlayers: 12,
    duration: "20~40 分钟",
    tags: ["推理", "阵营", "经典"],
    rules: [
      "身份：6 人 2 狼 + 预言家 + 女巫 + 2 村民；7 人起加猎人；8~10 人 3 狼；11~12 人 4 狼，其余是村民。狼人互相认识。",
      "夜晚：狼人一起选一个人刀（所有狼人选同一个人才算数），预言家查验一个人是好人还是狼人，然后女巫决定救人或毒人。",
      "女巫的解药和毒药各一瓶，同一晚只能用一瓶，不能自救。",
      "天亮公布昨晚死了谁（不说怎么死的）。大家按顺序发言，都点“准备投票”后开始投票。",
      "得票最多的人出局，平票或都弃票则无人出局。出局和夜里死的人不公开身份。",
      "猎人被刀死或被投出局时可以开枪带走一个人，被毒死不能开枪。",
      "狼人全部出局，好人胜；狼人数量不少于好人，狼人胜。死了的人不要说话哦。",
    ],
    color: "#3d348b",
  },
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
export const GAME_ORDER: GameId[] = ["moyu", "midway", "avalon", "quest", "werewolf", "uno", "jenga", "liarsBar", "bombCat", "numberBomb", "undercover"];

export type GameView = AvalonView | NumberBombView | UndercoverView | BombCatView | LiarsBarView | UnoView | JengaView | WerewolfView | QuestView | MidwayView | MoyuView;
export type GameAction =
  | AvalonAction
  | NumberBombAction
  | UndercoverAction
  | BombCatAction
  | LiarsBarAction
  | UnoAction
  | JengaAction
  | WerewolfAction
  | QuestAction
  | MidwayAction
  | MoyuAction;
