import './teacher.css';
import { MATERIALS, SECTIONS } from '../engine/materials';
import { VEHICLES } from '../engine/crossing';
import { STAGES } from '../game/stage';
import type { Stage } from '../game/stage';
import { TEACHER_NOTES } from './notes';

function stageCard(stage: Stage): HTMLElement {
  const note = TEACHER_NOTES[stage.id];
  const vehicle = VEHICLES.find((v) => v.id === stage.vehicleId);
  const conditions = [
    `谷の幅 ${stage.span} m`,
    vehicle ? `${vehicle.name}（${(vehicle.mass / 1000).toFixed(1)} t）` : '車は自由',
    `予算 ¥${stage.budget.toLocaleString('ja-JP')}`,
    `材料：${stage.materials.map((id) => MATERIALS[id].name).join('・')}`,
    `断面：${stage.sections.map((id) => SECTIONS[id].name).join('・')}`,
  ];
  if (stage.allowRigidJoints) conditions.push('剛接合が使える');
  if (!stage.allowDiagonals) conditions.push('斜めの部材は使えない');

  const card = document.createElement('article');
  card.className = 'stage-note';
  card.innerHTML = `
    <h3>${stage.title}</h3>
    <p class="goal">${stage.goal}</p>
    <p class="conditions">${conditions.join('　/　')}</p>
    <dl>
      <dt>ねらい</dt><dd>${note.aim}</dd>
      <dt>発問の例</dt><dd><ul>${note.questions.map((q) => `<li>${q}</li>`).join('')}</ul></dd>
      <dt>答えの例</dt><dd>${note.example}</dd>
      <dt>つまずき</dt><dd>${note.pitfalls}</dd>
    </dl>`;
  return card;
}

document.getElementById('stage-notes')!.replaceChildren(...STAGES.map(stageCard));
document.getElementById('print')!.addEventListener('click', () => window.print());
