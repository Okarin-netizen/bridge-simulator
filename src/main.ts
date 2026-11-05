import './style.css';
import { simulateCrossing, VEHICLES } from './engine/crossing';
import type { CrossingOutcome, Vehicle } from './engine/crossing';
import { MATERIALS, SECTIONS } from './engine/materials';
import type { MaterialId, MemberResult, SectionId } from './engine/types';
import { BridgeDesign, memberCost } from './game/design';
import { explainOutcome, modeLabel } from './game/explain';
import { nextGuess, scorePredictions } from './game/prediction';
import type { Guess } from './game/prediction';
import { countStars, Progress, rateAttempt, utilizationPercent } from './game/score';
import type { StarCheck } from './game/score';
import { SANDBOX_STAGE, STAGES } from './game/stage';
import type { Stage } from './game/stage';
import { Camera } from './ui/camera';
import { MATERIAL_COLORS } from './ui/colors';
import { drawScene, endpoints } from './ui/renderer';
import { saveReportImage } from './ui/report';
import type { Point, Scene } from './ui/renderer';

type Tool = 'connect' | 'erase' | 'joint';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'connect', label: 'つなぐ', hint: '点から点へなぞるか、2 つの点を順にタップして部材を置こう。' },
  { id: 'erase', label: 'けす', hint: 'けしたい部材か節点をタップしよう。' },
  { id: 'joint', label: '接合をかえる', hint: '節点をタップすると、ピン接合（丸）と剛接合（四角）が切りかわるよ。' },
];

const FRAME_INTERVAL_MS = 40;

let stage: Stage = STAGES[0];
let design = new BridgeDesign(stage);
const camera = new Camera();
const progress = new Progress();

const state = {
  tool: 'connect' as Tool,
  material: 'wood' as MaterialId,
  section: 'square' as SectionId,
  vehicle: VEHICLES[1] as Vehicle,
  dragFrom: null as Point | null,
  pointer: null as Point | null,
  pending: null as Point | null,
  selectedMemberId: null as string | null,
  test: null as TestPlayback | null,
  /** 試験の前に、部材の力の向きを予想しているところか */
  predicting: false,
  guesses: new Map<string, Guess>(),
  /** 振り返りシートに書く気づき */
  reflection: '',
};

interface TestPlayback {
  outcome: CrossingOutcome;
  frameIndex: number;
  finished: boolean;
  stars: StarCheck[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

// ---------------------------------------------------------------- 画面の準備

function setupControls(): void {
  const vehicleSelect = $<HTMLSelectElement>('vehicle');
  for (const vehicle of VEHICLES) {
    vehicleSelect.add(new Option(`${vehicle.name}　${(vehicle.mass / 1000).toFixed(1)} t`, vehicle.id));
  }
  vehicleSelect.value = state.vehicle.id;
  vehicleSelect.addEventListener('change', () => {
    state.vehicle = VEHICLES.find((v) => v.id === vehicleSelect.value)!;
  });

  $('open-stage-select').addEventListener('click', showStageSelect);
  $('load-sample').addEventListener('click', () => {
    leaveTest();
    design.loadSample();
    refresh();
  });
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', () => {
    leaveTest();
    design.clear();
    refresh();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !isTyping(event)) {
      event.preventDefault();
      undo();
    }
  });
  $('run-test').addEventListener('click', () => (state.test ? leaveTest() : startTest()));
  $('predict').addEventListener('click', () => setPredicting(!state.predicting));
}

function undo(): void {
  if (!design.canUndo) return;
  leaveTest();
  state.pending = null;
  design.undo();
  refresh();
}

/** 振り返りの欄に書いているときの Ctrl + Z は、文字の取り消しにまかせる */
function isTyping(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
}

function setPredicting(on: boolean): void {
  state.predicting = on;
  state.pending = null;
  $('predict').setAttribute('aria-pressed', String(on));
  $('hint').textContent = on
    ? '部材をタップして予想しよう。1 回で赤（押される）、2 回で青（引っぱられる）、3 回でもとにもどるよ。'
    : `${stage.goal}。${stage.hint}`;
  draw();
}

/** ステージを開いて、そのステージで使える材料や道具だけを並べる */
function openStage(next: Stage): void {
  stage = next;
  design = new BridgeDesign(stage);
  state.material = stage.materials[0];
  state.section = stage.sections[0];
  state.tool = 'connect';
  state.pending = null;
  state.guesses.clear();
  state.reflection = '';
  setPredicting(false);
  leaveTest();

  $('stage-chapter').textContent = stage.chapter;
  $('stage-name').textContent = stage.title;
  $('budget').textContent = yen(stage.budget);
  $('hint').textContent = `${stage.goal}。${stage.hint}`;
  $('load-sample').hidden = stage.id !== SANDBOX_STAGE.id;

  const vehicleSelect = $<HTMLSelectElement>('vehicle');
  if (stage.vehicleId) {
    state.vehicle = VEHICLES.find((v) => v.id === stage.vehicleId)!;
    vehicleSelect.value = state.vehicle.id;
  }
  vehicleSelect.disabled = stage.vehicleId !== null;

  $('stage-select').hidden = true;
  renderChoiceButtons();
  resizeCanvas();
}

function showStageSelect(): void {
  const cards = [...STAGES, SANDBOX_STAGE].map((s) => {
    const stars = s.id === SANDBOX_STAGE.id ? '' : starText(progress.starsFor(s.id));
    const button = choiceButton(
      `<span class="card-chapter">${s.chapter}</span><span class="card-title">${s.title}</span>` +
        `<span class="card-goal">${s.goal}</span><span class="card-stars">${stars}</span>`,
      false,
      () => openStage(s),
      'stage-card',
    );
    return button;
  });
  $('stage-list').replaceChildren(...cards);
  $('stage-select').hidden = false;
}

function starText(count: number): string {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

function renderChoiceButtons(): void {
  $('materials').replaceChildren(
    ...stage.materials.map((id) => MATERIALS[id]).map((material) =>
      choiceButton(
        `<span class="material-swatch" style="background:${MATERIAL_COLORS[material.id]}"></span>${material.name}` +
          `<small>強さ ${material.strength / 1e6} MPa・¥${material.pricePerMeter}/m</small>`,
        state.material === material.id,
        () => {
          state.material = material.id;
          renderChoiceButtons();
        },
        'choice',
      ),
    ),
  );

  $('sections').replaceChildren(
    ...stage.sections.map((id) => SECTIONS[id]).map((section) =>
      choiceButton(section.name, state.section === section.id, () => {
        state.section = section.id;
        renderChoiceButtons();
      }),
    ),
  );

  $('tools').replaceChildren(
    ...TOOLS.filter((tool) => tool.id !== 'joint' || stage.allowRigidJoints).map((tool) =>
      choiceButton(tool.label, state.tool === tool.id, () => {
        state.tool = tool.id;
        state.pending = null;
        $('hint').textContent = tool.hint;
        renderChoiceButtons();
        draw();
      }),
    ),
  );
}

function choiceButton(html: string, pressed: boolean, onClick: () => void, className = 'tool'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = html;
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', onClick);
  return button;
}

function resizeCanvas(): void {
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const margin = 3;
  camera.fit(
    {
      minX: stage.buildArea.minX - margin,
      maxX: stage.buildArea.maxX + margin,
      minY: stage.roadY - stage.depth,
      // 道路より上に組めないステージでも、車が見えるだけの空を残す
      maxY: Math.max(stage.buildArea.maxY, 4) + 1,
    },
    { width, height },
  );
  draw();
}

// ---------------------------------------------------------------- 編集の操作

function snapToGrid(screenX: number, screenY: number): Point {
  const world = camera.toWorld(screenX, screenY);
  const grid = stage.gridSize;
  return { x: Math.round(world.x / grid) * grid, y: Math.round(world.y / grid) * grid };
}

function pointerPosition(event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (event) => {
  const screen = pointerPosition(event);

  if (state.test) {
    state.selectedMemberId = findMemberNear(screen)?.id ?? null;
    refresh();
    return;
  }

  if (state.predicting) {
    const member = findMemberNear(screen);
    if (member) {
      const guess = nextGuess(state.guesses.get(member.id));
      if (guess) state.guesses.set(member.id, guess);
      else state.guesses.delete(member.id);
    }
    draw();
    return;
  }

  if (state.tool === 'connect') {
    canvas.setPointerCapture(event.pointerId);
    state.dragFrom = state.pending ?? snapToGrid(screen.x, screen.y);
    state.pointer = snapToGrid(screen.x, screen.y);
  } else if (state.tool === 'erase') {
    eraseAt(screen);
  } else if (state.tool === 'joint') {
    const node = findNodeNear(screen);
    if (node) design.toggleJoint(node.id);
  }
  refresh();
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.dragFrom) return;
  const screen = pointerPosition(event);
  state.pointer = snapToGrid(screen.x, screen.y);
  draw();
});

canvas.addEventListener('pointerup', (event) => {
  if (!state.dragFrom) return;
  const screen = pointerPosition(event);
  const end = snapToGrid(screen.x, screen.y);
  const start = state.dragFrom;
  state.dragFrom = null;
  state.pointer = null;

  if (samePoint(start, end)) {
    // その場でタップしたときは、次のタップでつなぐ
    state.pending = state.pending && samePoint(state.pending, end) ? null : end;
  } else {
    const problem = design.connect(start, end, state.material, state.section);
    if (problem) showToast(problem);
    state.pending = null;
  }
  refresh();
});

function eraseAt(screen: Point): void {
  const node = findNodeNear(screen);
  if (node && !design.isAnchor(node)) {
    design.removeNode(node.id);
    return;
  }
  const member = findMemberNear(screen);
  if (member) design.removeMember(member.id);
}

function findNodeNear(screen: Point) {
  return design.nodes.find((node) => {
    const p = camera.toScreen(node.x, node.y);
    return Math.hypot(p.x - screen.x, p.y - screen.y) < 16;
  });
}

function findMemberNear(screen: Point) {
  return design.members.find((member) => {
    const [a, b] = endpoints(design, member).map((p) => camera.toScreen(p.x, p.y));
    return distanceToSegment(screen, a, b) < 10;
  });
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function samePoint(p: Point, q: Point): boolean {
  return p.x === q.x && p.y === q.y;
}

// ---------------------------------------------------------------- 走行試験

function startTest(): void {
  setPredicting(false);
  state.pending = null;
  state.selectedMemberId = null;
  const outcome = simulateCrossing(design.toBridge(), state.vehicle, { roadY: stage.roadY });
  const stars = rateAttempt(outcome, design.totalCost(), stage.budget);
  state.test = { outcome, frameIndex: 0, finished: false, stars };
  $('run-test').textContent = '橋を直す';
  $('mode-badge').hidden = false;
  $<HTMLButtonElement>('predict').disabled = true;
  playNextFrame();
}

function playNextFrame(): void {
  const test = state.test;
  if (!test) return;

  if (test.frameIndex < test.outcome.frames.length - 1) {
    test.frameIndex++;
    refresh();
    setTimeout(playNextFrame, FRAME_INTERVAL_MS);
  } else {
    test.finished = true;
    if (stage.id !== SANDBOX_STAGE.id) progress.record(stage.id, countStars(test.stars));
    if (test.outcome.status === 'crossed') showHardestMoment(test);
    refresh();
  }
}

/** わたり切ったあとは、負担率がいちばん大きかった瞬間にもどして色を見せる */
function showHardestMoment(test: TestPlayback): void {
  const worstOf = (index: number) =>
    Math.max(0, ...test.outcome.frames[index].result.members.map((m) => m.utilization));
  let hardest = 0;
  test.outcome.frames.forEach((_, i) => {
    if (worstOf(i) > worstOf(hardest)) hardest = i;
  });
  test.frameIndex = hardest;
  showToast('いちばん苦しかった瞬間を表示しています');
}

function leaveTest(): void {
  state.test = null;
  state.selectedMemberId = null;
  $('run-test').textContent = '試験スタート';
  $('mode-badge').hidden = true;
  $<HTMLButtonElement>('predict').disabled = false;
  refresh();
}

function currentTestView(): Scene['test'] {
  const test = state.test;
  if (!test) return undefined;

  const frame = test.outcome.frames[test.frameIndex];
  const results = new Map<string, MemberResult>((frame?.result.members ?? []).map((m) => [m.id, m]));
  const brokenIds = new Set(test.finished ? test.outcome.broken.map((b) => b.id) : []);
  const carPosition = frame?.position ?? test.outcome.stoppedAt ?? 0;
  const unstableNodeId = test.finished ? test.outcome.unstableNodeId : undefined;
  const wrongGuessIds = new Set(test.finished && frame ? scorePredictions(state.guesses, frame.result.members).wrongIds : []);
  return { results, brokenIds, vehicle: state.vehicle, carPosition, unstableNodeId, wrongGuessIds };
}

// ---------------------------------------------------------------- 表示の更新

function refresh(): void {
  updateCost();
  updateInfoPanel();
  draw();
}

function draw(): void {
  const scene: Scene = {
    design,
    test: currentTestView(),
    selectedMemberId: state.selectedMemberId ?? undefined,
    pending: state.pending ?? undefined,
    guesses: state.guesses,
  };
  if (state.dragFrom && state.pointer && !samePoint(state.dragFrom, state.pointer)) {
    const length = Math.hypot(state.pointer.x - state.dragFrom.x, state.pointer.y - state.dragFrom.y);
    scene.preview = { from: state.dragFrom, to: state.pointer, valid: length <= stage.maxMemberLength };
  }
  drawScene(ctx, camera, scene);
}

function updateCost(): void {
  $<HTMLButtonElement>('undo').disabled = !design.canUndo;
  const cost = design.totalCost();
  $('cost').textContent = yen(cost);
  const meter = $('cost-meter');
  meter.style.width = `${Math.min(100, (cost / stage.budget) * 100)}%`;
  meter.classList.toggle('over', cost > stage.budget);
}

function updateInfoPanel(): void {
  const test = state.test;
  const frames = test?.outcome.frames.slice(0, test.frameIndex + 1) ?? [];
  const maxUtilization = Math.max(0, ...frames.flatMap((f) => f.result.members.map((m) => m.utilization)));

  $('max-util').textContent = frames.length > 0 ? String(utilizationPercent(maxUtilization)) : '--';
  $('util-meter').style.width = `${Math.min(100, maxUtilization * 100)}%`;

  updateMemberInfo();
  updateResult();
}

function updateMemberInfo(): void {
  const box = $('member-info');
  const member = design.members.find((m) => m.id === state.selectedMemberId);
  box.hidden = !member;
  if (!member) return;

  const length = design.lengthOf(member);
  const result = currentTestView()?.results.get(member.id);
  const lines = [
    `<b>${MATERIALS[member.material].name}・${SECTIONS[member.section].name} ${length.toFixed(1)} m</b>`,
    `値段 ${yen(memberCost(member, length))}`,
  ];
  if (result) {
    lines.push(
      modeLabel(result.axial),
      `軸の力 <b>${(Math.abs(result.axial) / 1000).toFixed(1)} kN</b>`,
      `負担率 <b>${utilizationPercent(result.utilization)}%</b>`,
    );
  }
  box.innerHTML = lines.join('<br>');
}

function updateResult(): void {
  const box = $('result');
  const test = state.test;
  const wasHidden = box.hidden;
  box.hidden = !test?.finished;
  if (!test?.finished) return;

  const explanation = explainOutcome(test.outcome, stage);
  const starList =
    stage.id === SANDBOX_STAGE.id
      ? ''
      : `<ul class="stars">${test.stars
          .map((star) => `<li class="${star.achieved ? 'got' : ''}">${star.achieved ? '★' : '☆'} ${star.label}</li>`)
          .join('')}</ul>`;
  box.innerHTML =
    `<h3>${explanation.title}</h3>${starList}${predictionText(test)}<p>${explanation.body}</p>` +
    `<b>次はこうしてみよう</b><ul>${explanation.hints.map((h) => `<li>${h}</li>`).join('')}</ul>`;

  box.append(reflectionForm(test, explanation.title));

  const nextStage = STAGES[STAGES.indexOf(stage) + 1];
  if (test.outcome.status === 'crossed' && nextStage) {
    const next = choiceButton('次のステージへ', false, () => openStage(nextStage), 'primary small');
    box.append(next);
  }
  if (wasHidden) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** 気づきを書いて、振り返りシートを画像で保存する欄 */
function reflectionForm(test: TestPlayback, resultTitle: string): HTMLElement {
  const form = document.createElement('div');
  form.className = 'reflection';
  form.innerHTML =
    '<label for="reflection-text">気づいたこと（振り返りシートにのります）</label>' +
    '<textarea id="reflection-text" rows="3" placeholder="例：上の部材が赤くなったので、パイプにしたら負担率が下がった"></textarea>';

  const textarea = form.querySelector('textarea')!;
  textarea.value = state.reflection;
  textarea.addEventListener('input', () => (state.reflection = textarea.value));

  const save = choiceButton('振り返りシートを保存', false, () => {
    const frame = test.outcome.frames[test.frameIndex];
    const score = frame ? scorePredictions(state.guesses, frame.result.members) : null;
    saveReportImage(canvas, {
      stageId: stage.id,
      stageTitle: stage.title,
      resultTitle,
      lines: [
        `わたる車：${state.vehicle.name}（${(state.vehicle.mass / 1000).toFixed(1)} t）`,
        `使った金額：${yen(design.totalCost())}（予算 ${yen(stage.budget)}）`,
        `いちばん苦しい部材の負担率：${utilizationPercent(test.outcome.maxUtilization)}%`,
        ...(stage.id === SANDBOX_STAGE.id ? [] : [`星：${starText(countStars(test.stars))}`]),
        ...(score && score.total > 0 ? [`力の予想：${score.total} 本中 ${score.correct} 本正解`] : []),
      ],
      reflection: state.reflection,
    });
  }, 'secondary small');
  form.append(save);
  return form;
}

function predictionText(test: TestPlayback): string {
  const frame = test.outcome.frames[test.frameIndex];
  if (state.guesses.size === 0 || !frame) return '';
  const score = scorePredictions(state.guesses, frame.result.members);
  if (score.total === 0) return '';
  const note = score.wrongIds.length > 0 ? '（はずれた部材に × がついています）' : '（ぜんぶ正解！）';
  return `<p class="prediction-score">力の予想：${score.total} 本中 ${score.correct} 本正解${note}</p>`;
}

let toastTimer = 0;
function showToast(message: string): void {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2500);
}

function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

setupControls();
openStage(STAGES[0]);
showStageSelect();
// パネルの幅が変わったときも描き直せるよう、キャンバスの大きさの変化を見張る
new ResizeObserver(resizeCanvas).observe(canvas);
refresh();

// 一度開けば、ネットが切れても使えるようにする（開発中はキャッシュがじゃまになるので公開版だけ）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 登録できなくても、ふつうに遊べるので何もしない
  });
}
