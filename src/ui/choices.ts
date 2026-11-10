import { MATERIALS, SECTIONS } from '../engine/materials';
import type { MaterialId, SectionId } from '../engine/types';
import type { Stage } from '../game/stage';
import { COLORS, MATERIAL_COLORS } from './colors';
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

/**
 * ステージを選ぶ画面。章ごとにまとめて並べる。
 * starsOf は取った星の表示（実験モードは空文字）、nextId は「つぎはここ」の印を付けるステージ。
 */
export function stageGroups(
  stages: Stage[],
  starsOf: (stage: Stage) => string,
  nextId: string | undefined,
  onOpen: (stage: Stage) => void,
): HTMLElement[] {
  const chapters = [...new Set(stages.map((stage) => stage.chapter))];
  return chapters.map((chapter) => {
    const inChapter = stages.filter((stage) => stage.chapter === chapter);
    const group = document.createElement('section');
    group.className = 'chapter';
    group.style.setProperty('--count', String(inChapter.length));

    const heading = document.createElement('h2');
    heading.textContent = chapter;
    const cards = document.createElement('div');
    cards.className = 'chapter-cards';
    cards.append(...inChapter.map((stage) => stageCard(stage, starsOf(stage), stage.id === nextId, () => onOpen(stage))));

    group.append(heading, cards);
    return group;
  });
}

function stageCard(stage: Stage, stars: string, isNext: boolean, onOpen: () => void): HTMLButtonElement {
  return choiceButton(
    (isNext ? '<span class="card-next">つぎはここ</span>' : '') +
      stageThumbnail(stage) +
      `<span class="card-title">${stage.title}</span>` +
      `<span class="card-goal">${stage.goal}</span><span class="card-stars">${stars}</span>`,
    false,
    onOpen,
    isNext ? 'stage-card next' : 'stage-card',
  );
}

/** 谷の広さと、はじめから置いてある部材がわかる小さな絵。どのステージも同じ縮尺で描く */
function stageThumbnail(stage: Stage): string {
  const width = 120;
  const height = 48;
  const scale = 4; // 1 m を何 px で描くか
  const roadY = 22;
  const left = (width - stage.span * scale) / 2;
  const at = (x: number, y: number) => `${left + x * scale} ${roadY - y * scale}`;

  const cliff = (x: number) =>
    `<rect x="${x}" y="${roadY}" width="${left}" height="${height - roadY}" fill="${COLORS.cliff}" />` +
    `<rect x="${x}" y="${roadY}" width="${left}" height="2.5" fill="${COLORS.grass}" />`;
  const members = stage.presetMembers
    .map((member) => `<path d="M${at(...member.from)}L${at(...member.to)}" />`)
    .join('');
  const anchors = stage.anchors
    .map((anchor) => `<circle cx="${left + anchor.x * scale}" cy="${roadY - anchor.y * scale}" r="2.2" />`)
    .join('');

  return (
    `<svg class="card-thumb" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
    `<rect width="${width}" height="${height}" fill="${COLORS.sky}" />` +
    `<rect x="${left}" y="${height - 5}" width="${stage.span * scale}" height="5" fill="${COLORS.river}" />` +
    cliff(0) +
    cliff(width - left) +
    `<g stroke="${MATERIAL_COLORS.wood}" stroke-width="1.6" stroke-linecap="round">${members}</g>` +
    `<g fill="#fff" stroke="${COLORS.ink}" stroke-width="1.2">${anchors}</g>` +
    `<text x="${width / 2}" y="${height - 9}" text-anchor="middle" font-size="8" font-weight="700" fill="${COLORS.muted}">${stage.span} m</text>` +
    '</svg>'
  );
}
