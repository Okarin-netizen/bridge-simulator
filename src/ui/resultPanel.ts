import { MATERIALS, SECTIONS } from '../engine/materials';
import type { BridgeMember, MemberResult } from '../engine/types';
import type { BridgeDesign } from '../game/design';
import { memberCost } from '../game/design';
import type { Explanation } from '../game/explain';
import { modeLabel } from '../game/explain';
import type { PredictionScore } from '../game/prediction';
import type { StarCheck } from '../game/score';
import { utilizationPercent } from '../game/score';
import { choiceButton } from './dom';
import { forceText, yen } from './format';

/*
 * 右のパネルに出す、選んだ部材の情報と試験の結果と、振り返りを書く欄。
 * ここでは HTML を組み立てるだけで、いつ出すかは main.ts が決める。
 */

export function starText(count: number): string {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

/** タップした部材の材料・長さ・値段と、試験中ならかかっている力 */
export function memberInfoHtml(design: BridgeDesign, member: BridgeMember, result?: MemberResult): string {
  const length = design.lengthOf(member);
  const lines = [
    `<b>${MATERIALS[member.material].name}・${SECTIONS[member.section].name} ${length.toFixed(1)} m</b>`,
    `値段 ${yen(memberCost(member, length))}`,
  ];
  if (result) {
    lines.push(
      modeLabel(result.axial),
      `かかる力 <b>${forceText(result.axial)}</b>`,
      `負担率 <b>${utilizationPercent(result.utilization)}%</b>`,
    );
  }
  return lines.join('<br>');
}

/** 結果のいちばん上に出す、大きな星と見出し。実験モードでは stars を null にして星を出さない */
export function resultHeadHtml(explanation: Explanation, stars: StarCheck[] | null): string {
  const bigStars = stars
    ? `<div class="result-stars" aria-label="星 ${stars.filter((star) => star.achieved).length} つ">${stars
        .map((star) => `<span class="${star.achieved ? 'got' : ''}">${star.achieved ? '★' : '☆'}</span>`)
        .join('')}</div>`
    : '';
  return `${bigStars}<h3>${explanation.title}</h3>`;
}

/**
 * ★3 を取れたときに、名人ラインと比べた一言を出す。
 * ★3 のあとも「もっと安く」と遊び続けられるように、次の目標を目の前に見せる
 */
export function masterHtml(cost: number, masterCost: number, newRecord: boolean): string {
  const record = newRecord ? '<span class="new-record">新記録！</span>' : '';
  if (cost <= masterCost) {
    return `<p class="master cleared">${record}<b>名人ライン クリア！</b> ${yen(cost)}（名人ライン ${yen(masterCost)}）</p>`;
  }
  return `<p class="master">${record}名人ライン ${yen(masterCost)} まで、あと <b>${yen(cost - masterCost)}</b>。もっと安くできるかな？</p>`;
}

/** わたり切ったときに、ちがう作り方の橋の値段とくらべる */
export function comparisonHtml(cost: number, comparison: { label: string; cost: number }): string {
  const ratio = cost / comparison.cost;
  const times = ratio >= 1.5 ? `（約 ${ratio.toFixed(1)} 倍）` : '';
  return (
    `<div class="compare"><b>くらべてみよう</b><p>${comparison.label}なら、同じ谷を ${yen(comparison.cost)} でわたれる。` +
    `この橋は ${yen(cost)}${times}。</p></div>`
  );
}

/** わたり切ったときに出す、そのステージで「わかったこと」 */
export function lessonHtml(lesson: string): string {
  return `<div class="lesson"><b>わかったこと</b><p>${lesson}</p></div>`;
}

/** 星の内わけ・予想の当たり・説明・次のヒント */
export function resultDetailHtml(
  explanation: Explanation,
  stars: StarCheck[] | null,
  prediction: PredictionScore,
  perfectPrediction: boolean,
): string {
  const starList = stars
    ? `<ul class="stars">${stars
        .map((star) => `<li class="${star.achieved ? 'got' : ''}">${star.achieved ? '★' : '☆'} ${star.label}</li>`)
        .join('')}</ul>`
    : '';
  return (
    `${starList}${predictionHtml(prediction, perfectPrediction)}<p>${explanation.body}</p>` +
    `<b>次はこうしてみよう</b><ul>${explanation.hints.map((h) => `<li>${h}</li>`).join('')}</ul>`
  );
}

function predictionHtml(score: PredictionScore, perfect: boolean): string {
  if (score.total === 0) return '';
  let note = '（ぜんぶ正解！ 全部の部材を予想すると「予想ぴたり」の印がもらえるよ）';
  if (score.wrongIds.length > 0) note = '（はずれた部材に × がついています）';
  else if (perfect) note = '（全部の部材を当てた！ ステージ一覧に「予想ぴたり」の印がつきます）';
  return `<p class="prediction-score">力の予想：${score.total} 本中 ${score.correct} 本正解${note}</p>`;
}

/** 気づきを書いて、振り返りシートを画像で保存する欄 */
export function reflectionForm(text: string, onInput: (text: string) => void, onSave: () => void): HTMLElement {
  const form = document.createElement('div');
  form.className = 'reflection';
  form.innerHTML =
    '<label for="reflection-text">気づいたこと（振り返りシートにのります）</label>' +
    '<textarea id="reflection-text" rows="6" placeholder="例：上の部材が赤くなったので、パイプにしたら負担率が下がった"></textarea>';

  const textarea = form.querySelector('textarea')!;
  textarea.value = text;
  textarea.addEventListener('input', () => onInput(textarea.value));

  form.append(choiceButton('振り返りシートを保存', false, onSave, 'secondary'));
  return form;
}
