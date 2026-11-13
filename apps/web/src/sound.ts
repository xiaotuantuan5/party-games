/**
 * 用 Web Audio 实时合成的音效，不依赖音频文件。
 * 浏览器要求用户先和页面交互过才能出声，所以第一次点击 / 按键时初始化 AudioContext。
 */

const MUTE_KEY = "party.sound";

let ctx: AudioContext | null = null;
let muted = localStorage.getItem(MUTE_KEY) === "off";

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  localStorage.setItem(MUTE_KEY, value ? "off" : "on");
  if (!value) audio();
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const unlock = () => {
  audio();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

/** 手机震动（iOS Safari 不支持，会被忽略）。和音效共用一个开关。 */
export function vibrate(pattern: number | number[]): void {
  if (!muted && "vibrate" in navigator) navigator.vibrate(pattern);
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  slideTo?: number;
}

function tone(freq: number, dur: number, { type = "sine", gain = 0.2, delay = 0, slideTo }: ToneOpts = {}): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

interface NoiseOpts {
  gain?: number;
  delay?: number;
  filter?: BiquadFilterType;
  from?: number;
  to?: number;
}

function noise(dur: number, { gain = 0.3, delay = 0, filter = "lowpass", from = 8000, to = 200 }: NoiseOpts = {}): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
  src.stop(t + dur);
}

export const sfx = {
  /** 摸牌：纸牌摩擦声 */
  draw() {
    noise(0.09, { filter: "highpass", from: 3000, to: 1500, gain: 0.18 });
    tone(620, 0.06, { type: "triangle", gain: 0.08, delay: 0.03 });
  },
  /** 普通出牌 */
  play() {
    tone(240, 0.14, { type: "triangle", slideTo: 120, gain: 0.25 });
  },
  attack() {
    noise(0.28, { filter: "bandpass", from: 400, to: 3500, gain: 0.35 });
    tone(160, 0.25, { type: "square", slideTo: 60, gain: 0.12, delay: 0.05 });
  },
  skip() {
    tone(500, 0.12, { type: "triangle", slideTo: 1200, gain: 0.18 });
    tone(900, 0.12, { type: "triangle", slideTo: 1700, gain: 0.15, delay: 0.09 });
  },
  shuffle() {
    for (let i = 0; i < 9; i++) noise(0.04, { filter: "highpass", from: 2500, to: 1800, gain: 0.15, delay: i * 0.045 });
  },
  seeFuture() {
    [660, 880, 1320, 1760].forEach((f, i) => tone(f, 0.35, { gain: 0.1, delay: i * 0.07 }));
  },
  favor() {
    tone(880, 0.6, { gain: 0.15 });
    tone(1320, 0.5, { gain: 0.08, delay: 0.02 });
  },
  give() {
    tone(520, 0.1, { type: "triangle", gain: 0.15 });
    tone(780, 0.15, { type: "triangle", gain: 0.15, delay: 0.09 });
  },
  /** 猫咪对偷牌：喵 */
  steal() {
    tone(700, 0.15, { type: "sawtooth", slideTo: 1100, gain: 0.07 });
    tone(1100, 0.28, { type: "sawtooth", slideTo: 500, gain: 0.07, delay: 0.14 });
  },
  defuse() {
    noise(0.05, { filter: "highpass", from: 5000, to: 4000, gain: 0.3 });
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { type: "triangle", gain: 0.16, delay: 0.08 + i * 0.08 }));
  },
  /** 把炸弹猫放回牌堆：滴答 */
  placeBomb() {
    tone(320, 0.05, { type: "square", gain: 0.08 });
    tone(220, 0.05, { type: "square", gain: 0.08, delay: 0.18 });
  },
  explode() {
    noise(1.3, { filter: "lowpass", from: 3000, to: 60, gain: 0.7 });
    tone(90, 1.1, { slideTo: 30, gain: 0.6 });
  },
  /** 倒计时滴答，urgency 0~1，越紧张音调越高、越响 */
  tick(urgency = 0) {
    tone(900 + urgency * 700, 0.035, { type: "square", gain: 0.04 + urgency * 0.07 });
  },
  /** 安全：叮咚，越接近炸弹音调越高 */
  safe(urgency = 0) {
    tone(600 + urgency * 500, 0.12, { type: "triangle", gain: 0.16 });
    tone(900 + urgency * 700, 0.22, { type: "triangle", gain: 0.16, delay: 0.1 });
  },
  /** 喊“骗子！”：一声重音 */
  liar() {
    noise(0.15, { filter: "lowpass", from: 2000, to: 300, gain: 0.35 });
    tone(220, 0.35, { type: "square", slideTo: 140, gain: 0.12 });
    tone(330, 0.35, { type: "square", slideTo: 210, gain: 0.08, delay: 0.02 });
  },
  /** 翻牌 */
  flip() {
    noise(0.05, { filter: "highpass", from: 4000, to: 2500, gain: 0.2 });
    tone(1200, 0.04, { type: "triangle", gain: 0.06, delay: 0.02 });
  },
  /** 转动左轮弹巢：先快后慢的咔哒声 */
  spin() {
    let t = 0;
    for (let i = 0; i < 12; i++) {
      noise(0.025, { filter: "bandpass", from: 3000, to: 2500, gain: 0.25, delay: t });
      t += 0.04 + i * 0.012;
    }
  },
  /** 空枪 */
  dryFire() {
    tone(1800, 0.025, { type: "square", gain: 0.2 });
    noise(0.04, { filter: "highpass", from: 5000, to: 3000, gain: 0.3 });
  },
  gunshot() {
    noise(0.7, { filter: "lowpass", from: 7000, to: 90, gain: 0.85 });
    tone(130, 0.45, { slideTo: 40, gain: 0.6 });
  },
  /** 心跳：等待扣扳机时循环播放 */
  heartbeat() {
    tone(65, 0.12, { gain: 0.45 });
    tone(55, 0.12, { gain: 0.35, delay: 0.2 });
  },
  /** 选中一个数字格子：啵 */
  pick() {
    tone(500, 0.08, { type: "sine", slideTo: 900, gain: 0.18 });
  },
  /** 一批格子被排除：哗啦 */
  sweep() {
    for (let i = 0; i < 6; i++) noise(0.05, { filter: "bandpass", from: 1800 + i * 300, to: 1200, gain: 0.08, delay: i * 0.04 });
  },
  /** 输了：下行的“哇哇哇” */
  lose() {
    [392, 370, 349].forEach((f, i) => tone(f, 0.28, { type: "sawtooth", gain: 0.06, delay: 0.9 + i * 0.3 }));
    tone(330, 0.8, { type: "sawtooth", slideTo: 300, gain: 0.06, delay: 1.8 });
  },
  /** UNO 变色牌：一圈上行的音阶 */
  wild() {
    [523, 659, 784, 988, 1175].forEach((f, i) => tone(f, 0.16, { type: "triangle", gain: 0.13, delay: i * 0.05 }));
  },
  /** UNO 反转：先降后升 */
  reverse() {
    tone(900, 0.14, { type: "triangle", slideTo: 400, gain: 0.16 });
    tone(400, 0.16, { type: "triangle", slideTo: 900, gain: 0.16, delay: 0.14 });
  },
  /** 喊 UNO：两声短促的号角 */
  unoShout() {
    tone(660, 0.12, { type: "sawtooth", gain: 0.09 });
    tone(990, 0.28, { type: "sawtooth", gain: 0.09, delay: 0.12 });
  },
  /** 被抓没喊 UNO：警笛 */
  caught() {
    for (let i = 0; i < 3; i++) {
      tone(700, 0.15, { type: "square", slideTo: 1100, gain: 0.07, delay: i * 0.3 });
      tone(1100, 0.15, { type: "square", slideTo: 700, gain: 0.07, delay: i * 0.3 + 0.15 });
    }
  },
  /** 层层叠：轻敲木块 */
  woodTap() {
    tone(1400, 0.05, { type: "triangle", gain: 0.12 });
    noise(0.03, { filter: "bandpass", from: 2500, to: 1800, gain: 0.12 });
  },
  /** 层层叠：木块和木块摩擦着被抽出来 */
  woodSlide(dur = 0.7) {
    noise(dur, { filter: "bandpass", from: 900, to: 500, gain: 0.12 });
    tone(140, dur, { type: "sawtooth", slideTo: 110, gain: 0.025 });
  },
  /** 层层叠：木块放到塔顶 */
  woodPlace() {
    tone(420, 0.08, { type: "triangle", gain: 0.25 });
    noise(0.05, { filter: "bandpass", from: 1500, to: 800, gain: 0.25 });
  },
  /** 层层叠：整座塔哗啦倒下 */
  towerCollapse() {
    noise(1.6, { filter: "lowpass", from: 2500, to: 80, gain: 0.5 });
    for (let i = 0; i < 26; i++) {
      const d = 0.15 + Math.pow(Math.random(), 0.7) * 1.6;
      tone(300 + Math.random() * 500, 0.06, { type: "triangle", gain: 0.12 + Math.random() * 0.12, delay: d });
    }
  },
  /** 层层叠：塔有点晃时的吱呀声 */
  creak() {
    tone(180, 0.5, { type: "sawtooth", slideTo: 140, gain: 0.03 });
  },
  /** 狼人杀：天黑，低沉的下行音加一声狼嚎 */
  night() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, { type: "sine", gain: 0.12, delay: i * 0.18 }));
    tone(420, 1.1, { type: "sawtooth", slideTo: 620, gain: 0.03, delay: 0.9 });
    tone(620, 0.7, { type: "sawtooth", slideTo: 380, gain: 0.03, delay: 2.0 });
  },
  /** 狼人杀：天亮，明亮的上行音 */
  dawn() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: "triangle", gain: 0.14, delay: i * 0.12 }));
  },
  /** 星际穿梭：激光，很轻，因为自动开火很密 */
  laser() {
    tone(1700, 0.06, { type: "triangle", slideTo: 500, gain: 0.025 });
  },
  /** 星际穿梭：打中但没打碎 */
  hitRock() {
    noise(0.04, { filter: "bandpass", from: 2200, to: 1200, gain: 0.08 });
  },
  /** 星际穿梭：打碎陨石 / 敌机 */
  rockBreak() {
    noise(0.35, { filter: "lowpass", from: 2400, to: 120, gain: 0.3 });
    tone(110, 0.3, { slideTo: 45, gain: 0.25 });
  },
  /** 星际穿梭：飞船被击中 */
  playerHit() {
    noise(0.3, { filter: "bandpass", from: 3000, to: 400, gain: 0.35 });
    tone(220, 0.3, { type: "square", slideTo: 70, gain: 0.12 });
  },
  /** 星际穿梭：护盾被打碎 */
  shieldBreak() {
    for (let i = 0; i < 5; i++) tone(2400 - i * 300, 0.08, { type: "triangle", gain: 0.1, delay: i * 0.035 });
  },
  /** 星际穿梭：吃到能量块 */
  powerup() {
    [660, 880, 1100, 1320, 1760].forEach((f, i) => tone(f, 0.12, { type: "square", gain: 0.05, delay: i * 0.05 }));
  },
  /** 星际穿梭：Boss 来袭警报 */
  bossWarning() {
    for (let i = 0; i < 3; i++) {
      tone(330, 0.35, { type: "sawtooth", slideTo: 660, gain: 0.07, delay: i * 0.75 });
      tone(660, 0.35, { type: "sawtooth", slideTo: 330, gain: 0.07, delay: i * 0.75 + 0.35 });
    }
  },
  myTurn() {
    tone(880, 0.12, { gain: 0.14 });
    tone(1175, 0.2, { gain: 0.14, delay: 0.12 });
  },
  /** 秘境闯关：起跳 */
  hop() {
    tone(330, 0.12, { type: "sine", slideTo: 620, gain: 0.12 });
  },
  /** 秘境闯关：落地 */
  land() {
    noise(0.07, { from: 900, to: 200, gain: 0.12 });
  },
  /** 秘境闯关：捡到水晶，清脆的上行琶音 */
  crystal() {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.22, { type: "sine", gain: 0.09, delay: i * 0.05 }));
  },
  /** 秘境闯关：打开 / 收起风之翼 */
  glide(open = true) {
    noise(0.35, { filter: "bandpass", from: open ? 500 : 2500, to: open ? 2500 : 500, gain: 0.16 });
  },
  /** 秘境闯关：踩上机关 */
  plate() {
    tone(196, 0.18, { type: "triangle", gain: 0.18 });
    tone(392, 0.25, { type: "sine", gain: 0.1, delay: 0.06 });
  },
  /** 秘境闯关：结界打开 */
  gate() {
    [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, { type: "triangle", gain: 0.1, delay: i * 0.09 }));
    noise(1.2, { filter: "bandpass", from: 300, to: 4000, gain: 0.12 });
  },
  /** 秘境闯关：被史莱姆弹开 */
  boing() {
    tone(180, 0.25, { type: "sine", slideTo: 520, gain: 0.2 });
  },
  /** 秘境闯关：掉出地图 */
  fall() {
    tone(700, 0.6, { type: "triangle", slideTo: 120, gain: 0.14 });
  },
  /** 火柴人刷图：挥剑破风 */
  swing(heavy = false) {
    noise(heavy ? 0.22 : 0.12, { filter: "bandpass", from: heavy ? 900 : 1800, to: heavy ? 3500 : 5200, gain: heavy ? 0.2 : 0.11 });
  },
  /** 火柴人刷图：砍中 */
  slashHit(heavy = false) {
    noise(0.08, { filter: "lowpass", from: 3200, to: 300, gain: heavy ? 0.38 : 0.22 });
    tone(heavy ? 140 : 210, 0.1, { type: "square", slideTo: 60, gain: heavy ? 0.12 : 0.06 });
  },
  /** 火柴人刷图：爆炸 */
  blast() {
    noise(0.5, { filter: "lowpass", from: 2600, to: 80, gain: 0.45 });
    tone(80, 0.4, { slideTo: 35, gain: 0.35 });
  },
  /** 火柴人刷图：雷电 */
  zap() {
    for (let i = 0; i < 4; i++) noise(0.05, { filter: "highpass", from: 6000, to: 2000, gain: 0.2, delay: i * 0.04 });
    tone(1200, 0.25, { type: "sawtooth", slideTo: 200, gain: 0.06 });
  },
  /** 火柴人刷图：结冰 */
  freeze() {
    [1568, 2093, 2637].forEach((f, i) => tone(f, 0.3, { gain: 0.08, delay: i * 0.04 }));
    noise(0.4, { filter: "highpass", from: 8000, to: 3000, gain: 0.12 });
  },
  /** 火柴人刷图：觉醒 */
  awaken() {
    tone(110, 1.2, { type: "sawtooth", slideTo: 440, gain: 0.08 });
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, { type: "triangle", gain: 0.1, delay: 0.2 + i * 0.08 }));
  },
  /** 扔道具：东西飞出去的呼呼声 */
  whoosh() {
    noise(0.45, { filter: "bandpass", from: 400, to: 2600, gain: 0.22 });
  },
  /** 西红柿砸中：湿乎乎的啪叽 */
  splat() {
    noise(0.25, { filter: "lowpass", from: 1800, to: 120, gain: 0.6 });
    tone(150, 0.18, { slideTo: 50, gain: 0.45 });
    for (let i = 0; i < 4; i++) noise(0.05, { filter: "bandpass", from: 900, to: 500, gain: 0.12, delay: 0.12 + i * 0.07 });
  },
  /** 鸡蛋砸中：蛋壳咔嚓，再加蛋液啪嗒 */
  eggCrack() {
    for (let i = 0; i < 3; i++) noise(0.03, { filter: "highpass", from: 5000, to: 3000, gain: 0.35, delay: i * 0.025 });
    noise(0.2, { filter: "lowpass", from: 1400, to: 150, gain: 0.35, delay: 0.08 });
  },
  /** 一桶水泼过来：哗啦啦 + 冒泡 */
  waterSplash() {
    noise(1.1, { filter: "lowpass", from: 5000, to: 300, gain: 0.55 });
    noise(0.6, { filter: "bandpass", from: 2500, to: 700, gain: 0.25, delay: 0.1 });
    for (let i = 0; i < 6; i++) {
      const f = 500 + Math.random() * 700;
      tone(f, 0.08, { slideTo: f * 1.8, gain: 0.07, delay: 0.35 + i * 0.09 });
    }
    // 最后桶落地：哐当
    tone(240, 0.3, { type: "triangle", slideTo: 200, gain: 0.18, delay: 0.9 });
    tone(370, 0.3, { type: "triangle", slideTo: 330, gain: 0.1, delay: 0.9 });
  },
  /** 拖鞋拍中：啪！ */
  slap() {
    noise(0.12, { filter: "highpass", from: 3500, to: 900, gain: 0.7 });
    tone(320, 0.08, { type: "square", slideTo: 120, gain: 0.15 });
    // 眼冒金星
    [1568, 1976, 1568].forEach((f, i) => tone(f, 0.12, { type: "triangle", gain: 0.05, delay: 0.2 + i * 0.1 }));
  },
  /** 送花：叮铃铃 */
  bloom() {
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.45, { gain: 0.09, delay: i * 0.07 }));
  },
  /** 蛋糕糊脸：软软的噗 */
  cakeSplat() {
    noise(0.3, { filter: "lowpass", from: 900, to: 100, gain: 0.55 });
    tone(110, 0.2, { slideTo: 60, gain: 0.3 });
  },
  /** 西瓜砸开：闷响 + 裂开 + 汁水 */
  melonSmash() {
    tone(90, 0.25, { slideTo: 40, gain: 0.6 });
    noise(0.12, { filter: "highpass", from: 3000, to: 1200, gain: 0.4, delay: 0.03 });
    noise(0.5, { filter: "lowpass", from: 2000, to: 150, gain: 0.35, delay: 0.08 });
  },
  /** 鞭炮：一串噼里啪啦 */
  crackle() {
    let t = 0;
    for (let i = 0; i < 14; i++) {
      noise(0.06, { filter: "highpass", from: 4000, to: 800, gain: 0.35 + Math.random() * 0.3, delay: t });
      tone(140 + Math.random() * 80, 0.05, { type: "square", slideTo: 50, gain: 0.08, delay: t });
      t += 0.04 + Math.random() * 0.07;
    }
  },
  /** 冰块：叮当碰撞 + 结冰 */
  iceClink() {
    [2637, 3136, 2349].forEach((f, i) => tone(f, 0.25, { type: "triangle", gain: 0.12, delay: i * 0.06 }));
    noise(0.5, { filter: "highpass", from: 8000, to: 3000, gain: 0.12, delay: 0.1 });
  },
  /** 踩香蕉皮：滋溜 + 摔一跤 */
  slip() {
    tone(300, 0.35, { type: "sine", slideTo: 1400, gain: 0.15 });
    noise(0.3, { filter: "lowpass", from: 1500, to: 80, gain: 0.5, delay: 0.38 });
    tone(80, 0.25, { slideTo: 40, gain: 0.4, delay: 0.38 });
  },
  /** 便便：噗噗噗 */
  fart() {
    for (let i = 0; i < 3; i++) {
      tone(95 - i * 10, 0.16, { type: "sawtooth", slideTo: 60, gain: 0.12, delay: i * 0.18 });
      noise(0.14, { filter: "lowpass", from: 500, to: 120, gain: 0.25, delay: i * 0.18 });
    }
  },
  /** 飞吻：啵～ */
  smooch() {
    tone(400, 0.08, { type: "sine", slideTo: 1200, gain: 0.25 });
    noise(0.04, { filter: "bandpass", from: 2500, to: 1500, gain: 0.2, delay: 0.06 });
    [1047, 1319].forEach((f, i) => tone(f, 0.3, { gain: 0.07, delay: 0.15 + i * 0.1 }));
  },
  /** 点赞：叮！ */
  thumbsUp() {
    tone(1319, 0.12, { type: "triangle", gain: 0.15 });
    tone(1760, 0.35, { type: "triangle", gain: 0.15, delay: 0.1 });
  },
  /** 胜利结算：小军鼓滚奏，越滚越快越响 */
  drumRoll(dur = 1.1) {
    let t = 0;
    while (t < dur) {
      const k = t / dur;
      noise(0.05, { filter: "bandpass", from: 2200, to: 1400, gain: 0.08 + k * 0.22, delay: t });
      t += 0.06 - k * 0.035;
    }
    // 最后一下镲片
    noise(1.4, { filter: "highpass", from: 9000, to: 4000, gain: 0.3, delay: dur });
    tone(70, 0.5, { slideTo: 40, gain: 0.5, delay: dur });
  },
  /** 胜利结算：铜管号角 “当～当～当当——” */
  fanfare(delay = 0) {
    const brass = (f: number, dur: number, d: number) => {
      tone(f, dur, { type: "sawtooth", gain: 0.07, delay: delay + d });
      tone(f * 2, dur, { type: "triangle", gain: 0.05, delay: delay + d });
      tone(f / 2, dur, { type: "square", gain: 0.03, delay: delay + d });
    };
    brass(392, 0.16, 0); // G
    brass(392, 0.16, 0.18);
    brass(392, 0.16, 0.36);
    brass(523, 0.9, 0.54); // C
    brass(659, 0.9, 0.54); // E
    brass(784, 1.2, 0.54); // G
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.5, { gain: 0.05, delay: delay + 0.6 + i * 0.08 }));
  },
  /** 烟花：升空的哨音 + 炸开的噼啪 */
  firework(delay = 0) {
    tone(600 + Math.random() * 300, 0.35, { type: "sine", slideTo: 1800, gain: 0.03, delay });
    noise(0.5, { filter: "lowpass", from: 2400, to: 100, gain: 0.25, delay: delay + 0.35 });
    for (let i = 0; i < 6; i++) {
      noise(0.03, { filter: "highpass", from: 6000, to: 3000, gain: 0.1, delay: delay + 0.45 + Math.random() * 0.5 });
    }
  },
  win() {
    const d = 0.8; // 先让爆炸声播完
    [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: "triangle", gain: 0.18, delay: d + i * 0.14 }));
    tone(1047, 0.6, { type: "triangle", gain: 0.2, delay: d + 0.42 });
  },
};
