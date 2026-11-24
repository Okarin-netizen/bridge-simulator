import type { Bridge } from '../engine/types';

/**
 * ステージごとに、最後に組んでいた橋と振り返りの文を端末のブラウザに覚えておく。
 * ページを開き直しても、2 コマ目の授業でも、前の続きから作れるようにするため。
 */
const STORAGE_KEY = 'kakehashi-lab:work';
/** 最後に遊んだステージ。タイトル画面の「続きから」で、そのステージにもどる */
const LAST_STAGE_KEY = 'kakehashi-lab:last-stage';

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

export function loadLastStageId(): string | undefined {
  try {
    return localStorage.getItem(LAST_STAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveLastStageId(stageId: string): void {
  try {
    localStorage.setItem(LAST_STAGE_KEY, stageId);
  } catch {
    // 覚えておけなくても、ステージ選択から選びなおせる
  }
}

/** タイトル画面の「はじめから」で、組んだ橋と振り返りと、最後に遊んだステージを消す */
export function forgetAllWork(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_STAGE_KEY);
  } catch {
    // 消せない環境では、もともと保存もされていない
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
