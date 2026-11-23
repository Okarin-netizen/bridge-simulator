import { VEHICLES } from '../engine/crossing';
import { MATERIALS, SECTIONS } from '../engine/materials';
import type { MaterialId, SectionId } from '../engine/types';
import { defineStage } from './stage';
import type { Stage } from './stage';

/*
 * 先生や生徒が、谷の幅・予算・車・使える材料を決めて作るステージ。
 * 作ったステージはこの端末に覚えておき、リンクにして配ることもできる（サーバーは使わない）。
 */

export interface CustomStageSettings {
  title: string;
  span: number;
  budget: number;
  vehicleId: string;
  vehicleCount: number;
  materials: MaterialId[];
  sections: SectionId[];
  allowRigidJoints: boolean;
  allowDiagonals: boolean;
  /** 岸の下のほうにも支点を置く（斜めの支えを入れられる） */
  lowAnchors: boolean;
  /** 道路より上に部材を置けない（2-2 と同じ） */
  belowRoadOnly: boolean;
}

export interface CustomStageEntry {
  id: string;
  settings: CustomStageSettings;
}

export const CUSTOM_CHAPTER = 'みんなのステージ';
export const SPAN_CHOICES = [8, 12, 16, 20, 24, 28, 32];
export const BUDGET_RANGE = { min: 5_000, max: 300_000, step: 1_000 };
export const TITLE_MAX_LENGTH = 20;
export const MAX_VEHICLE_COUNT = 3;

export const DEFAULT_SETTINGS: CustomStageSettings = {
  title: 'わたしのステージ',
  span: 16,
  budget: 30_000,
  vehicleId: 'car',
  vehicleCount: 1,
  materials: ['wood'],
  sections: ['square'],
  allowRigidJoints: false,
  allowDiagonals: true,
  lowAnchors: false,
  belowRoadOnly: false,
};

/** 決めた条件から、遊べるステージを作る */
export function buildCustomStage(entry: CustomStageEntry): Stage {
  const { settings } = entry;
  const vehicle = VEHICLES.find((v) => v.id === settings.vehicleId)!;
  const cars = settings.vehicleCount > 1 ? ` ${settings.vehicleCount} 台` : '';
  const stage = defineStage({
    id: entry.id,
    chapter: CUSTOM_CHAPTER,
    title: settings.title,
    goal: `${vehicle.name}${cars}を、予算の中でわたらせよう`,
    hint: 'だれかが作ったステージ。これまでに見つけたことを使って、安くて強い橋を考えよう。',
    span: settings.span,
    budget: settings.budget,
    vehicleId: vehicle.id,
    vehicleCount: settings.vehicleCount,
    materials: settings.materials,
    sections: settings.sections,
    allowRigidJoints: settings.allowRigidJoints,
    allowDiagonals: settings.allowDiagonals,
    lowAnchors: settings.lowAnchors,
  });
  if (settings.belowRoadOnly) stage.buildArea = { ...stage.buildArea, maxY: stage.roadY };
  return stage;
}

/**
 * 入ってきた値（リンクや端末の記録）を、遊べる条件にそろえる。
 * リンクはだれでも書きかえられるので、知らない材料や大きすぎる数はここで直す。読めなければ null
 */
export function normalizeSettings(value: unknown): CustomStageSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX_LENGTH) : '';
  const span = SPAN_CHOICES.includes(raw.span as number) ? (raw.span as number) : null;
  const budget = typeof raw.budget === 'number' && Number.isFinite(raw.budget) ? raw.budget : null;
  const vehicle = VEHICLES.find((v) => v.id === raw.vehicleId);
  const materials = pickIds(raw.materials, Object.keys(MATERIALS) as MaterialId[]);
  const sections = pickIds(raw.sections, Object.keys(SECTIONS) as SectionId[]);
  if (span === null || budget === null || !vehicle || materials.length === 0 || sections.length === 0) return null;

  return {
    title: title || DEFAULT_SETTINGS.title,
    span,
    budget: clamp(roundTo(budget, BUDGET_RANGE.step), BUDGET_RANGE.min, BUDGET_RANGE.max),
    vehicleId: vehicle.id,
    vehicleCount: clamp(Math.round(Number(raw.vehicleCount) || 1), 1, MAX_VEHICLE_COUNT),
    materials,
    sections,
    allowRigidJoints: raw.allowRigidJoints === true,
    allowDiagonals: raw.allowDiagonals !== false,
    lowAnchors: raw.lowAnchors === true,
    belowRoadOnly: raw.belowRoadOnly === true,
  };
}

/** 決まった順番のまま、知っている id だけを残す（ワイヤーだけでは道路が作れないので、そのときは木材を足す） */
function pickIds<T extends string>(value: unknown, known: T[]): T[] {
  if (!Array.isArray(value)) return [];
  const picked = known.filter((id) => value.includes(id));
  if (picked.length === 1 && picked[0] === 'wire') return ['wood' as T, ...picked];
  return picked;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// ---------------------------------------------------------------- リンク

const LINK_KEY = 'stage';

/** ステージの条件を、URL の # のうしろに入れられる文字にする */
export function encodeSettings(settings: CustomStageSettings): string {
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSettings(code: string): CustomStageSettings | null {
  try {
    const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return normalizeSettings(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** 配るためのリンク。開くと、このステージがその端末に入る */
export function shareLink(settings: CustomStageSettings, pageUrl: string): string {
  const url = new URL(pageUrl);
  url.hash = `${LINK_KEY}=${encodeSettings(settings)}`;
  return url.toString();
}

/** 開いたページの # に入っているステージ。なければ null */
export function settingsFromHash(hash: string): CustomStageSettings | null {
  const prefix = `#${LINK_KEY}=`;
  return hash.startsWith(prefix) ? decodeSettings(hash.slice(prefix.length)) : null;
}

// ---------------------------------------------------------------- 端末への保存

const STORAGE_KEY = 'kakehashi-lab:custom-stages';

/** この端末で作ったり、リンクから入れたりしたステージ */
export class CustomStageShelf {
  entries: CustomStageEntry[] = load();

  /** 新しく入れる。まったく同じ条件のステージがもうあれば、それを返す（リンクを 2 回開いたときなど） */
  add(settings: CustomStageSettings): CustomStageEntry {
    const same = this.entries.find((entry) => JSON.stringify(entry.settings) === JSON.stringify(settings));
    if (same) return same;
    const entry = { id: `custom-${Date.now().toString(36)}`, settings };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  update(id: string, settings: CustomStageSettings): CustomStageEntry | undefined {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return undefined;
    entry.settings = settings;
    this.save();
    return entry;
  }

  remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // 保存できない環境でも、開いているあいだは遊べる
    }
  }
}

function load(): CustomStageEntry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((item) => {
      const settings = normalizeSettings(item?.settings);
      return typeof item?.id === 'string' && settings ? [{ id: item.id, settings }] : [];
    });
  } catch {
    return [];
  }
}
