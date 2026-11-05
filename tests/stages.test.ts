import { describe, expect, it } from 'vitest';
import { simulateCrossing, VEHICLES } from '../src/engine/crossing';
import type { MaterialId, SectionId } from '../src/engine/types';
import { BridgeDesign } from '../src/game/design';
import { SAFE_UTILIZATION } from '../src/game/score';
import { STAGES } from '../src/game/stage';
import type { Coordinate, Stage } from '../src/game/stage';

/*
 * どのステージにも、予算の中で余裕をもって渡り切れる（★3 の）答えがあることを確かめる。
 * ここに書いた答えは、先生用ページと模範解答 PDF に載せている形と同じ。
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

/** ★3 の条件（わたり切る・予算内・負担率 70% 以下）をすべて満たすか */
function expectThreeStars(design: BridgeDesign) {
  const outcome = test(design);
  expect(outcome.status).toBe('crossed');
  expect(design.totalCost()).toBeLessThanOrEqual(design.stage.budget);
  expect(outcome.maxUtilization).toBeLessThanOrEqual(SAFE_UTILIZATION);
}

/** プラット・トラス（パネル幅 4 m）の部材。height をマイナスにすると道路の下に組む */
function pratt(span: number, height = 4): Segment[] {
  const segments: Segment[] = [];
  const panels = span / 4;
  const h = height;
  for (let i = 0; i < panels; i++) segments.push([[4 * i, 0], [4 * i + 4, 0]]);
  for (let i = 1; i < panels - 1; i++) segments.push([[4 * i, h], [4 * i + 4, h]]);
  for (let i = 1; i < panels; i++) segments.push([[4 * i, 0], [4 * i, h]]);
  segments.push([[0, 0], [4, h]], [[span, 0], [span - 4, h]]);
  for (let i = 1; i < panels - 1; i++) {
    if (i < panels / 2) segments.push([[4 * i, h], [4 * i + 4, 0]]);
    else segments.push([[4 * i + 4, h], [4 * i, 0]]);
  }
  return segments;
}

/** 上の弦材と両はしの斜材（トラスで押される部材）だけ鉄の角材、ほかは木のパイプにした橋 */
function steelWhereCompressed(stage: Stage): BridgeDesign {
  const design = new BridgeDesign(stage);
  for (const [[x1, y1], [x2, y2]] of pratt(stage.span)) {
    const isTopChord = y1 > 0 && y2 > 0;
    const isEndPost = (x1 === 0 || x1 === stage.span) && y2 > 0;
    const [material, section]: [MaterialId, SectionId] = isTopChord || isEndPost ? ['steel', 'square'] : ['wood', 'pipe'];
    expect(design.connect({ x: x1, y: y1 }, { x: x2, y: y2 }, material, section)).toBeNull();
  }
  return design;
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
    expectThreeStars(design);
  });

  it('1-2：プラット・トラスで乗用車がわたれる', () => {
    const stage = stageById('1-2');
    expectThreeStars(build(stage, pratt(16)));
  });

  it('2-1：はじめの橋はくずれるが、斜材を 2 本足すとわたれる', () => {
    const stage = stageById('2-1');
    const design = new BridgeDesign(stage);
    expect(test(design).status).toBe('unstable');

    design.connect({ x: 4, y: 4 }, { x: 8, y: 0 }, 'wood', 'square');
    design.connect({ x: 12, y: 4 }, { x: 8, y: 0 }, 'wood', 'square');
    expectThreeStars(design);
  });

  it('2-3：道路より上には置けないが、下に組んだトラスでわたれる', () => {
    const stage = stageById('2-3');
    expect(new BridgeDesign(stage).connect({ x: 0, y: 0 }, { x: 4, y: 4 }, 'wood', 'square')).not.toBeNull();

    expectThreeStars(build(stage, pratt(16, -4)));
  });

  it('2-2：24 m の谷も予算の中でわたれる。道路の下に組むと余裕が出る', () => {
    const stage = stageById('2-2');
    const above = build(stage, pratt(24));
    expect(test(above).status).toBe('crossed');
    expect(test(above).maxUtilization).toBeGreaterThan(SAFE_UTILIZATION);

    expectThreeStars(build(stage, pratt(24, -4)));
  });

  it('3-1：角材の木のトラスではバスで座屈するが、パイプならわたれ、H形なら余裕が出る', () => {
    const stage = stageById('3-1');
    const weak = test(build(stage, pratt(16), 'wood', 'square'));
    expect(weak.status).toBe('collapsed');
    expect(weak.broken[0].mode).toBe('buckling');

    expect(test(build(stage, pratt(16), 'wood', 'pipe')).status).toBe('crossed');
    expectThreeStars(build(stage, pratt(16), 'wood', 'hbeam'));
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
  });

  it('3-2：幅 2 m の四角形を剛接合で並べると、余裕をもってわたれる', () => {
    const stage = stageById('3-2');
    const frame: Segment[] = [];
    for (let x = 0; x < 12; x += 2) frame.push([[x, 0], [x + 2, 0]], [[x, 4], [x + 2, 4]]);
    for (let x = 0; x <= 12; x += 2) frame.push([[x, 0], [x, 4]]);

    const design = build(stage, frame, 'wood', 'hbeam');
    for (const node of design.nodes) design.toggleJoint(node.id);
    expectThreeStars(design);
  });

  it('3-3：木だけではトラックで座屈し、全部鉄だと予算オーバー。押される部材だけ鉄にするとわたれる', () => {
    const stage = stageById('3-3');
    expect(test(build(stage, pratt(16), 'wood', 'hbeam')).status).toBe('collapsed');
    expect(build(stage, pratt(16), 'steel', 'square').totalCost()).toBeGreaterThan(stage.budget);

    expectThreeStars(steelWhereCompressed(stage));
  });

  it('4-1：24 m の谷でも、押される部材を鉄にすればバスがわたれる', () => {
    expectThreeStars(steelWhereCompressed(stageById('4-1')));
  });
});
