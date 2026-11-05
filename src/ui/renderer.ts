import type { Vehicle } from '../engine/crossing';
import type { Guess } from '../game/prediction';
import type { BridgeMember, BridgeNode, MemberResult } from '../engine/types';
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
    /** 画面に描くために大きくした、節点のたわみ（m） */
    displacements: Map<string, { dx: number; dy: number }>;
    /** たわみを何倍にしているか（画面のすみに書く） */
    deflectionScale: number;
    /** 車が落ちたきょり（m） */
    fallDistance: number;
    /** こわれた部材が落ちたきょり（m） */
    memberFallDistance: number;
    /** 形がくずれて、橋全体が落ちるか */
    wholeBridgeFalls: boolean;
    /** 車も落ちるか */
    carFalls: boolean;
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
  if (scene.test) {
    drawCar(ctx, camera, scene);
    drawDeflectionNote(ctx, scene.test.deflectionScale, height);
  }

  const unstableNode = scene.design.nodes.find((n) => n.id === scene.test?.unstableNodeId);
  if (unstableNode) {
    const world = drawnPosition(scene, unstableNode);
    const p = camera.toScreen(world.x, world.y);
    drawRing(ctx, p, COLORS.broken);
    drawRing(ctx, p, COLORS.broken, 22);
  }
}

/** 試験中は、たわみを足した位置に節点を描く */
function drawnPosition(scene: Scene, node: BridgeNode): Point {
  const d = scene.test?.displacements.get(node.id);
  return d ? { x: node.x + d.dx, y: node.y + d.dy } : node;
}

/** 落ちていく部材か */
function isFalling(scene: Scene, member: BridgeMember): boolean {
  const test = scene.test;
  return test !== undefined && test.memberFallDistance > 0 && (test.wholeBridgeFalls || test.brokenIds.has(member.id));
}

/** 部材の両はしを描く位置。落ちていく部材は、落ちたきょりの分だけ下げる */
function drawnEndpoints(scene: Scene, member: BridgeMember): [Point, Point] {
  const fall = isFalling(scene, member) ? scene.test!.memberFallDistance : 0;
  return endpoints(scene.design, member).map((node) => {
    const p = drawnPosition(scene, node);
    return { x: p.x, y: p.y - fall };
  }) as [Point, Point];
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
    const [a, b] = drawnEndpoints(scene, member).map((p) => camera.toScreen(p.x, p.y));
    const broken = scene.test?.brokenIds.has(member.id) ?? false;

    // 落ちていく部材は、だんだんうすくする
    ctx.globalAlpha = isFalling(scene, member) ? Math.max(0.25, 1 - scene.test!.memberFallDistance / 8) : 1;
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
  ctx.globalAlpha = 1;
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
    const [a, b] = drawnEndpoints(scene, member).map((p) => camera.toScreen(p.x, p.y));
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
  const test = scene.test;
  for (const node of scene.design.nodes) {
    const world = drawnPosition(scene, node);
    // 橋全体が落ちるときは、支点以外の節点もいっしょに落とす
    const falls = test !== undefined && test.wholeBridgeFalls && !node.support;
    const p = camera.toScreen(world.x, world.y - (falls ? test.memberFallDistance : 0));
    ctx.globalAlpha = falls ? Math.max(0.25, 1 - test.memberFallDistance / 8) : 1;

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
  ctx.globalAlpha = 1;
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

/**
 * 車を描く。橋のたわみに合わせて上下・前後に傾き、こわれたときは谷へ落ちていく。
 * タイヤは走ったきょりに合わせて回す。
 */
function drawCar(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene): void {
  const test = scene.test!;
  const { vehicle, carPosition: position } = test;
  const fallDistance = test.carFalls ? test.fallDistance : 0;
  const roadY = scene.design.stage.roadY;
  const length = vehicle.wheelbase + 1.2;
  const height = vehicle.mass > 5000 ? 3 : 1.5;
  const wheelRadius = 0.4;

  const deck = deckShapeAt(scene, position);
  // 落ちはじめたら、前のめりに傾ける
  const tilt = Math.atan(deck.slope) - Math.min(0.6, fallDistance * 0.15);
  const base = camera.toScreen(position, roadY + deck.dy - fallDistance);

  ctx.save();
  ctx.translate(base.x, base.y);
  ctx.rotate(-tilt);
  const s = camera.scale;

  // 車の後ろにある部材の色も見えるよう、車体は少し透かす
  ctx.fillStyle = 'rgba(245, 184, 61, 0.7)';
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect((-length / 2) * s, -(0.5 + height) * s, length * s, height * s, 6);
  ctx.fill();
  ctx.stroke();

  for (const offset of [-vehicle.wheelbase / 2, vehicle.wheelbase / 2]) {
    const center = { x: offset * s, y: -wheelRadius * s };
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(center.x, center.y, wheelRadius * s, 0, Math.PI * 2);
    ctx.fill();

    // ホイールの線で、タイヤが回っているのがわかるようにする
    const turn = position / wheelRadius;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x - Math.cos(turn) * wheelRadius * s * 0.6, center.y - Math.sin(turn) * wheelRadius * s * 0.6);
    ctx.lineTo(center.x + Math.cos(turn) * wheelRadius * s * 0.6, center.y + Math.sin(turn) * wheelRadius * s * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

/** 車の位置での道路の下がり（m）と傾き。たわんだ道路の節点のあいだを直線でつなぐ */
function deckShapeAt(scene: Scene, x: number): { dy: number; slope: number } {
  const roadY = scene.design.stage.roadY;
  const road = scene.design.nodes
    .filter((node) => Math.abs(node.y - roadY) < 1e-6)
    .map((node) => drawnPosition(scene, node))
    .sort((p, q) => p.x - q.x);

  for (let i = 0; i < road.length - 1; i++) {
    const [left, right] = [road[i], road[i + 1]];
    if (x < left.x || x > right.x) continue;
    const slope = (right.y - left.y) / (right.x - left.x);
    return { dy: left.y + slope * (x - left.x) - roadY, slope };
  }
  return { dy: 0, slope: 0 };
}

function drawDeflectionNote(ctx: CanvasRenderingContext2D, scale: number, screenHeight: number): void {
  if (scale <= 1) return;
  ctx.font = "500 13px 'M PLUS Rounded 1c', system-ui, sans-serif";
  ctx.fillStyle = 'rgba(31, 42, 55, 0.75)';
  ctx.fillText(`たわみは ${scale} 倍に大きくして表示しています`, 12, screenHeight - 12);
}

export function endpoints(design: BridgeDesign, member: BridgeMember): [BridgeNode, BridgeNode] {
  const a = design.nodes.find((n) => n.id === member.a)!;
  const b = design.nodes.find((n) => n.id === member.b)!;
  return [a, b];
}
