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
  /** 输了：下行的“哇哇哇” */
  lose() {
    [392, 370, 349].forEach((f, i) => tone(f, 0.28, { type: "sawtooth", gain: 0.06, delay: 0.9 + i * 0.3 }));
    tone(330, 0.8, { type: "sawtooth", slideTo: 300, gain: 0.06, delay: 1.8 });
  },
  myTurn() {
    tone(880, 0.12, { gain: 0.14 });
    tone(1175, 0.2, { gain: 0.14, delay: 0.12 });
  },
  win() {
    const d = 0.8; // 先让爆炸声播完
    [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: "triangle", gain: 0.18, delay: d + i * 0.14 }));
    tone(1047, 0.6, { type: "triangle", gain: 0.2, delay: d + 0.42 });
  },
};
