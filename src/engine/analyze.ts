import { GRAVITY, isTensionOnly, MATERIALS, sectionOf } from './materials';
import { solveLinearSystem } from './linalg';
import type {
  AnalysisResult,
  Bridge,
  BridgeMember,
  BridgeNode,
  FailureMode,
  MemberResult,
  NodeLoad,
} from './types';

/*
 * 直接剛性法による 2 次元骨組みの解析。
 *
 * 節点ごとに 3 つの自由度（x 方向の移動 u、y 方向の移動 v、回転 θ）を持たせる。
 * 部材は「梁要素」として扱い、ピン接合の端では曲げモーメントを解放する。
 * 両端がピンの部材は、軸力だけを伝える「トラス要素」と同じ働きになる。
 * こうすることで、トラス構造とラーメン構造を同じ計算で扱える。
 *
 * ワイヤーは引っぱる力しか伝えない。いちばん強く押されているワイヤーを「たるんだ」ものとして 1 本ずつ外し、
 * 外したワイヤーがまた引っぱられる向きになったら戻す、をくり返して、つり合う形を探す。
 * まとめて外さないのは、たすきがけの 2 本が両方とも少し押されているとき、片方だけ外せば形が保てるため。
 */

const DOF_PER_NODE = 3;

interface MemberGeometry {
  member: BridgeMember;
  nodeA: BridgeNode;
  nodeB: BridgeNode;
  length: number;
  cos: number;
  sin: number;
}

export interface AnalyzeOptions {
  /** 部材の自重を荷重に含めるか（初期値 true） */
  includeSelfWeight?: boolean;
}

export function analyze(bridge: Bridge, loads: NodeLoad[], options: AnalyzeOptions = {}): AnalysisResult {
  const includeSelfWeight = options.includeSelfWeight ?? true;

  // 部材につながっている節点だけを計算に使う
  const usedNodeIds = new Set(bridge.members.flatMap((m) => [m.a, m.b]));
  const nodes = bridge.nodes.filter((n) => usedNodeIds.has(n.id));
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const geometries = bridge.members.map((member) => describeMember(member, nodeById));

  // 重さは、たるんだワイヤーの分もふくめて、はじめに決めておく
  const f = loadVector(nodes.length, nodeIndex, loads, includeSelfWeight ? geometries : []);

  // たるんだワイヤーを探しなおす回数の上限。ワイヤーを 1 本ずつ外すので、本数に合わせる
  const wireCount = geometries.filter((g) => isTensionOnly(g.member.material)).length;
  const attempts = 2 * wireCount + 5;

  let slackIds = new Set<string>();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const active = geometries.filter((g) => !slackIds.has(g.member.id));
    const solved = solveFrame(nodes, nodeIndex, active, f);
    if (!solved.stable) return unstableResult(solved.unstableNodeId, slackIds);

    const nextSlackIds = nextSlackWires(geometries, slackIds, solved.u, nodeIndex);
    if (sameIds(nextSlackIds, slackIds)) {
      const members = geometries.map((geometry) =>
        slackIds.has(geometry.member.id) ? slackResult(geometry) : memberResult(geometry, solved.u, nodeIndex),
      );
      return { stable: true, members, displacements: solved.displacements, reactions: solved.reactions };
    }
    slackIds = nextSlackIds;
  }
  // たるむ・張るが決まらずに行ったり来たりするのは、形が定まらないとき
  return unstableResult(nodes[0]?.id);
}

interface SolvedFrame {
  stable: true;
  /** 全体座標系での、すべての自由度の変位 */
  u: number[];
  displacements: AnalysisResult['displacements'];
  reactions: AnalysisResult['reactions'];
}

/** 決まった部材の組み合わせで、剛性マトリクスを組み立てて解く */
function solveFrame(
  nodes: BridgeNode[],
  nodeIndex: Map<string, number>,
  geometries: MemberGeometry[],
  f: number[],
): SolvedFrame | { stable: false; unstableNodeId: string } {
  const size = nodes.length * DOF_PER_NODE;
  const K = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (const geometry of geometries) {
    const kGlobal = globalStiffness(geometry);
    const dofs = memberDofs(geometry, nodeIndex);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) K[dofs[i]][dofs[j]] += kGlobal[i][j];
    }
  }

  // 動かない自由度（支点、ピン接合の回転）を決めて、残りの自由度だけで解く
  const fixedDofs = findFixedDofs(nodes, geometries);
  const freeDofs = [...Array(size).keys()].filter((dof) => !fixedDofs.has(dof));

  const reducedK = freeDofs.map((i) => freeDofs.map((j) => K[i][j]));
  const reducedF = freeDofs.map((i) => f[i]);
  const solved = solveLinearSystem(reducedK, reducedF);

  if ('singularColumn' in solved) {
    const unstableNode = nodes[Math.floor(freeDofs[solved.singularColumn] / DOF_PER_NODE)];
    return { stable: false, unstableNodeId: unstableNode.id };
  }

  const u = new Array<number>(size).fill(0);
  freeDofs.forEach((dof, i) => (u[dof] = solved.solution[i]));

  const displacements = new Map(
    nodes.map((node, i) => [
      node.id,
      { dx: u[i * DOF_PER_NODE], dy: u[i * DOF_PER_NODE + 1], rot: u[i * DOF_PER_NODE + 2] },
    ]),
  );

  const reactions = new Map<string, { rx: number; ry: number; m: number }>();
  nodes.forEach((node, i) => {
    if (!node.support) return;
    const [rx, ry, m] = [0, 1, 2].map((k) => {
      const row = i * DOF_PER_NODE + k;
      const internal = K[row].reduce((sum, value, col) => sum + value * u[col], 0);
      return internal - f[row];
    });
    reactions.set(node.id, { rx, ry, m });
  });

  return { stable: true, u, displacements, reactions };
}

function loadVector(
  nodeCount: number,
  nodeIndex: Map<string, number>,
  loads: NodeLoad[],
  weighed: MemberGeometry[],
): number[] {
  const f = new Array<number>(nodeCount * DOF_PER_NODE).fill(0);
  for (const load of loads) {
    const index = nodeIndex.get(load.node);
    if (index === undefined) continue;
    f[index * DOF_PER_NODE] += load.fx;
    f[index * DOF_PER_NODE + 1] += load.fy;
  }
  // 部材の自重は、半分ずつ両はしの節点にかける
  for (const geometry of weighed) {
    const weight = memberMass(geometry) * GRAVITY;
    f[nodeIndex.get(geometry.nodeA.id)! * DOF_PER_NODE + 1] -= weight / 2;
    f[nodeIndex.get(geometry.nodeB.id)! * DOF_PER_NODE + 1] -= weight / 2;
  }
  return f;
}

/**
 * 次に試す、たるんだワイヤーの組み合わせ。
 * たるませていたワイヤーのうち、両はしが離れた（引っぱられる向きになった）ものは張りなおし、
 * 張っているワイヤーのうち、いちばん縮もうとしている 1 本をたるませる
 */
function nextSlackWires(
  geometries: MemberGeometry[],
  slackIds: Set<string>,
  u: number[],
  nodeIndex: Map<string, number>,
): Set<string> {
  const next = new Set<string>();
  let mostSqueezed: { id: string; strain: number } | null = null;
  for (const geometry of geometries) {
    if (!isTensionOnly(geometry.member.material)) continue;
    const { id } = geometry.member;
    const strain = elongation(geometry, u, nodeIndex) / geometry.length;
    if (slackIds.has(id)) {
      if (strain <= 0) next.add(id);
    } else if (strain < 0 && (!mostSqueezed || strain < mostSqueezed.strain)) {
      mostSqueezed = { id, strain };
    }
  }
  if (mostSqueezed) next.add(mostSqueezed.id);
  return next;
}

/** 部材の両はしが、部材の向きにどれだけ離れたか（m）。縮んだときはマイナス */
function elongation(geometry: MemberGeometry, u: number[], nodeIndex: Map<string, number>): number {
  const [ua, va, , ub, vb] = memberDofs(geometry, nodeIndex).map((dof) => u[dof]);
  return (ub - ua) * geometry.cos + (vb - va) * geometry.sin;
}

function sameIds(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function unstableResult(unstableNodeId: string | undefined, slackIds = new Set<string>()): AnalysisResult {
  return {
    stable: false,
    unstableNodeId,
    slackWireIds: [...slackIds],
    members: [],
    displacements: new Map(),
    reactions: new Map(),
  };
}

function slackResult(geometry: MemberGeometry): MemberResult {
  return {
    id: geometry.member.id,
    length: geometry.length,
    axial: 0,
    moment: 0,
    utilization: 0,
    mode: 'tension',
    slack: true,
  };
}

/** いちばん苦しい部材の負担率（部材がなければ 0） */
export function worstUtilization(members: MemberResult[]): number {
  return Math.max(0, ...members.map((m) => m.utilization));
}

function describeMember(member: BridgeMember, nodeById: Map<string, BridgeNode>): MemberGeometry {
  const nodeA = nodeById.get(member.a);
  const nodeB = nodeById.get(member.b);
  if (!nodeA || !nodeB) throw new Error(`部材 ${member.id} の節点が見つかりません`);

  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error(`部材 ${member.id} の長さが 0 です`);

  return { member, nodeA, nodeB, length, cos: dx / length, sin: dy / length };
}

function memberMass({ member, length }: Pick<MemberGeometry, 'member' | 'length'>): number {
  return MATERIALS[member.material].density * sectionOf(member).A * length;
}

function memberDofs(geometry: MemberGeometry, nodeIndex: Map<string, number>): number[] {
  const a = nodeIndex.get(geometry.nodeA.id)! * DOF_PER_NODE;
  const b = nodeIndex.get(geometry.nodeB.id)! * DOF_PER_NODE;
  return [a, a + 1, a + 2, b, b + 1, b + 2];
}

/** 部材座標系での剛性マトリクス（ピン接合の端はモーメントを解放したもの） */
function localStiffness(geometry: MemberGeometry): number[][] {
  const { E } = MATERIALS[geometry.member.material];
  const { A, I } = sectionOf(geometry.member);
  const L = geometry.length;

  const axial = (E * A) / L;
  // ワイヤーは曲げを伝えないので、軸の向きの硬さだけ
  if (isTensionOnly(geometry.member.material)) {
    return [
      [axial, 0, 0, -axial, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [-axial, 0, 0, axial, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ];
  }
  const b1 = (12 * E * I) / L ** 3;
  const b2 = (6 * E * I) / L ** 2;
  const b3 = (4 * E * I) / L;
  const b4 = (2 * E * I) / L;

  const k = [
    [axial, 0, 0, -axial, 0, 0],
    [0, b1, b2, 0, -b1, b2],
    [0, b2, b3, 0, -b2, b4],
    [-axial, 0, 0, axial, 0, 0],
    [0, -b1, -b2, 0, b1, -b2],
    [0, b2, b4, 0, -b2, b3],
  ];

  // ピン接合の端の回転を「静的縮約」で消去する。両端ピンなら軸力だけが残る。
  if (geometry.nodeA.joint === 'pin') releaseDof(k, 2);
  if (geometry.nodeB.joint === 'pin') releaseDof(k, 5);
  return k;
}

function releaseDof(k: number[][], r: number): void {
  const pivot = k[r][r];
  for (let i = 0; i < 6; i++) {
    if (i === r) continue;
    for (let j = 0; j < 6; j++) {
      if (j === r) continue;
      k[i][j] -= (k[i][r] * k[r][j]) / pivot;
    }
  }
  for (let i = 0; i < 6; i++) {
    k[i][r] = 0;
    k[r][i] = 0;
  }
}

/** 部材座標系の変位 = T × 全体座標系の変位 */
function transformation({ cos: c, sin: s }: MemberGeometry): number[][] {
  return [
    [c, s, 0, 0, 0, 0],
    [-s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, s, 0],
    [0, 0, 0, -s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}

/** 全体座標系での剛性マトリクス Tᵀ k T */
function globalStiffness(geometry: MemberGeometry): number[][] {
  const k = localStiffness(geometry);
  const T = transformation(geometry);
  const kT = multiply(k, T);
  return multiply(transpose(T), kT);
}

function findFixedDofs(nodes: BridgeNode[], geometries: MemberGeometry[]): Set<number> {
  // 曲げを伝える部材（ワイヤー以外）がつながっている節点
  const bentNodeIds = new Set(
    geometries
      .filter((g) => !isTensionOnly(g.member.material))
      .flatMap((g) => [g.nodeA.id, g.nodeB.id]),
  );
  const fixed = new Set<number>();
  nodes.forEach((node, i) => {
    const base = i * DOF_PER_NODE;
    if (node.support === 'pin' || node.support === 'fixed') fixed.add(base);
    if (node.support) fixed.add(base + 1);
    // ピン接合の節点はどの部材にも回転を伝えないので、回転の自由度は計算から外す。
    // ワイヤーだけがつながる節点も、回転を止めるものがないので外す
    if (node.support === 'fixed' || node.joint === 'pin' || !bentNodeIds.has(node.id)) fixed.add(base + 2);
  });
  return fixed;
}

function memberResult(geometry: MemberGeometry, u: number[], nodeIndex: Map<string, number>): MemberResult {
  const globalDisplacement = memberDofs(geometry, nodeIndex).map((dof) => u[dof]);
  const localDisplacement = multiplyVector(transformation(geometry), globalDisplacement);
  const endForces = multiplyVector(localStiffness(geometry), localDisplacement);

  // B 端で部材の軸方向にはたらく力が、そのまま軸力（引張が正）になる
  const axial = endForces[3];
  const moment = Math.max(Math.abs(endForces[2]), Math.abs(endForces[5]));
  const { utilization, mode } = judgeStrength(geometry, axial, moment);

  return { id: geometry.member.id, length: geometry.length, axial, moment, utilization, mode };
}

/**
 * 部材がどれだけ限界に近いか（負担率）を求める。
 * - 引張・圧縮：軸力による応力 + 曲げによる応力 が材料の強さを超えるとこわれる
 * - 座屈：押す力がオイラーの座屈荷重 π²EI/L² を超えると横に曲がってこわれる。
 *   I はいちばん曲がりやすい向きの値（H形なら横向き）を使う
 */
function judgeStrength(
  geometry: MemberGeometry,
  axial: number,
  moment: number,
): { utilization: number; mode: FailureMode } {
  const { E, strength } = MATERIALS[geometry.member.material];
  const { A, Imin, Z } = sectionOf(geometry.member);
  // ワイヤーは引っぱられたときだけ力を受ける（押される向きのときは、ここに来る前にたるませている）
  if (isTensionOnly(geometry.member.material)) {
    return { utilization: Math.max(0, axial) / (strength * A), mode: 'tension' };
  }

  const axialRatio = Math.abs(axial) / (strength * A);
  const bendingRatio = moment / (strength * Z);
  const strengthRatio = axialRatio + bendingRatio;

  let strengthMode: FailureMode = axial >= 0 ? 'tension' : 'compression';
  if (bendingRatio > axialRatio) strengthMode = 'bending';

  if (axial < 0) {
    const bucklingLoad = (Math.PI ** 2 * E * Imin) / geometry.length ** 2;
    const bucklingRatio = -axial / bucklingLoad;
    if (bucklingRatio > strengthRatio) return { utilization: bucklingRatio, mode: 'buckling' };
  }
  return { utilization: strengthRatio, mode: strengthMode };
}

function multiply(a: number[][], b: number[][]): number[][] {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
}

function transpose(a: number[][]): number[][] {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

function multiplyVector(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((sum, value, k) => sum + value * v[k], 0));
}
