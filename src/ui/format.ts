/** 画面に出す数の書き方をそろえる */

export function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

/** 車の重さ（kg）を「1.2 t」のように書く */
export function tons(mass: number): string {
  return `${(mass / 1000).toFixed(1)} t`;
}
