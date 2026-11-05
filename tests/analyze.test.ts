import { describe, expect, it } from 'vitest';
import { analyze } from '../src/engine/analyze';
import { MATERIALS, SECTIONS } from '../src/engine/materials';
import type { Bridge, BridgeNode, MemberResult } from '../src/engine/types';
import { buildPrattTruss } from '../src/game/presets';

const P = 10_000; // 10 kN

function member(result: { members: MemberResult[] }, id: string): MemberResult {
  const found = result.members.find((m) => m.id === id);
  if (!found) throw new Error(`部材 ${id} がありません`);
  return found;
}

function node(id: string, x: number, y: number, extra: Partial<BridgeNode> = {}): BridgeNode {
  return { id, x, y, joint: 'pin', ...extra };
}

describe('トラス（両端ピンの部材）', () => {
  it('二等辺三角形の頂点に荷重をかけると、斜めの 2 本は同じ大きさで押される', () => {
    const bridge: Bridge = {
      nodes: [node('A', 0, 0, { support: 'pin' }), node('B', 4, 0, { support: 'roller' }), node('C', 2, 2)],
      members: [
        { id: 'AC', a: 'A', b: 'C', material: 'steel', section: 'square' },
        { id: 'BC', a: 'B', b: 'C', material: 'steel', section: 'square' },
        { id: 'AB', a: 'A', b: 'B', material: 'steel', section: 'square' },
      ],
    };
    const result = analyze(bridge, [{ node: 'C', fx: 0, fy: -P }], { includeSelfWeight: false });

    // 力のつり合い：N = P / (2 sin 45°)
    const expected = -P / (2 * Math.sin(Math.PI / 4));
    expect(result.stable).toBe(true);
    expect(member(result, 'AC').axial).toBeCloseTo(expected, 3);
    expect(member(result, 'BC').axial).toBeCloseTo(expected, 3);
    // 下の部材は両側に引っぱられる
    expect(member(result, 'AB').axial).toBeCloseTo(P / 2, 3);
    expect(result.reactions.get('A')!.ry).toBeCloseTo(P / 2, 3);
    expect(result.reactions.get('B')!.ry).toBeCloseTo(P / 2, 3);
  });

  it('プラット・トラスの部材力が切断法の答えと一致する', () => {
    // 支間 16 m・4 パネル・高さ 4 m、中央の下に P
    const bridge = buildPrattTruss({ span: 16, panels: 4, height: 4, material: 'steel' });
    const result = analyze(bridge, [{ node: 'B2', fx: 0, fy: -P }], { includeSelfWeight: false });

    // 反力は P/2 ずつ。T1 まわりのモーメントから下弦材 = (P/2 × 4) / 4
    expect(member(result, 'B1-B2').axial).toBeCloseTo(P / 2, 2);
    // B2 まわりのモーメントから上弦材 = -(P/2 × 8) / 4
    expect(member(result, 'T1-T2').axial).toBeCloseTo(-P, 2);
    // せん断力 P/2 を斜材が受ける
    expect(member(result, 'T1-B2').axial).toBeCloseTo((P / 2) * Math.SQRT2, 2);
    // トラスの部材には曲げモーメントが生じない
    for (const m of result.members) expect(m.moment).toBeCloseTo(0, 6);
  });

  it('自重を入れると、反力の合計が橋の重さと一致する', () => {
    const bridge = buildPrattTruss({ span: 16, panels: 4, height: 4 });
    const result = analyze(bridge, []);

    const totalWeight = bridge.members.reduce((sum, m) => {
      const from = bridge.nodes.find((n) => n.id === m.a)!;
      const to = bridge.nodes.find((n) => n.id === m.b)!;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      return sum + MATERIALS[m.material].density * SECTIONS[m.section].A * length * 9.81;
    }, 0);
    const totalReaction = [...result.reactions.values()].reduce((sum, r) => sum + r.ry, 0);
    expect(totalReaction).toBeCloseTo(totalWeight, 3);
  });
});

describe('梁（剛接合の部材）', () => {
  it('片持ち梁の先端のたわみと根元のモーメントが公式と一致する', () => {
    const L = 2;
    const bridge: Bridge = {
      nodes: [node('A', 0, 0, { joint: 'rigid', support: 'fixed' }), node('B', L, 0, { joint: 'rigid' })],
      members: [{ id: 'AB', a: 'A', b: 'B', material: 'steel', section: 'square' }],
    };
    const result = analyze(bridge, [{ node: 'B', fx: 0, fy: -P }], { includeSelfWeight: false });

    const EI = MATERIALS.steel.E * SECTIONS.square.I;
    expect(result.displacements.get('B')!.dy).toBeCloseTo(-(P * L ** 3) / (3 * EI), 9);
    expect(member(result, 'AB').moment).toBeCloseTo(P * L, 3);
    expect(result.reactions.get('A')!.m).toBeCloseTo(P * L, 3);
  });
});

describe('形がくずれるかどうか', () => {
  // 四角形の門の形：A, B が地面、C, D が上の角
  function portal(corner: 'pin' | 'rigid', withBrace: boolean): Bridge {
    const bridge: Bridge = {
      nodes: [
        node('A', 0, 0, { support: 'pin' }),
        node('B', 4, 0, { support: 'pin' }),
        node('C', 0, 4, { joint: corner }),
        node('D', 4, 4, { joint: corner }),
      ],
      members: [
        { id: 'AC', a: 'A', b: 'C', material: 'steel', section: 'square' },
        { id: 'BD', a: 'B', b: 'D', material: 'steel', section: 'square' },
        { id: 'CD', a: 'C', b: 'D', material: 'steel', section: 'square' },
      ],
    };
    if (withBrace) bridge.members.push({ id: 'AD', a: 'A', b: 'D', material: 'steel', section: 'square' });
    return bridge;
  }
  const push = [{ node: 'C', fx: P, fy: 0 }];

  it('ピン接合の四角形は、横から押すとくずれる', () => {
    expect(analyze(portal('pin', false), push).stable).toBe(false);
  });

  it('斜めの部材を入れて三角形にすると、くずれない', () => {
    const result = analyze(portal('pin', true), push);
    expect(result.stable).toBe(true);
    expect(member(result, 'AD').axial).toBeGreaterThan(0);
  });

  it('角を剛接合にすると（ラーメン構造）、斜材がなくてもくずれず、曲げで支える', () => {
    const result = analyze(portal('rigid', false), push);
    expect(result.stable).toBe(true);
    expect(member(result, 'CD').moment).toBeGreaterThan(0);
  });
});

describe('壊れ方の判定', () => {
  it('細長い部材を押すと、材料の強さより先に座屈が効いてくる', () => {
    const bridge: Bridge = {
      nodes: [node('A', 0, 0, { support: 'pin' }), node('B', 12, 0, { support: 'pin' }), node('C', 6, 1)],
      members: [
        { id: 'AC', a: 'A', b: 'C', material: 'wood', section: 'square' },
        { id: 'BC', a: 'B', b: 'C', material: 'wood', section: 'square' },
      ],
    };
    const result = analyze(bridge, [{ node: 'C', fx: 0, fy: -2000 }], { includeSelfWeight: false });

    const ac = member(result, 'AC');
    const L = ac.length;
    const bucklingLoad = (Math.PI ** 2 * MATERIALS.wood.E * SECTIONS.square.I) / L ** 2;
    expect(ac.mode).toBe('buckling');
    expect(ac.utilization).toBeCloseTo(-ac.axial / bucklingLoad, 6);
  });

  it('引っぱられる部材は、強さを断面積で割った値で判定される', () => {
    const bridge = buildPrattTruss({ span: 16, panels: 4, height: 4, material: 'steel' });
    const result = analyze(bridge, [{ node: 'B2', fx: 0, fy: -P }], { includeSelfWeight: false });

    const chord = member(result, 'B1-B2');
    expect(chord.mode).toBe('tension');
    expect(chord.utilization).toBeCloseTo(chord.axial / (MATERIALS.steel.strength * SECTIONS.square.A), 6);
  });
});
