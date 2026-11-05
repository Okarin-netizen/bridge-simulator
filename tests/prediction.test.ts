import { describe, expect, it } from 'vitest';
import type { MemberResult } from '../src/engine/types';
import { nextGuess, scorePredictions } from '../src/game/prediction';
import type { Guess } from '../src/game/prediction';

function result(id: string, axial: number): MemberResult {
  return { id, length: 4, axial, moment: 0, utilization: 0.5, mode: axial < 0 ? 'compression' : 'tension' };
}

describe('力の予想', () => {
  it('タップするたびに「押される → 引っぱられる → なし」と切りかわる', () => {
    expect(nextGuess(undefined)).toBe('compression');
    expect(nextGuess('compression')).toBe('tension');
    expect(nextGuess('tension')).toBeUndefined();
  });

  it('予想と力の向きを照らし合わせて、正解の数とはずれた部材を返す', () => {
    const guesses = new Map<string, Guess>([
      ['top', 'compression'],
      ['bottom', 'compression'],
      ['diagonal', 'tension'],
    ]);
    const results = [result('top', -20_000), result('bottom', 15_000), result('diagonal', 8_000), result('other', 1)];

    const score = scorePredictions(guesses, results);
    expect(score).toEqual({ total: 3, correct: 2, wrongIds: ['bottom'] });
  });

  it('力がほぼ 0 の部材は、どちらを予想しても正解にする', () => {
    const guesses = new Map<string, Guess>([['zero', 'compression']]);
    const score = scorePredictions(guesses, [result('main', -20_000), result('zero', 50)]);
    expect(score.correct).toBe(1);
  });
});
