export type SolveResult = { solution: number[] } | { singularColumn: number };

/**
 * 連立一次方程式 K·u = f をガウスの消去法（部分ピボット選択つき）で解く。
 *
 * 橋の形がくずれる（不安定な）とき、K は特異になって解が決まらない。
 * そのときは、解けなくなった列（= くずれる場所の自由度）の番号を返す。
 */
export function solveLinearSystem(K: number[][], f: number[]): SolveResult {
  const n = f.length;
  const a = K.map((row) => [...row]);
  const b = [...f];

  const largestDiagonal = Math.max(...a.map((row, i) => Math.abs(row[i])), 0);
  const tolerance = largestDiagonal * 1e-10;

  for (let col = 0; col < n; col++) {
    // この列で絶対値がいちばん大きい行を探して入れ替える
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(a[pivotRow][col]) <= tolerance) return { singularColumn: col };

    [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
    [b[col], b[pivotRow]] = [b[pivotRow], b[col]];

    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return { solution: x };
}
