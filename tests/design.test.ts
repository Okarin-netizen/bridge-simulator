import { describe, expect, it } from 'vitest';
import { BridgeDesign } from '../src/game/design';
import { STAGES } from '../src/game/stage';

const firstStage = STAGES[0];

describe('もどす', () => {
  it('部材を置く前の形にもどせる', () => {
    const design = new BridgeDesign(firstStage);
    expect(design.canUndo).toBe(false);

    design.connect({ x: 0, y: 0 }, { x: 4, y: 0 }, 'wood', 'square');
    design.connect({ x: 4, y: 0 }, { x: 8, y: 0 }, 'wood', 'square');
    expect(design.members).toHaveLength(2);

    design.undo();
    expect(design.members).toHaveLength(1);
    design.undo();
    expect(design.members).toHaveLength(0);
    expect(design.nodes).toHaveLength(firstStage.anchors.length);
    expect(design.canUndo).toBe(false);
  });

  it('つなげなかったときは、もどす回数にふくめない', () => {
    const design = new BridgeDesign(firstStage);
    const problem = design.connect({ x: 0, y: 0 }, { x: 8, y: 0 }, 'wood', 'square');
    expect(problem).not.toBeNull();
    expect(design.canUndo).toBe(false);
  });

  it('「はじめから」で消した橋も、もどせる', () => {
    const design = new BridgeDesign(firstStage);
    design.connect({ x: 0, y: 0 }, { x: 4, y: 0 }, 'wood', 'square');
    design.clear();
    expect(design.members).toHaveLength(0);

    design.undo();
    expect(design.members).toHaveLength(1);
  });
});

describe('途中の節点で部材を区切る', () => {
  const lengths = (design: BridgeDesign) => design.members.map((m) => design.lengthOf(m)).sort();

  it('長い部材を引くと、途中にある節点で 2 本に分かれてつながる', () => {
    const design = new BridgeDesign(firstStage);
    design.connect({ x: 2, y: 0 }, { x: 2, y: 2 }, 'wood', 'square');
    design.connect({ x: 0, y: 0 }, { x: 4, y: 0 }, 'wood', 'square');

    expect(lengths(design)).toEqual([2, 2, 2]);
    const middle = design.findNodeAt(2, 0)!;
    expect(design.members.filter((m) => m.a === middle.id || m.b === middle.id)).toHaveLength(3);
  });

  it('部材の途中に新しい節点を置くと、その部材が 2 本に分かれてつながる', () => {
    const design = new BridgeDesign(firstStage);
    design.connect({ x: 0, y: 0 }, { x: 4, y: 0 }, 'steel', 'pipe');
    design.connect({ x: 2, y: 0 }, { x: 2, y: 2 }, 'wood', 'square');

    expect(lengths(design)).toEqual([2, 2, 2]);
    const halves = design.members.filter((m) => m.material === 'steel');
    expect(halves).toHaveLength(2);
    expect(halves.every((m) => m.section === 'pipe')).toBe(true);
  });

  it('重なる部分はつなぎなおさず、足りない部分だけ置く', () => {
    const design = new BridgeDesign(firstStage);
    design.connect({ x: 0, y: 0 }, { x: 4, y: 0 }, 'wood', 'square');
    design.connect({ x: 2, y: 0 }, { x: 6, y: 0 }, 'wood', 'square');
    expect(lengths(design)).toEqual([2, 2, 2]);
  });

  it('区切ったあとも、1 回の「もどす」で前の形にもどる', () => {
    const design = new BridgeDesign(firstStage);
    design.connect({ x: 0, y: 0 }, { x: 4, y: 0 }, 'wood', 'square');
    design.connect({ x: 2, y: 0 }, { x: 2, y: 2 }, 'wood', 'square');
    design.undo();
    expect(lengths(design)).toEqual([4]);
  });

  it('区切ってもすべてつながっているときは、そう伝える', () => {
    const design = new BridgeDesign(firstStage);
    design.connect({ x: 0, y: 0 }, { x: 2, y: 0 }, 'wood', 'square');
    design.connect({ x: 2, y: 0 }, { x: 4, y: 0 }, 'wood', 'square');
    expect(design.connect({ x: 0, y: 0 }, { x: 4, y: 0 }, 'wood', 'square')).toBe('その 2 点はもうつながっています');
  });
});
