import { MATERIALS, SECTIONS } from '../engine/materials';
import type { Bridge, BridgeMember, BridgeNode, MaterialId, SectionId } from '../engine/types';
import { buildPrattTruss } from './presets';
import type { Stage } from './stage';

/**
 * 生徒が組み立て中の橋。節点と部材の追加・削除をまとめて扱う。
 * 支点（stage.anchors）は消せない。
 */
export class BridgeDesign {
  nodes: BridgeNode[];
  members: BridgeMember[] = [];
  private nextId = 1;

  constructor(readonly stage: Stage) {
    this.nodes = stage.anchors.map((anchor) => ({ ...anchor }));
  }

  toBridge(): Bridge {
    return { nodes: this.nodes, members: this.members };
  }

  findNodeAt(x: number, y: number): BridgeNode | undefined {
    return this.nodes.find((n) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6);
  }

  isAnchor(node: BridgeNode): boolean {
    return this.stage.anchors.some((a) => a.id === node.id);
  }

  canPlaceNode(x: number, y: number): boolean {
    const { minX, maxX, minY, maxY } = this.stage.buildArea;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  /** その位置に節点があれば返し、なければ新しく置く */
  nodeAt(x: number, y: number): BridgeNode | null {
    const existing = this.findNodeAt(x, y);
    if (existing) return existing;
    if (!this.canPlaceNode(x, y)) return null;

    const node: BridgeNode = { id: `n${this.nextId++}`, x, y, joint: 'pin' };
    this.nodes.push(node);
    return node;
  }

  /** 2 点を部材でつなぐ。つなげなかったときは理由を返す */
  connect(
    from: { x: number; y: number },
    to: { x: number; y: number },
    material: MaterialId,
    section: SectionId,
  ): string | null {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) return null;
    if (length > this.stage.maxMemberLength + 1e-6) {
      return `部材は ${this.stage.maxMemberLength} m までの長さにしてください`;
    }
    if (!this.canPlaceNode(from.x, from.y) || !this.canPlaceNode(to.x, to.y)) {
      return 'そこには節点を置けません';
    }

    const a = this.nodeAt(from.x, from.y)!;
    const b = this.nodeAt(to.x, to.y)!;
    const duplicate = this.members.some((m) => (m.a === a.id && m.b === b.id) || (m.a === b.id && m.b === a.id));
    if (duplicate) return 'その 2 点はもうつながっています';

    this.members.push({ id: `m${this.nextId++}`, a: a.id, b: b.id, material, section });
    return null;
  }

  removeMember(id: string): void {
    this.members = this.members.filter((m) => m.id !== id);
    this.removeLooseNodes();
  }

  removeNode(id: string): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node || this.isAnchor(node)) return;
    this.members = this.members.filter((m) => m.a !== id && m.b !== id);
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.removeLooseNodes();
  }

  toggleJoint(id: string): void {
    const node = this.nodes.find((n) => n.id === id);
    if (node) node.joint = node.joint === 'pin' ? 'rigid' : 'pin';
  }

  clear(): void {
    this.nodes = this.stage.anchors.map((anchor) => ({ ...anchor }));
    this.members = [];
  }

  /** お手本のプラット・トラスを置く */
  loadSample(): void {
    this.clear();
    const panels = 6;
    const sample = buildPrattTruss({ span: this.stage.span, panels, height: 4 });
    const rename = new Map([
      ['B0', 'anchor-left'],
      [`B${panels}`, 'anchor-right'],
    ]);
    for (const node of sample.nodes) {
      if (!rename.has(node.id)) this.nodes.push({ ...node, support: undefined });
    }
    this.members = sample.members.map((m) => ({
      ...m,
      a: rename.get(m.a) ?? m.a,
      b: rename.get(m.b) ?? m.b,
    }));
  }

  totalCost(): number {
    return this.members.reduce((sum, m) => sum + memberCost(m, this.lengthOf(m)), 0);
  }

  lengthOf(member: BridgeMember): number {
    const a = this.nodes.find((n) => n.id === member.a)!;
    const b = this.nodes.find((n) => n.id === member.b)!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private removeLooseNodes(): void {
    const used = new Set(this.members.flatMap((m) => [m.a, m.b]));
    this.nodes = this.nodes.filter((n) => this.isAnchor(n) || used.has(n.id));
  }
}

export function memberCost(member: BridgeMember, length: number): number {
  return Math.round(length * MATERIALS[member.material].pricePerMeter * SECTIONS[member.section].priceFactor);
}
