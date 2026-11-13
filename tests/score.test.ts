import { describe, expect, it } from 'vitest';
import { isMasterBuild, Progress, SAFE_UTILIZATION, utilizationPercent } from '../src/game/score';

describe('負担率の表示', () => {
  it('切り上げるので、70% をこえたら 71% と表示する', () => {
    expect(utilizationPercent(0.702)).toBe(71);
    expect(utilizationPercent(0.7001)).toBe(71);
  });

  it('ちょうど 70% は 70% と表示する（計算の誤差で 71% にしない）', () => {
    expect(utilizationPercent(SAFE_UTILIZATION)).toBe(70);
    expect(utilizationPercent(0.1 * 7)).toBe(70);
  });

  it('表示が 70% 以下なら、星の条件（70% 以下）も満たす', () => {
    for (let u = 0.6; u < 0.8; u += 0.0007) {
      expect(utilizationPercent(u) <= 70).toBe(u <= SAFE_UTILIZATION + 1e-9);
    }
  });
});

describe('最安記録と名人ライン', () => {
  it('★3 を取ったときだけ、安くなったら最安記録を更新する', () => {
    const progress = new Progress();
    expect(progress.record('1-1', 2, 5_000)).toBe(false);
    expect(progress.bestCostFor('1-1')).toBeUndefined();

    expect(progress.record('1-1', 3, 9_000)).toBe(true);
    expect(progress.record('1-1', 3, 9_500)).toBe(false);
    expect(progress.record('1-1', 3, 9_000)).toBe(false);
    expect(progress.record('1-1', 3, 8_800)).toBe(true);
    expect(progress.bestCostFor('1-1')).toBe(8_800);
    expect(progress.starsFor('1-1')).toBe(3);
  });

  it('予想を全部当てたステージを覚えておく', () => {
    const progress = new Progress();
    expect(progress.hasPerfectPrediction('1-1')).toBe(false);
    progress.recordPerfectPrediction('1-1');
    expect(progress.hasPerfectPrediction('1-1')).toBe(true);
    expect(progress.hasPerfectPrediction('1-2')).toBe(false);
  });

  it('★3 を名人ライン以下の金額で取ったら名人', () => {
    expect(isMasterBuild(3, 9_400, 9_400)).toBe(true);
    expect(isMasterBuild(3, 9_401, 9_400)).toBe(false);
    expect(isMasterBuild(2, 5_000, 9_400)).toBe(false);
    expect(isMasterBuild(3, 5_000, undefined)).toBe(false);
  });
});
