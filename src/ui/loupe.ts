import type { Point } from '../engine/types';
import { COLORS, FONT_FAMILY } from './colors';

// 指でなぞっていると、指先が隠れて部材のはしがどこに付くのか見えない。
// そこで、指の少し上に「ルーペ」を出して、指の下を拡大して見せる。

const RADIUS = 56; // ルーペの半径（px）
const ZOOM = 1.8;
const LIFT = 100; // 指先からどれだけはなして出すか（px）

/** ルーペの下に出す一言（部材の長さなど）。ok が false なら赤で出す */
export interface LoupeLabel {
  text: string;
  ok: boolean;
}

/**
 * target（部材のはしが付く点）のまわりを拡大して、finger（指先）の上に描く。
 * キャンバスに描き終わったあとに呼ぶ。
 */
export function drawLoupe(ctx: CanvasRenderingContext2D, target: Point, finger: Point, label?: LoupeLabel): void {
  const canvas = ctx.canvas;
  const width = canvas.clientWidth;
  const center = loupeCenter(finger, width);

  // キャンバスの中身は、画面の拡大率（devicePixelRatio）の分だけ細かく描かれている
  const ratio = canvas.width / width;
  const sourceSize = (RADIUS * 2) / ZOOM;

  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.sky;
  ctx.fill();
  ctx.clip();
  ctx.drawImage(
    canvas,
    (target.x - sourceSize / 2) * ratio,
    (target.y - sourceSize / 2) * ratio,
    sourceSize * ratio,
    sourceSize * ratio,
    center.x - RADIUS,
    center.y - RADIUS,
    RADIUS * 2,
    RADIUS * 2,
  );
  drawCrosshair(ctx, center);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(center.x, center.y, RADIUS, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();

  if (label) drawLabel(ctx, center, label);
}

/** ルーペの下のふちに、黒（だめなときは赤）の札で一言を書く */
function drawLabel(ctx: CanvasRenderingContext2D, center: Point, label: LoupeLabel): void {
  ctx.save();
  ctx.font = `bold 13px ${FONT_FAMILY}`;
  const width = ctx.measureText(label.text).width + 16;
  const y = center.y + RADIUS - 2;
  ctx.fillStyle = label.ok ? COLORS.ink : COLORS.broken;
  ctx.beginPath();
  ctx.roundRect(center.x - width / 2, y - 11, width, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.text, center.x, y + 1);
  ctx.restore();
}

/** ふだんは指の真上。上にはみ出すときは、画面の中央に寄せて横に出す */
function loupeCenter(finger: Point, canvasWidth: number): Point {
  const above = { x: finger.x, y: finger.y - LIFT };
  if (above.y - RADIUS >= 4) return above;
  const side = finger.x < canvasWidth / 2 ? LIFT : -LIFT;
  return { x: finger.x + side, y: Math.max(RADIUS + 4, finger.y) };
}

/** 部材のはしが付く点に、十字の印をつける */
function drawCrosshair(ctx: CanvasRenderingContext2D, center: Point): void {
  const arm = 12;
  ctx.beginPath();
  ctx.moveTo(center.x - arm, center.y);
  ctx.lineTo(center.x + arm, center.y);
  ctx.moveTo(center.x, center.y - arm);
  ctx.lineTo(center.x, center.y + arm);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
}
