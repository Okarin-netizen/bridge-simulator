/*
 * 効果音。教室でいっせいに鳴らないよう、はじめは消しておき、音のボタンを押した人だけ鳴らす。
 * 音のファイルは使わず、その場で短い音を作る（ネットが切れても鳴るように）。
 */

const STORAGE_KEY = 'kakehashi-lab:sound';

/** 全体の音の大きさ（0〜1）。小さめにしておく */
const VOLUME = 0.25;

export type SoundName = 'place' | 'remove' | 'break' | 'cross' | 'star';

let audio: AudioContext | null = null;
let enabled = loadSetting();

function loadSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても、開いているあいだは設定どおりに鳴らす
  }
  if (on) play('place');
}

export function play(name: SoundName): void {
  if (!enabled) return;
  // ブラウザは、ボタンを押したあとでないと音を出させてくれないので、最初に鳴らすときに用意する
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
  const now = audio.currentTime;

  switch (name) {
    case 'place':
      // ポン：高い音から少し下がる
      tone(audio, { from: 880, to: 520, start: now, length: 0.09, type: 'sine' });
      break;
    case 'remove':
      tone(audio, { from: 420, to: 260, start: now, length: 0.08, type: 'triangle' });
      break;
    case 'break':
      // バキッ：ざらざらした音と、低く落ちる音を重ねる
      noise(audio, now, 0.25);
      tone(audio, { from: 220, to: 60, start: now, length: 0.4, type: 'sawtooth', volume: 0.5 });
      break;
    case 'cross':
      // わたれた：ド・ミ・ソ・ド と上がっていく
      [523, 659, 784, 1047].forEach((frequency, i) =>
        tone(audio!, { from: frequency, to: frequency, start: now + i * 0.09, length: i === 3 ? 0.3 : 0.1, type: 'square', volume: 0.35 }),
      );
      break;
    case 'star':
      tone(audio, { from: 1320, to: 1760, start: now, length: 0.12, type: 'sine' });
      break;
  }
}

interface Tone {
  from: number;
  to: number;
  start: number;
  length: number;
  type: OscillatorType;
  volume?: number;
}

/** 高さが from から to へ変わる音を 1 つ鳴らす。出だしを強く、すぐ小さくする */
function tone(context: AudioContext, { from, to, start, length, type, volume = 1 }: Tone): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + length);
  gain.gain.setValueAtTime(VOLUME * volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length);
}

/** ザッという、高さのない音 */
function noise(context: AudioContext, start: number, length: number): void {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * length), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 2;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = VOLUME;
  source.connect(gain).connect(context.destination);
  source.start(start);
}
