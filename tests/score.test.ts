import { describe, expect, it } from 'vitest';
import { SAFE_UTILIZATION, utilizationPercent } from '../src/game/score';

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
