import { GRAVITY } from '../engine/materials';

/** 画面に出す数の書き方をそろえる */

export function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

/** 重さ（kg）を「1.2 t」のように書く。ステージの目標の「11 t」とそろえて、きりのよい値は小数をつけない */
export function tons(mass: number): string {
  return `${Number((mass / 1000).toFixed(1))} t`;
}

/**
 * 力（N）を、kN と「何 kg の物の重さくらいか」で書く。
 * kN はなじみがないので、車の重さと比べられるように重さでも言いかえる。
 */
export function forceText(newtons: number): string {
  const kg = Math.abs(newtons) / GRAVITY;
  const weight = kg >= 1000 ? tons(kg) : `${kg >= 100 ? Math.round(kg / 10) * 10 : Math.round(kg)} kg`;
  return `${(Math.abs(newtons) / 1000).toFixed(1)} kN（およそ ${weight} の物の重さ）`;
}
