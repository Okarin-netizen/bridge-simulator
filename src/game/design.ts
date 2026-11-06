import { MATERIALS, SECTIONS } from '../engine/materials';
import type { Bridge, BridgeMember, BridgeNode, MaterialId, Point, SectionId } from '../engine/types';
import { buildPrattTruss } from './presets';
import { RIGID_JOINT_PRICE } from './stage';
import type { Stage } from './stage';

/** 「もどす」でさかのぼれる回数 */
const UNDO_LIMIT = 50;

interface Snapshot {
  nodes: BridgeNode[];
  members: BridgeMember[];
}

/**
 * 生徒が組み立て中の橋。節点と部材の追加・削除をまとめて扱う。
 * 支点（stage.anchors）は消せない。
 */
export class BridgeDesign {
  nodes: BridgeNode[] = [];
  members: BridgeMember[] = [];
  private nextId = 1;
  private history: Snapshot[] = [];

  constructor(readonly stage: Stage) {
    this.resetToStage();
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
    this.splitMembersThrough(node);
    return node;
  }

  /** 2 点を部材でつなぐ。つなげなかったときは理由を返す */
  connect(from: Point, to: Point, material: MaterialId, section: SectionId): string | null {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) return null;
    if (length > this.stage.maxMemberLength + 1e-6) {
      return `部材は ${this.stage.maxMemberLength} m までの長さにしてください`;
    }
    if (!this.canPlaceNode(from.x, from.y) || !this.canPlaceNode(to.x, to.y)) {
      return 'そこには節点を置けません';
    }
    if (!this.stage.allowDiagonals && from.x !== to.x && from.y !== to.y) {
      return 'このステージでは斜めの部材は使えません';
    }

    // 途中にある節点を素通りしないよう、節点ごとに区切った部材にする
    const pieces = this.piecesBetween(from, to).filter(([a, b]) => !this.areConnected(a, b));
    if (pieces.length === 0) return 'その 2 点はもうつながっています';

    this.saveForUndo();
    for (const [a, b] of pieces) this.addMember(a, b, material, section);
    return null;
  }

  removeMember(id: string): void {
    if (!this.members.some((m) => m.id === id)) return;
    this.saveForUndo();
    this.members = this.members.filter((m) => m.id !== id);
    this.removeLooseNodes();
  }

  removeNode(id: string): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node || this.isAnchor(node)) return;
    this.saveForUndo();
    this.members = this.members.filter((m) => m.a !== id && m.b !== id);
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.removeLooseNodes();
  }

  toggleJoint(id: string): void {
    if (!this.stage.allowRigidJoints) return;
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    this.saveForUndo();
    node.joint = node.joint === 'pin' ? 'rigid' : 'pin';
  }

  /** ステージのはじめの状態にもどす */
  clear(): void {
    this.saveForUndo();
    this.resetToStage();
  }

  /** お手本のプラット・トラスを置く */
  loadSample(): void {
    this.saveForUndo();
    this.resetToStage();
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
    const memberTotal = this.members.reduce((sum, m) => sum + memberCost(m, this.lengthOf(m)), 0);
    const rigidJoints = this.nodes.filter((n) => n.joint === 'rigid').length;
    return memberTotal + rigidJoints * RIGID_JOINT_PRICE;
  }

  /** 部材の両はしの節点 */
  endsOf(member: BridgeMember): [BridgeNode, BridgeNode] {
    const a = this.nodes.find((n) => n.id === member.a)!;
    const b = this.nodes.find((n) => n.id === member.b)!;
    return [a, b];
  }

  lengthOf(member: BridgeMember): number {
    const [a, b] = this.endsOf(member);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** ひとつ前の形にもどす */
  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.nodes = previous.nodes;
    this.members = previous.members;
  }

  private saveForUndo(): void {
    this.history.push({
      nodes: this.nodes.map((n) => ({ ...n })),
      members: this.members.map((m) => ({ ...m })),
    });
    if (this.history.length > UNDO_LIMIT) this.history.shift();
  }

  private resetToStage(): void {
    this.nodes = this.stage.anchors.map((anchor) => ({ ...anchor }));
    this.members = [];
    for (const preset of this.stage.presetMembers) {
      const [fromX, fromY] = preset.from;
      const [toX, toY] = preset.to;
      this.addMember({ x: fromX, y: fromY }, { x: toX, y: toY }, preset.material ?? 'wood', 'square');
    }
  }

  private addMember(from: Point, to: Point, material: MaterialId, section: SectionId): void {
    const a = this.nodeAt(from.x, from.y)!;
    const b = this.nodeAt(to.x, to.y)!;
    // 新しく置いた節点で、もとからある部材が区切られて、もうつながっていることがある
    if (this.areConnected(from, to)) return;
    this.members.push({ id: `m${this.nextId++}`, a: a.id, b: b.id, material, section });
  }

  private areConnected(from: Point, to: Point): boolean {
    const a = this.findNodeAt(from.x, from.y);
    const b = this.findNodeAt(to.x, to.y);
    if (!a || !b) return false;
    return this.members.some((m) => (m.a === a.id && m.b === b.id) || (m.a === b.id && m.b === a.id));
  }

  /** from から to までを、線の上にある節点で区切った区間にする */
  private piecesBetween(from: Point, to: Point): [Point, Point][] {
    const stops = this.nodes
      .map((node) => ({ node, t: positionAlong(node, from, to) }))
      .filter(({ t }) => t !== null && t > 0 && t < 1)
      .sort((p, q) => p.t! - q.t!)
      .map(({ node }) => ({ x: node.x, y: node.y }));
    const points = [from, ...stops, to];
    return points.slice(1).map((point, i) => [points[i], point]);
  }

  /** 部材の途中に新しい節点を置いたときは、部材をその節点で 2 本に分けてつなぐ */
  private splitMembersThrough(node: BridgeNode): void {
    for (const member of [...this.members]) {
      const a = this.nodes.find((n) => n.id === member.a)!;
      const b = this.nodes.find((n) => n.id === member.b)!;
      const t = positionAlong(node, a, b);
      if (t === null || t <= 0 || t >= 1) continue;

      this.members = this.members.filter((m) => m !== member);
      this.members.push(
        { ...member, id: `m${this.nextId++}`, b: node.id },
        { ...member, id: `m${this.nextId++}`, a: node.id },
      );
    }
  }

  private removeLooseNodes(): void {
    const used = new Set(this.members.flatMap((m) => [m.a, m.b]));
    this.nodes = this.nodes.filter((n) => this.isAnchor(n) || used.has(n.id));
  }
}

/**
 * 点 p が a から b への線の上にあるとき、a から何割進んだところか（0 → 1）を返す。
 * 線の上になければ null。
 */
function positionAlong(p: Point, a: Point, b: Point): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
  if (lengthSquared === 0 || Math.abs(cross) > 1e-6 * lengthSquared) return null;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
}

export function memberCost(member: BridgeMember, length: number): number {
  return Math.round(length * MATERIALS[member.material].pricePerMeter * SECTIONS[member.section].priceFactor);
}
