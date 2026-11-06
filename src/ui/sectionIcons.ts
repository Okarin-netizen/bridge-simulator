import type { SectionId } from '../engine/types';

/** 断面を選ぶボタンに出す、切り口の形の絵（部材を輪切りにしたところ） */
export const SECTION_ICONS: Record<SectionId, string> = {
  square: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" fill="currentColor"/></svg>',
  pipe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  hbeam:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v3.5h-5.2v9H19V20H5v-3.5h5.2v-9H5z" fill="currentColor"/></svg>',
};
