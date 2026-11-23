import { VEHICLES } from '../engine/crossing';
import { MATERIALS, SECTIONS } from '../engine/materials';
import type { MaterialId, SectionId } from '../engine/types';
import {
  BUDGET_RANGE,
  CUSTOM_CHAPTER,
  MAX_VEHICLE_COUNT,
  SPAN_CHOICES,
  TITLE_MAX_LENGTH,
} from '../game/customStage';
import type { CustomStageEntry, CustomStageSettings } from '../game/customStage';
import type { Stage } from '../game/stage';
import { stageCard } from './choices';
import { choiceButton } from './dom';
import { tons } from './format';

/*
 * 「みんなのステージ」の一覧と、ステージを作る・直すための入力欄。
 * 入力欄の中身を作るだけで、作ったステージをどう覚えて開くかは main.ts が決める。
 */

export interface CustomStageCard {
  entry: CustomStageEntry;
  stage: Stage;
  record: string;
}

/** ステージ選択の画面の最後に出す「みんなのステージ」。作ったステージと「ステージをつくる」のカード */
export function customStageGroup(
  cards: CustomStageCard[],
  actions: { open: (stage: Stage) => void; edit: (entry: CustomStageEntry) => void; create: () => void },
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'chapter custom-chapter';
  group.style.setProperty('--count', String(cards.length + 1));

  const heading = document.createElement('h2');
  heading.textContent = CUSTOM_CHAPTER;
  const list = document.createElement('div');
  list.className = 'chapter-cards';

  for (const { entry, stage, record } of cards) {
    const wrap = document.createElement('div');
    wrap.className = 'custom-card';
    wrap.append(
      stageCard(stage, record, false, () => actions.open(stage)),
      choiceButton('直す・配る', false, () => actions.edit(entry), 'tool custom-edit'),
    );
    list.append(wrap);
  }
  list.append(
    choiceButton(
      '<span class="make-plus">＋</span><span class="card-title">ステージをつくる</span>' +
        '<span class="card-goal">谷の幅・予算・車・材料を決めて、課題を作ろう。リンクで配れるよ。</span>',
      false,
      actions.create,
      'stage-card make-card',
    ),
  );

  group.append(heading, list);
  return group;
}

export interface StageMakerOptions {
  /** 作ったステージを直しているとき、そのステージを配るリンク */
  link?: string;
}

export interface StageMakerActions {
  save: (settings: CustomStageSettings) => void;
  cancel: () => void;
  /** 作ったステージを消す（直しているときだけ） */
  remove?: () => void;
}

/** ステージを作る・直す入力欄 */
export function stageMakerForm(
  settings: CustomStageSettings,
  options: StageMakerOptions,
  actions: StageMakerActions,
): HTMLElement {
  const form = document.createElement('form');
  form.className = 'maker-form';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.save(readForm());
  });

  const title = textInput(settings.title);
  const span = select(
    SPAN_CHOICES.map((value) => [String(value), `${value} m`]),
    String(settings.span),
  );
  const budget = numberInput(settings.budget);
  const vehicle = select(
    VEHICLES.map((v) => [v.id, `${v.name} ${tons(v.mass)}`]),
    settings.vehicleId,
  );
  const count = select(
    Array.from({ length: MAX_VEHICLE_COUNT }, (_, i) => [String(i + 1), `${i + 1} 台`]),
    String(settings.vehicleCount),
  );
  const materials = checkboxes(
    (Object.keys(MATERIALS) as MaterialId[]).map((id) => [id, MATERIALS[id].name]),
    settings.materials,
  );
  const sections = checkboxes(
    (Object.keys(SECTIONS) as SectionId[]).map((id) => [id, SECTIONS[id].name]),
    settings.sections,
  );
  const rules = checkboxes(
    [
      ['allowRigidJoints', '剛接合を使える'],
      ['allowDiagonals', '斜めの部材を使える'],
      ['lowAnchors', '岸の下にも支点を置く'],
      ['belowRoadOnly', '道路より上に組めない'],
    ],
    (['allowRigidJoints', 'allowDiagonals', 'lowAnchors', 'belowRoadOnly'] as const).filter((key) => settings[key]),
  );

  function readForm(): CustomStageSettings {
    const checkedRules = checkedValues(rules);
    return {
      title: title.value,
      span: Number(span.value),
      budget: Number(budget.value),
      vehicleId: vehicle.value,
      vehicleCount: Number(count.value),
      materials: checkedValues(materials) as MaterialId[],
      sections: checkedValues(sections) as SectionId[],
      allowRigidJoints: checkedRules.includes('allowRigidJoints'),
      allowDiagonals: checkedRules.includes('allowDiagonals'),
      lowAnchors: checkedRules.includes('lowAnchors'),
      belowRoadOnly: checkedRules.includes('belowRoadOnly'),
    };
  }

  // 材料と断面は、1 つも選ばないと橋が作れないので、作るボタンを押せなくする
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'primary';
  saveButton.textContent = options.link ? '直して遊ぶ' : '作って遊ぶ';
  const problem = document.createElement('p');
  problem.className = 'maker-problem';
  const checkChoices = () => {
    const missing = checkedValues(materials).length === 0 ? '材料' : checkedValues(sections).length === 0 ? '断面' : '';
    saveButton.disabled = missing !== '';
    problem.textContent = missing ? `${missing}を 1 つ以上えらんでね。` : '';
  };
  materials.addEventListener('change', checkChoices);
  sections.addEventListener('change', checkChoices);
  checkChoices();

  form.append(
    field('ステージの名前', title),
    row(field('谷の幅', span), field('予算（円）', budget)),
    row(field('わたる車', vehicle), field('台数', count)),
    field('使える材料', materials),
    field('使える断面', sections),
    field('きまり', rules),
    problem,
  );
  if (options.link) form.append(shareBox(options.link));

  const buttons = document.createElement('div');
  buttons.className = 'maker-buttons';
  if (actions.remove) buttons.append(choiceButton('このステージを消す', false, actions.remove, 'tool danger'));
  buttons.append(choiceButton('やめる', false, actions.cancel, 'secondary'), saveButton);
  form.append(buttons);
  return form;
}

/** 配るためのリンクと、コピーするボタン */
function shareBox(link: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'maker-share';
  const input = document.createElement('input');
  input.readOnly = true;
  input.value = link;
  input.addEventListener('focus', () => input.select());

  const note = document.createElement('p');
  note.textContent = 'このリンクを Google Classroom などで配ると、開いた人の「みんなのステージ」に入るよ。';
  const copy = choiceButton('リンクをコピー', false, async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'コピーしました';
    } catch {
      // コピーが使えないブラウザでは、文字を選んだ状態にして、自分でコピーしてもらう
      input.focus();
    }
  });
  box.append(field('配るリンク', input), copy, note);
  return box;
}

function field(label: string, control: HTMLElement): HTMLElement {
  // チェックボックスの組は、中にそれぞれの label があるので、外側は label にしない
  const single = control instanceof HTMLInputElement || control instanceof HTMLSelectElement;
  const wrap = document.createElement(single ? 'label' : 'div');
  wrap.className = 'maker-field';
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(text, control);
  return wrap;
}

function row(...fields: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'maker-row';
  wrap.append(...fields);
  return wrap;
}

function textInput(value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = TITLE_MAX_LENGTH;
  input.value = value;
  return input;
}

function numberInput(value: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(BUDGET_RANGE.min);
  input.max = String(BUDGET_RANGE.max);
  input.step = String(BUDGET_RANGE.step);
  input.value = String(value);
  return input;
}

function select(options: string[][], value: string): HTMLSelectElement {
  const box = document.createElement('select');
  for (const [optionValue, label] of options) box.add(new Option(label, optionValue));
  box.value = value;
  return box;
}

function checkboxes(options: string[][], checked: readonly string[]): HTMLElement {
  const group = document.createElement('span');
  group.className = 'maker-checks';
  for (const [value, label] of options) {
    const item = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = value;
    box.checked = checked.includes(value);
    item.append(box, label);
    group.append(item);
  }
  return group;
}

function checkedValues(group: HTMLElement): string[] {
  return [...group.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.value);
}
