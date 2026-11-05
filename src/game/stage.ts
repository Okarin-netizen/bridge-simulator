import type { BridgeNode } from '../engine/types';

export interface Stage {
  title: string;
  /** 谷の幅（m）。左岸が x = 0、右岸が x = span */
  span: number;
  /** 道路の高さ（m） */
  roadY: number;
  /** 谷の深さ（m） */
  depth: number;
  /** はじめから置いてある支点 */
  anchors: BridgeNode[];
  /** 節点を置ける範囲 */
  buildArea: { minX: number; maxX: number; minY: number; maxY: number };
  /** 節点が吸い付く格子の間隔（m） */
  gridSize: number;
  /** 1 本の部材の最大の長さ（m） */
  maxMemberLength: number;
  budget: number;
}

export const FIRST_STAGE: Stage = {
  title: 'ためしの谷',
  span: 24,
  roadY: 0,
  depth: 10,
  anchors: [
    { id: 'anchor-left', x: 0, y: 0, joint: 'pin', support: 'pin' },
    { id: 'anchor-right', x: 24, y: 0, joint: 'pin', support: 'roller' },
    { id: 'anchor-left-low', x: 0, y: -4, joint: 'pin', support: 'pin' },
    { id: 'anchor-right-low', x: 24, y: -4, joint: 'pin', support: 'pin' },
  ],
  buildArea: { minX: 0, maxX: 24, minY: -8, maxY: 10 },
  gridSize: 2,
  maxMemberLength: 8.5,
  budget: 50_000,
};
