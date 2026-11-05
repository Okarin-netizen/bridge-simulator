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
