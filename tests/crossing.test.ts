import { describe, expect, it } from 'vitest';
import { simulateCrossing, VEHICLES } from '../src/engine/crossing';
import type { Vehicle } from '../src/engine/crossing';
import { buildPrattTruss } from '../src/game/presets';

const vehicle = (id: string): Vehicle => VEHICLES.find((v) => v.id === id)!;
const roadY = 0;

describe('車の走行試験', () => {
  const bridge = buildPrattTruss({ span: 16, panels: 4, height: 4 });

  it('軽い車は木のトラス橋を渡り切れる', () => {
    const outcome = simulateCrossing(bridge, vehicle('kei'), { roadY });
    expect(outcome.status).toBe('crossed');
    expect(outcome.maxUtilization).toBeGreaterThan(0);
    expect(outcome.maxUtilization).toBeLessThan(1);
    expect(outcome.frames.length).toBeGreaterThan(30);
  });

  it('重いトラックでは部材がこわれ、最初にこわれた部材と原因がわかる', () => {
    const outcome = simulateCrossing(bridge, vehicle('truck'), { roadY });
    expect(outcome.status).toBe('collapsed');
    expect(outcome.broken.length).toBeGreaterThan(0);
    expect(outcome.broken[0].utilization).toBeGreaterThan(1);
    expect(['tension', 'compression', 'buckling', 'bending']).toContain(outcome.broken[0].mode);
    expect(outcome.stoppedAt).not.toBeNull();
  });

  it('道路がとぎれていると、そこで止まる', () => {
    const broken = { ...bridge, members: bridge.members.filter((m) => m.id !== 'B2-B3') };
    const outcome = simulateCrossing(broken, vehicle('kei'), { roadY });
    expect(outcome.status).toBe('gap');
    expect(outcome.stoppedAt).toBe(8);
  });

  it('斜材のない四角形だけの橋は、形がくずれる', () => {
    const noDiagonals = {
      ...bridge,
      members: bridge.members.filter((m) => !['T1-B2', 'T3-B2'].includes(m.id)),
    };
    const outcome = simulateCrossing(noDiagonals, vehicle('kei'), { roadY });
    expect(outcome.status).toBe('unstable');
  });

  it('形がくずれたときは、くずれ始めた節点がわかる', () => {
    // 道路だけで、まん中の節点を支えるものがない橋
    const deckOnly = {
      nodes: bridge.nodes.filter((n) => n.y === 0 && [0, 4, 8].includes(n.x)).map((n) =>
        n.x === 8 ? { ...n, support: 'roller' as const } : n,
      ),
      members: bridge.members.filter((m) => ['B0-B1', 'B1-B2'].includes(m.id)),
    };
    const outcome = simulateCrossing(deckOnly, vehicle('kei'), { roadY });
    expect(outcome.status).toBe('unstable');
    expect(outcome.unstableNodeId).toBe('B1');
  });
});
