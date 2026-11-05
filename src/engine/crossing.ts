import { analyze } from './analyze';
import { GRAVITY } from './materials';
import type { AnalysisResult, Bridge, BridgeMember, BridgeNode, FailureMode, NodeLoad } from './types';

export interface Vehicle {
  id: string;
  name: string;
  /** 重さ（kg） */
  mass: number;
  /** 前後の車輪の間隔（m） */
  wheelbase: number;
}

export const VEHICLES: Vehicle[] = [
  { id: 'kei', name: '軽自動車', mass: 900, wheelbase: 2.4 },
  { id: 'car', name: '乗用車', mass: 1200, wheelbase: 2.7 },
  { id: 'bus', name: 'バス', mass: 11000, wheelbase: 5.5 },
  { id: 'truck', name: '大型トラック', mass: 20000, wheelbase: 6 },
];

export interface BrokenMember {
  id: string;
  mode: FailureMode;
  utilization: number;
}

export interface CrossingFrame {
  /** 車の中心の x 座標（m） */
  position: number;
  result: AnalysisResult;
}

export type CrossingStatus = 'crossed' | 'collapsed' | 'unstable' | 'gap';

export interface CrossingOutcome {
  status: CrossingStatus;
  frames: CrossingFrame[];
  /** こわれた部材。最初の 1 本がこわれた原因で、残りはそれに続いてこわれたもの */
  broken: BrokenMember[];
  /** 試験中にいちばん大きかった負担率 */
  maxUtilization: number;
  /** 車が止まった位置（渡り切った場合は null） */
  stoppedAt: number | null;
  /** 形がくずれたとき、くずれ始めた節点 */
  unstableNodeId?: string;
}

export interface CrossingOptions {
  /** 道路の高さ（m）。この高さの水平な部材を車が走る */
  roadY: number;
  /** 何 m ごとに計算するか */
  step?: number;
}

/** 車を左から右へ少しずつ進め、位置ごとに橋を計算する（準静的解析） */
export function simulateCrossing(bridge: Bridge, vehicle: Vehicle, options: CrossingOptions): CrossingOutcome {
  const step = options.step ?? 0.5;
  const road = findRoad(bridge, options.roadY);
  const outcome: CrossingOutcome = { status: 'crossed', frames: [], broken: [], maxUtilization: 0, stoppedAt: null };

  if (road.gapAt !== null) {
    return { ...outcome, status: 'gap', stoppedAt: road.gapAt };
  }

  const halfBase = vehicle.wheelbase / 2;
  for (let position = road.start - halfBase; position <= road.end + halfBase + 1e-9; position += step) {
    const loads = axleLoads(vehicle, position, road.segments);
    const result = analyze(bridge, loads);

    if (!result.stable) {
      return { ...outcome, status: 'unstable', stoppedAt: position, unstableNodeId: result.unstableNodeId };
    }

    outcome.frames.push({ position, result });
    const worst = Math.max(0, ...result.members.map((m) => m.utilization));
    outcome.maxUtilization = Math.max(outcome.maxUtilization, worst);

    if (worst > 1) {
      outcome.broken = breakProgressively(bridge, loads);
      return { ...outcome, status: 'collapsed', stoppedAt: position };
    }
  }
  return outcome;
}

interface RoadSegment {
  member: BridgeMember;
  left: BridgeNode;
  right: BridgeNode;
}

interface Road {
  start: number;
  end: number;
  segments: RoadSegment[];
  /** 道路がとぎれている位置（つながっていれば null） */
  gapAt: number | null;
}

/** 道路になる部材（roadY の高さにある水平な部材）を左から順に並べる */
function findRoad(bridge: Bridge, roadY: number): Road {
  const nodeById = new Map(bridge.nodes.map((n) => [n.id, n]));
  const onRoad = (node: BridgeNode) => Math.abs(node.y - roadY) < 1e-6;

  const segments: RoadSegment[] = [];
  for (const member of bridge.members) {
    const a = nodeById.get(member.a)!;
    const b = nodeById.get(member.b)!;
    if (!onRoad(a) || !onRoad(b) || a.x === b.x) continue;
    segments.push(a.x < b.x ? { member, left: a, right: b } : { member, left: b, right: a });
  }
  segments.sort((p, q) => p.left.x - q.left.x);

  // 道路は両岸の支点のあいだをつなぐ
  const anchors = bridge.nodes.filter((n) => n.support && onRoad(n)).map((n) => n.x);
  const start = Math.min(...anchors);
  const end = Math.max(...anchors);

  let reached = start;
  for (const segment of segments) {
    if (segment.left.x > reached + 1e-6) break;
    reached = Math.max(reached, segment.right.x);
  }
  const gapAt = reached < end - 1e-6 ? reached : null;

  return { start, end, segments, gapAt };
}

/** 前後の車輪の重さを、その下にある道路部材の両端の節点に分ける */
function axleLoads(vehicle: Vehicle, position: number, segments: RoadSegment[]): NodeLoad[] {
  const axleWeight = (vehicle.mass * GRAVITY) / 2;
  const axles = [position - vehicle.wheelbase / 2, position + vehicle.wheelbase / 2];

  const loads: NodeLoad[] = [];
  for (const x of axles) {
    const segment = segments.find((s) => s.left.x <= x && x <= s.right.x);
    if (!segment) continue; // 橋の外（地面の上）にいる車輪

    const span = segment.right.x - segment.left.x;
    const ratioToRight = (x - segment.left.x) / span;
    loads.push({ node: segment.left.id, fx: 0, fy: -axleWeight * (1 - ratioToRight) });
    loads.push({ node: segment.right.id, fx: 0, fy: -axleWeight * ratioToRight });
  }
  return loads;
}

/**
 * 負担率が 1 を超えた部材を 1 本ずつ取り除いて計算し直し、
 * 続けてこわれる部材を順に記録する。形が保てなくなったら終わり。
 */
function breakProgressively(bridge: Bridge, loads: NodeLoad[]): BrokenMember[] {
  const broken: BrokenMember[] = [];
  let members = [...bridge.members];

  while (members.length > 0) {
    const result = analyze({ nodes: bridge.nodes, members }, loads);
    if (!result.stable) break;

    const worst = result.members.reduce((p, q) => (q.utilization > p.utilization ? q : p));
    if (worst.utilization <= 1) break;

    broken.push({ id: worst.id, mode: worst.mode, utilization: worst.utilization });
    members = members.filter((m) => m.id !== worst.id);
  }
  return broken;
}
