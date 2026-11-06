import { describe, expect, it } from 'vitest';
import { simulateCrossing, VEHICLES } from '../src/engine/crossing';
import { BridgeDesign } from '../src/game/design';
import { STAGES } from '../src/game/stage';
import { CrossingPlayback } from '../src/ui/playback';

const kei = VEHICLES.find((v) => v.id === 'kei')!;
const truck = VEHICLES.find((v) => v.id === 'truck')!;

/** 1-1 の谷に、三角形ひとつの橋をかける */
function triangleBridge() {
  const design = new BridgeDesign(STAGES[0]);
  const segments: [number, number, number, number][] = [
    [0, 0, 4, 0],
    [4, 0, 8, 0],
    [0, 0, 4, 4],
    [4, 4, 8, 0],
    [4, 0, 4, 4],
  ];
  for (const [x1, y1, x2, y2] of segments) design.connect({ x: x1, y: y1 }, { x: x2, y: y2 }, 'wood', 'square');
  return design.toBridge();
}

/** 終わるまで 1/60 秒ずつ進め、通った段階を記録する */
function playToEnd(playback: CrossingPlayback): string[] {
  const phases = [playback.phase];
  for (let i = 0; i < 10_000 && !playback.finished; i++) {
    playback.advance(1 / 60);
    if (phases[phases.length - 1] !== playback.phase) phases.push(playback.phase);
  }
  return phases;
}

describe('走行試験のアニメーション', () => {
  it('車は岸から走り出し、橋に乗るまでは計算結果を使わない', () => {
    const playback = new CrossingPlayback(simulateCrossing(triangleBridge(), kei, { roadY: 0 }));
    expect(playback.carX).toBeLessThan(0);
    expect(playback.frameIndex).toBe(-1);
    expect(playback.currentMembers).toEqual([]);
  });

  it('わたり切ったら落ちずに終わり、いちばん苦しかった瞬間に止められる', () => {
    const outcome = simulateCrossing(triangleBridge(), kei, { roadY: 0 });
    const playback = new CrossingPlayback(outcome);
    expect(playToEnd(playback)).toEqual(['driving', 'finished']);
    expect(playback.fallDistance).toBe(0);

    playback.showHardestMoment();
    const worst = Math.max(...playback.currentMembers.map((m) => m.utilization));
    expect(worst).toBeCloseTo(outcome.maxUtilization);
  });

  it('こわれたときは、部材がこわれる様子と落ちる様子を見せてから終わる', () => {
    const outcome = simulateCrossing(triangleBridge(), truck, { roadY: 0 });
    expect(outcome.status).toBe('collapsed');

    const playback = new CrossingPlayback(outcome);
    expect(playToEnd(playback)).toEqual(['driving', 'breaking', 'falling', 'finished']);
    expect(playback.carX).toBeCloseTo(outcome.stoppedAt!);
    expect(playback.fallDistance).toBeGreaterThan(5);
  });

  it('たわみは見えるように、きりのよい倍率で大きくする', () => {
    const playback = new CrossingPlayback(simulateCrossing(triangleBridge(), kei, { roadY: 0 }));
    expect([300, 200, 100, 50, 20, 10, 5, 2, 1]).toContain(playback.deflectionScale);
    expect(playback.deflectionScale).toBeGreaterThan(1);

    playback.showHardestMoment();
    const largest = Math.max(...[...playback.drawnDisplacements().values()].map((d) => Math.hypot(d.dx, d.dy)));
    expect(largest).toBeGreaterThan(0.05);
    expect(largest).toBeLessThanOrEqual(1.5);
  });

  it('部材は、最初にこわれた部材から順番にこわれていく', () => {
    const outcome = simulateCrossing(triangleBridge(), truck, { roadY: 0 });
    const playback = new CrossingPlayback(outcome);
    while (playback.phase === 'driving') playback.advance(1 / 60);
    expect(playback.breakStates).toEqual([]);

    playback.advance(0.25);
    const [cause] = playback.breakStates;
    expect(playback.breakStates).toHaveLength(1);
    expect(cause.id).toBe(outcome.broken[0].id);
    expect(cause.isCause).toBe(true);
    expect(cause.progress).toBeGreaterThan(0);
    expect(cause.progress).toBeLessThan(1);

    playToEnd(playback);
    expect(playback.breakStates.map((state) => state.id)).toEqual(outcome.broken.map((b) => b.id));
    expect(playback.breakStates.every((state) => state.progress === 1)).toBe(true);
  });

  it('車の重さの矢印は、橋の上を走っているあいだと、わたり切ったあとに出す', () => {
    const crossed = new CrossingPlayback(simulateCrossing(triangleBridge(), kei, { roadY: 0 }));
    expect(crossed.showsLoads).toBe(true);
    playToEnd(crossed);
    expect(crossed.showsLoads).toBe(true);

    const collapsed = new CrossingPlayback(simulateCrossing(triangleBridge(), truck, { roadY: 0 }));
    playToEnd(collapsed);
    expect(collapsed.showsLoads).toBe(false);
  });
});
