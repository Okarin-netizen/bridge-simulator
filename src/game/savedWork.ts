import type { Bridge } from '../engine/types';

/**
 * ステージごとに、最後に組んでいた橋と振り返りの文を端末のブラウザに覚えておく。
 * ページを開き直しても、2 コマ目の授業でも、前の続きから作れるようにするため。
 */
const STORAGE_KEY = 'kakehashi-lab:work';

export interface SavedWork {
  bridge: Bridge;
  reflection: string;
}

export function loadWork(stageId: string): SavedWork | undefined {
  const work = readAll()[stageId];
  if (!isRecord(work) || !isRecord(work.bridge)) return undefined;
  const { nodes, members } = work.bridge;
  if (!Array.isArray(nodes) || !Array.isArray(members)) return undefined;
  return {
    bridge: { nodes, members },
    reflection: typeof work.reflection === 'string' ? work.reflection : '',
  };
}

export function saveWork(stageId: string, work: SavedWork): void {
  const all = readAll();
  all[stageId] = work;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 保存できない環境（プライベートブラウズなど）でも、遊んでいるあいだはそのまま使える
  }
}

function readAll(): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return isRecord(saved) ? saved : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
