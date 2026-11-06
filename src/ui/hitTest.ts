import type { BridgeMember, BridgeNode, Point } from '../engine/types';
import type { BridgeDesign } from '../game/design';
import type { Camera } from './camera';

/** 指はマウスほど細かく狙えないので、タッチのときは当たり判定を広げる（px） */
const HIT_RADIUS = {
  mouse: { node: 16, member: 10 },
  touch: { node: 22, member: 18 },
};
export type HitRadius = (typeof HIT_RADIUS)['mouse'];

export function hitRadiusFor(event: PointerEvent): HitRadius {
  return event.pointerType === 'touch' ? HIT_RADIUS.touch : HIT_RADIUS.mouse;
}

/** 画面の点（px）のそばにある節点 */
export function findNodeNear(design: BridgeDesign, camera: Camera, screen: Point, hit: HitRadius): BridgeNode | undefined {
  return nearest(design.nodes, hit.node, (node) => {
    const p = camera.toScreen(node.x, node.y);
    return Math.hypot(p.x - screen.x, p.y - screen.y);
  });
}

/** 画面の点（px）のそばにある部材 */
export function findMemberNear(
  design: BridgeDesign,
  camera: Camera,
  screen: Point,
  hit: HitRadius,
): BridgeMember | undefined {
  return nearest(design.members, hit.member, (member) => {
    const [a, b] = design.endsOf(member).map((p) => camera.toScreen(p.x, p.y));
    return distanceToSegment(screen, a, b);
  });
}

/** 当たり判定を広げると候補が重なるので、いちばん近いものを選ぶ */
function nearest<T>(items: readonly T[], radius: number, distanceOf: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestDistance = radius;
  for (const item of items) {
    const distance = distanceOf(item);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function samePoint(p: Point, q: Point): boolean {
  return p.x === q.x && p.y === q.y;
}
