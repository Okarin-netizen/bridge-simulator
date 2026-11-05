import type { Vehicle } from '../engine/crossing';
import type { Guess } from '../game/prediction';
import type { BridgeMember, MemberResult } from '../engine/types';
import type { BridgeDesign } from '../game/design';
import type { Camera } from './camera';
import { COLORS, MATERIAL_COLORS, forceColor } from './colors';

export interface Point {
  x: number;
  y: number;
}

export interface Scene {
  design: BridgeDesign;
  /** 部材をつないでいる途中の線 */
  preview?: { from: Point; to: Point; valid: boolean };
  /** つなぎ始めの点（タップで 2 点を選ぶとき） */
  pending?: Point;
  selectedMemberId?: string;
  /** 生徒の予想（部材の上に細い線で示す） */
  guesses?: Map<string, Guess>;
  /** 試験中・試験後の表示 */
  test?: {
    results: Map<string, MemberResult>;
    brokenIds: Set<string>;
    vehicle: Vehicle;
    carPosition: number;
    /** 形がくずれた節点（赤い丸で示す） */
    unstableNodeId?: string;
    /** 予想がはずれた部材（× で示す） */
    wrongGuessIds: Set<string>;
  };
}

const MEMBER_WIDTH = 7;
const NODE_RADIUS = 6;

export function drawScene(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene): void {
  const { width, height } = ctx.canvas.getBoundingClientRect();
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, width, height);

  if (!scene.test) drawGrid(ctx, camera, scene.design);
  drawTerrain(ctx, camera, scene.design, { width, height });
  drawMembers(ctx, camera, scene);
  if (!scene.test) drawGuesses(ctx, camera, scene);
  drawNodes(ctx, camera, scene);
  if (scene.test) drawWrongGuesses(ctx, camera, scene);

  if (scene.preview) drawPreview(ctx, camera, scene.preview);
  if (scene.pending) drawRing(ctx, camera.toScreen(scene.pending.x, scene.pending.y), COLORS.accent);
  if (scene.test) drawCar(ctx, camera, scene.test.vehicle, scene.test.carPosition, scene.design.stage.roadY);

  const unstableNode = scene.design.nodes.find((n) => n.id === scene.test?.unstableNodeId);
  if (unstableNode) {
    const p = camera.toScreen(unstableNode.x, unstableNode.y);
    drawRing(ctx, p, COLORS.broken);
    drawRing(ctx, p, COLORS.broken, 22);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, design: BridgeDesign): void {
  const { minX, maxX, minY, maxY } = design.stage.buildArea;
  const step = design.stage.gridSize;
  ctx.fillStyle = COLORS.gridDot;
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      const p = camera.toScreen(x, y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  design: BridgeDesign,
  screen: { width: number; height: number },
): void {
  const { span, roadY, depth } = design.stage;
  const top = camera.toScreen(0, roadY).y;
  const bottom = camera.toScreen(0, roadY - depth).y;
  const left = camera.toScreen(0, 0).x;
  const right = camera.toScreen(span, 0).x;
  const grassHeight = 0.4 * camera.scale;

  // 両岸のがけ
  ctx.fillStyle = COLORS.cliff;
  ctx.fillRect(0, top, left, screen.height - top);
  ctx.fillRect(right, top, screen.width - right, screen.height - top);
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, top, left, grassHeight);
  ctx.fillRect(right, top, screen.width - right, grassHeight);

  // 谷底の川
  ctx.fillStyle = COLORS.river;
  ctx.fillRect(left, bottom, right - left, screen.height - bottom);
}

function drawMembers(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene): void {
  ctx.lineCap = 'round';
  for (const member of scene.design.members) {
    const [a, b] = endpoints(scene.design, member).map((p) => camera.toScreen(p.x, p.y));
    const broken = scene.test?.brokenIds.has(member.id) ?? false;

    ctx.lineWidth = MEMBER_WIDTH;
    ctx.strokeStyle = memberColor(member, scene);
    ctx.setLineDash(broken ? [6, 6] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    if (member.id === scene.selectedMemberId) {
      ctx.lineWidth = MEMBER_WIDTH + 8;
      ctx.strokeStyle = 'rgba(31, 42, 55, 0.25)';
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

function drawGuesses(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene): void {
  for (const member of scene.design.members) {
    const guess = scene.guesses?.get(member.id);
    if (!guess) continue;
    const [a, b] = endpoints(scene.design, member).map((p) => camera.toScreen(p.x, p.y));
    ctx.lineWidth = MEMBER_WIDTH + 6;
    ctx.strokeStyle = guess === 'compression' ? 'rgb(197, 58, 28)' : 'rgb(30, 64, 175)';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawWrongGuesses(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene): void {
  for (const member of scene.design.members) {
    if (!scene.test?.wrongGuessIds.has(member.id)) continue;
    const [a, b] = endpoints(scene.design, member).map((p) => camera.toScreen(p.x, p.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mid.x - 5, mid.y - 5);
    ctx.lineTo(mid.x + 5, mid.y + 5);
    ctx.moveTo(mid.x + 5, mid.y - 5);
    ctx.lineTo(mid.x - 5, mid.y + 5);
    ctx.stroke();
  }
}

function memberColor(member: BridgeMember, scene: Scene): string {
  if (!scene.test) return MATERIAL_COLORS[member.material];
  if (scene.test.brokenIds.has(member.id)) return COLORS.broken;
  const result = scene.test.results.get(member.id);
  return result ? forceColor(result.axial, result.utilization) : MATERIAL_COLORS[member.material];
}

function drawNodes(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene): void {
  for (const node of scene.design.nodes) {
    const p = camera.toScreen(node.x, node.y);

    if (node.support) drawSupport(ctx, p, node.support === 'roller');

    // 剛接合は四角、ピン接合は丸で描く
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (node.joint === 'rigid') {
      ctx.rect(p.x - NODE_RADIUS, p.y - NODE_RADIUS, NODE_RADIUS * 2, NODE_RADIUS * 2);
    } else {
      ctx.arc(p.x, p.y, NODE_RADIUS, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }
}

function drawSupport(ctx: CanvasRenderingContext2D, p: Point, roller: boolean): void {
  ctx.fillStyle = COLORS.ink;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - 10, p.y + 16);
  ctx.lineTo(p.x + 10, p.y + 16);
  ctx.closePath();
  ctx.fill();
  if (roller) {
    for (const dx of [-6, 6]) {
      ctx.beginPath();
      ctx.arc(p.x + dx, p.y + 20, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPreview(ctx: CanvasRenderingContext2D, camera: Camera, preview: NonNullable<Scene['preview']>): void {
  const a = camera.toScreen(preview.from.x, preview.from.y);
  const b = camera.toScreen(preview.to.x, preview.to.y);
  ctx.lineWidth = MEMBER_WIDTH;
  ctx.strokeStyle = preview.valid ? COLORS.accent : COLORS.broken;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawRing(ctx, b, preview.valid ? COLORS.accent : COLORS.broken);
}

function drawRing(ctx: CanvasRenderingContext2D, p: Point, color: string, radius = NODE_RADIUS + 7): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCar(ctx: CanvasRenderingContext2D, camera: Camera, vehicle: Vehicle, position: number, roadY: number): void {
  const length = vehicle.wheelbase + 1.2;
  const height = vehicle.mass > 5000 ? 3 : 1.5;
  const wheelRadius = 0.4 * camera.scale;
  const bodyBottom = roadY + 0.5;

  const topLeft = camera.toScreen(position - length / 2, bodyBottom + height);
  const bottomRight = camera.toScreen(position + length / 2, bodyBottom);
  // 車の後ろにある部材の色も見えるよう、車体は少し透かす
  ctx.fillStyle = 'rgba(245, 184, 61, 0.7)';
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLORS.ink;
  for (const offset of [-vehicle.wheelbase / 2, vehicle.wheelbase / 2]) {
    const wheel = camera.toScreen(position + offset, roadY + 0.4);
    ctx.beginPath();
    ctx.arc(wheel.x, wheel.y, wheelRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function endpoints(design: BridgeDesign, member: BridgeMember): [Point, Point] {
  const a = design.nodes.find((n) => n.id === member.a)!;
  const b = design.nodes.find((n) => n.id === member.b)!;
  return [a, b];
}
