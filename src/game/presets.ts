import type { Bridge, BridgeMember, BridgeNode, MaterialId, SectionId } from '../engine/types';

interface PrattOptions {
  span: number;
  panels: number;
  height: number;
  material?: MaterialId;
  section?: SectionId;
}

/**
 * プラット・トラス（斜材が中央に向かって下がる形）の橋を作る。
 * 左端はピン支点、右端はローラー支点。道路は y = 0 の高さ。
 */
export function buildPrattTruss({ span, panels, height, material = 'wood', section = 'square' }: PrattOptions): Bridge {
  const panelWidth = span / panels;
  const nodes: BridgeNode[] = [];
  const members: BridgeMember[] = [];

  for (let i = 0; i <= panels; i++) {
    const support = i === 0 ? 'pin' : i === panels ? 'roller' : undefined;
    nodes.push({ id: `B${i}`, x: i * panelWidth, y: 0, joint: 'pin', support });
  }
  for (let i = 1; i < panels; i++) {
    nodes.push({ id: `T${i}`, x: i * panelWidth, y: height, joint: 'pin' });
  }

  const connect = (a: string, b: string) => members.push({ id: `${a}-${b}`, a, b, material, section });

  for (let i = 0; i < panels; i++) connect(`B${i}`, `B${i + 1}`);
  for (let i = 1; i < panels - 1; i++) connect(`T${i}`, `T${i + 1}`);
  connect('B0', 'T1');
  connect(`T${panels - 1}`, `B${panels}`);
  for (let i = 1; i < panels; i++) connect(`B${i}`, `T${i}`);

  const middle = panels / 2;
  for (let i = 1; i < panels - 1; i++) {
    // 左半分は右下がり、右半分は左下がりの斜材
    if (i < middle) connect(`T${i}`, `B${i + 1}`);
    else connect(`T${i + 1}`, `B${i}`);
  }

  return { nodes, members };
}
