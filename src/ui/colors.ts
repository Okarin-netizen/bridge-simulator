import type { MaterialId } from '../engine/types';

/** 画面と振り返りシートで使う文字の書体（style.css と同じもの） */
export const FONT_FAMILY = "'M PLUS Rounded 1c', system-ui, sans-serif";

export const COLORS = {
  sky: '#DCEBF5',
  gridDot: '#9FB6C8',
  cliff: '#A07D58',
  grass: '#6E8F4E',
  river: '#6FA8D6',
  ink: '#1F2A37',
  muted: '#5B6675',
  accent: '#0E7C66',
  broken: '#9F1F0A',
};

export const MATERIAL_COLORS: Record<MaterialId, string> = {
  wood: '#B07A3E',
  steel: '#7E8A97',
  aluminum: '#A9B8C6',
};

// 負担率 0 → 1 で、うすい色からこい色へ変える
const TENSION_LIGHT = [191, 211, 248];
const TENSION_DARK = [30, 64, 175];
const COMPRESSION_LIGHT = [246, 200, 186];
const COMPRESSION_DARK = [159, 31, 10];

/** 力の向き（引張 = 青、圧縮 = 赤）と負担率から部材の色を決める */
export function forceColor(axial: number, utilization: number): string {
  const t = Math.min(Math.max(utilization, 0), 1);
  const [light, dark] = axial >= 0 ? [TENSION_LIGHT, TENSION_DARK] : [COMPRESSION_LIGHT, COMPRESSION_DARK];
  const mix = light.map((value, i) => Math.round(value + (dark[i] - value) * t));
  return `rgb(${mix.join(', ')})`;
}
