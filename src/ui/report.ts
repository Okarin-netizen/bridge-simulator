import { COLORS } from './colors';

export interface ReportContent {
  /** 保存するファイル名に使う（日本語のファイル名は端末によって無視されるため英数字にする） */
  stageId: string;
  stageTitle: string;
  resultTitle: string;
  lines: string[];
  reflection: string;
}

const WIDTH = 1200;
const PADDING = 48;
const FONT = "'M PLUS Rounded 1c', system-ui, sans-serif";

/**
 * 振り返りシートを 1 枚の画像にする。
 * 橋の絵（いまのキャンバス）と結果、生徒が書いた気づきを並べる。
 * Google Classroom などにそのまま提出できるよう PNG で保存する。
 */
export function saveReportImage(bridgeCanvas: HTMLCanvasElement, content: ReportContent): void {
  const pictureHeight = Math.round((WIDTH - PADDING * 2) * (bridgeCanvas.height / bridgeCanvas.width));
  const reflectionLines = wrapText(content.reflection || '（まだ書いていません）', 44);
  const height = 140 + pictureHeight + 40 + content.lines.length * 36 + 80 + reflectionLines.length * 36 + PADDING;

  const sheet = document.createElement('canvas');
  sheet.width = WIDTH;
  sheet.height = height;
  const ctx = sheet.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(`かけはしラボ　振り返りシート　${new Date().toLocaleDateString('ja-JP')}`, PADDING, 60);
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(`${content.stageTitle}：${content.resultTitle}`, PADDING, 110);

  ctx.drawImage(bridgeCanvas, PADDING, 140, WIDTH - PADDING * 2, pictureHeight);

  let y = 140 + pictureHeight + 60;
  ctx.font = `500 24px ${FONT}`;
  for (const line of content.lines) {
    ctx.fillText(line, PADDING, y);
    y += 36;
  }

  y += 30;
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText('気づいたこと', PADDING, y);
  y += 40;
  ctx.font = `500 24px ${FONT}`;
  for (const line of reflectionLines) {
    ctx.fillText(line, PADDING, y);
    y += 36;
  }

  sheet.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `kakehashi-${content.stageId}.png`;
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

/** 日本語の文を、決まった文字数ごとに折り返す */
function wrapText(text: string, charsPerLine: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    for (let i = 0; i < paragraph.length; i += charsPerLine) {
      lines.push(paragraph.slice(i, i + charsPerLine));
    }
    if (paragraph.length === 0) lines.push('');
  }
  return lines;
}
