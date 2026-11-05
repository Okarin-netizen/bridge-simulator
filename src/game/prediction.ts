import type { MemberResult } from '../engine/types';

/** 生徒の予想：その部材は押されるか、引っぱられるか */
export type Guess = 'compression' | 'tension';

export interface PredictionScore {
  total: number;
  correct: number;
  /** はずれた部材の id */
  wrongIds: string[];
}

/** いちばん大きな力にくらべてこれより小さい力は「ほぼ 0」とみなし、どちらの予想も正解にする */
const NEARLY_ZERO_RATIO = 0.02;

/** 予想を切りかえる順番：なし → 押される → 引っぱられる → なし */
export function nextGuess(current: Guess | undefined): Guess | undefined {
  if (current === undefined) return 'compression';
  if (current === 'compression') return 'tension';
  return undefined;
}

/** 試験の結果と予想を照らし合わせる */
export function scorePredictions(guesses: Map<string, Guess>, results: MemberResult[]): PredictionScore {
  const largest = Math.max(0, ...results.map((r) => Math.abs(r.axial)));
  const resultById = new Map(results.map((r) => [r.id, r]));

  const score: PredictionScore = { total: 0, correct: 0, wrongIds: [] };
  for (const [id, guess] of guesses) {
    const result = resultById.get(id);
    if (!result) continue;

    score.total++;
    const nearlyZero = Math.abs(result.axial) <= largest * NEARLY_ZERO_RATIO;
    const actual: Guess = result.axial < 0 ? 'compression' : 'tension';
    if (nearlyZero || guess === actual) score.correct++;
    else score.wrongIds.push(id);
  }
  return score;
}
