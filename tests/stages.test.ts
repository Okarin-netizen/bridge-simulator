import { describe, expect, it } from 'vitest';
import { simulateCrossing, VEHICLES } from '../src/engine/crossing';
import type { MaterialId, SectionId } from '../src/engine/types';
import { BridgeDesign } from '../src/game/design';
import { STAGES } from '../src/game/stage';
import type { Coordinate, Stage } from '../src/game/stage';

/*
 * どのステージにも、予算の中で渡り切れる答えがあることを確かめる。
 * ここに書いた答えはあくまで一例で、生徒には見せない。
 */

type Segment = [from: Coordinate, to: Coordinate];

function stageById(id: string): Stage {
  return STAGES.find((s) => s.id === id)!;
}

function build(stage: Stage, segments: Segment[], material: MaterialId = 'wood', section: SectionId = 'square') {
  const design = new BridgeDesign(stage);
  for (const [[x1, y1], [x2, y2]] of segments) {
    const problem = design.connect({ x: x1, y: y1 }, { x: x2, y: y2 }, material, section);
    expect(problem).toBeNull();
  }
  return design;
}

function test(design: BridgeDesign) {
  const vehicle = VEHICLES.find((v) => v.id === design.stage.vehicleId)!;
  return simulateCrossing(design.toBridge(), vehicle, { roadY: design.stage.roadY });
}

/** プラット・トラス（高さ 4 m、パネル幅 4 m）の部材 */
function pratt(span: number): Segment[] {
  const segments: Segment[] = [];
  const panels = span / 4;
  for (let i = 0; i < panels; i++) segments.push([[4 * i, 0], [4 * i + 4, 0]]);
  for (let i = 1; i < panels - 1; i++) segments.push([[4 * i, 4], [4 * i + 4, 4]]);
  for (let i = 1; i < panels; i++) segments.push([[4 * i, 0], [4 * i, 4]]);
  segments.push([[0, 0], [4, 4]], [[span, 0], [span - 4, 4]]);
  for (let i = 1; i < panels - 1; i++) {
    if (i < panels / 2) segments.push([[4 * i, 4], [4 * i + 4, 0]]);
    else segments.push([[4 * i + 4, 4], [4 * i, 0]]);
  }
  return segments;
}

describe('ステージには答えがある', () => {
  it('1-1：三角形 1 つで軽自動車がわたれる', () => {
    const stage = stageById('1-1');
    const design = build(stage, [
      [[0, 0], [4, 0]],
      [[4, 0], [8, 0]],
      [[0, 0], [4, 4]],
      [[4, 4], [8, 0]],
      [[4, 0], [4, 4]],
    ]);
    const outcome = test(design);
    expect(outcome.status).toBe('crossed');
    expect(design.totalCost()).toBeLessThanOrEqual(stage.budget);
  });

  it('1-2：プラット・トラスで乗用車がわたれる', () => {
    const stage = stageById('1-2');
    const design = build(stage, pratt(16));
    expect(test(design).status).toBe('crossed');
    expect(design.totalCost()).toBeLessThanOrEqual(stage.budget);
  });

  it('2-1：はじめの橋はくずれるが、斜材を 2 本足すとわたれる', () => {
    const stage = stageById('2-1');
    const design = new BridgeDesign(stage);
    expect(test(design).status).toBe('unstable');

    design.connect({ x: 4, y: 4 }, { x: 8, y: 0 }, 'wood', 'square');
    design.connect({ x: 12, y: 4 }, { x: 8, y: 0 }, 'wood', 'square');
    expect(test(design).status).toBe('crossed');
    expect(design.totalCost()).toBeLessThanOrEqual(stage.budget);
  });

  it('2-2：24 m の谷も予算の中でわたれる', () => {
    const stage = stageById('2-2');
    const design = build(stage, pratt(24));
    expect(test(design).status).toBe('crossed');
    expect(design.totalCost()).toBeLessThanOrEqual(stage.budget);
  });

  it('3-1：角材の木のトラスではバスで座屈するが、パイプにするとわたれる', () => {
    const stage = stageById('3-1');
    const weak = test(build(stage, pratt(16), 'wood', 'square'));
    expect(weak.status).toBe('collapsed');
    expect(weak.broken[0].mode).toBe('buckling');

    const design = build(stage, pratt(16), 'wood', 'pipe');
    expect(test(design).status).toBe('crossed');
    expect(design.totalCost()).toBeLessThanOrEqual(stage.budget);
  });

  it('3-2：斜材は置けない。四角形はピンだとくずれ、剛接合にするとわたれる', () => {
    const stage = stageById('3-2');
    const frame: Segment[] = [
      [[0, 0], [4, 0]],
      [[4, 0], [8, 0]],
      [[8, 0], [12, 0]],
      [[0, 4], [4, 4]],
      [[4, 4], [8, 4]],
      [[8, 4], [12, 4]],
      [[0, 0], [0, 4]],
      [[4, 0], [4, 4]],
      [[8, 0], [8, 4]],
      [[12, 0], [12, 4]],
    ];
    const design = build(stage, frame, 'wood', 'hbeam');
    expect(design.connect({ x: 0, y: 0 }, { x: 4, y: 4 }, 'wood', 'square')).not.toBeNull();
    expect(test(design).status).toBe('unstable');

    for (const node of design.nodes) design.toggleJoint(node.id);
    expect(test(design).status).toBe('crossed');
    expect(design.totalCost()).toBeLessThanOrEqual(stage.budget);
  });
});
