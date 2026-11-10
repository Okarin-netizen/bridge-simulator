import { MATERIALS, SECTIONS } from '../engine/materials';
import type { MaterialId, SectionId } from '../engine/types';
import type { Stage } from '../game/stage';
import { MATERIAL_COLORS } from './colors';
import { choiceButton } from './dom';
import { yen } from './format';
import { SECTION_ICONS } from './sectionIcons';

/*
 * 材料・断面・ステージを選ぶボタン。
 * どれが選ばれているかは main.ts が持っていて、押されたら onSelect で知らせる。
 */

export function materialButtons(
  ids: MaterialId[],
  selected: MaterialId,
  onSelect: (id: MaterialId) => void,
): HTMLButtonElement[] {
  // 強さは MPa だとなじみがないので、断面の曲がりにくさと同じく、木材を 1 としたときの何倍かで見せる
  const strengthOf = (id: MaterialId) => Math.round(MATERIALS[id].strength / MATERIALS.wood.strength);
  return ids.map((id) => {
    const material = MATERIALS[id];
    return choiceButton(
      `<span class="material-swatch" style="background:${MATERIAL_COLORS[id]}"></span>${material.name}` +
        `<small>強さ ×${strengthOf(id)}<br>1 m ${yen(material.pricePerMeter)}</small>`,
      selected === id,
      () => onSelect(id),
      'choice',
    );
  });
}

export function sectionButtons(
  ids: SectionId[],
  selected: SectionId,
  onSelect: (id: SectionId) => void,
): HTMLButtonElement[] {
  // 曲がりにくさは、角材を 1 としたときの何倍かで見せる。
  // 押されたときは弱い向きに曲がるので、H形は「押す力」と「曲げ」で倍率がちがう。
  const ratio = (value: number) => {
    const times = value / SECTIONS.square.I;
    const rounded = Math.round(times);
    return times < 2 && Math.abs(times - rounded) > 0.05 ? times.toFixed(1) : rounded.toString();
  };
  return ids.map((id) => {
    const section = SECTIONS[id];
    return choiceButton(
      `<span class="section-icon">${SECTION_ICONS[id]}</span>${section.name}` +
        `<small>押す力 ×${ratio(section.Imin)}・曲げ ×${ratio(section.I)}<br>値段 ×${section.priceFactor}</small>`,
      selected === id,
      () => onSelect(id),
      'choice',
    );
  });
}

/** ステージを選ぶ画面のカード。stars は取った星の表示（実験モードは空文字） */
export function stageCard(stage: Stage, stars: string, onOpen: () => void): HTMLButtonElement {
  return choiceButton(
    `<span class="card-chapter">${stage.chapter}</span><span class="card-title">${stage.title}</span>` +
      `<span class="card-goal">${stage.goal}</span><span class="card-stars">${stars}</span>`,
    false,
    onOpen,
    'stage-card',
  );
}
