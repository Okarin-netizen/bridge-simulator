import './style.css';
import { simulateCrossing, VEHICLES } from './engine/crossing';
import type { CrossingOutcome, Vehicle } from './engine/crossing';
import { MATERIALS, SECTIONS } from './engine/materials';
import type { MaterialId, MemberResult, Point, SectionId } from './engine/types';
import { BridgeDesign, memberCost } from './game/design';
import { explainOutcome, modeLabel } from './game/explain';
import { nextGuess, scorePredictions } from './game/prediction';
import type { Guess } from './game/prediction';
import { countStars, Progress, rateAttempt, utilizationPercent } from './game/score';
import type { StarCheck } from './game/score';
import { introText, isSandbox, SANDBOX_STAGE, STAGES } from './game/stage';
import type { Stage } from './game/stage';
import { Camera } from './ui/camera';
import { MATERIAL_COLORS } from './ui/colors';
import { drawScene } from './ui/renderer';
import { CrossingPlayback } from './ui/playback';
import { saveReportImage } from './ui/report';
import { forceText, tons, yen } from './ui/format';
import { SECTION_ICONS } from './ui/sectionIcons';
import type { Scene } from './ui/renderer';

type Tool = 'connect' | 'erase' | 'joint';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'connect', label: 'つなぐ', hint: '点から点へなぞるか、2 つの点を順にタップして部材を置こう。' },
  { id: 'erase', label: 'けす', hint: 'けしたい部材か節点をタップしよう。' },
  {
    id: 'joint',
    label: '接合をかえる',
    hint: '節点をタップすると、ピン接合（丸）と剛接合（ごうせつごう：四角）が切りかわるよ。',
  },
];

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
  playback: CrossingPlayback;
  stars: StarCheck[];
}

type Drawer = 'tools' | 'info';

/** 指はマウスほど細かく狙えないので、タッチのときは当たり判定を広げる（px） */
const HIT_RADIUS = {
  mouse: { node: 16, member: 10 },
  touch: { node: 22, member: 18 },
};
type HitRadius = (typeof HIT_RADIUS)['mouse'];

/** スマホを横にしたときの画面（style.css の @media と同じ条件） */
const phoneLayout = window.matchMedia('(orientation: landscape) and (max-height: 520px)');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = document.querySelector<HTMLElement>('.app')!;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

// ---------------------------------------------------------------- 画面の準備

function setupControls(): void {
  const vehicleSelect = $<HTMLSelectElement>('vehicle');
  for (const vehicle of VEHICLES) {
    vehicleSelect.add(new Option(`${vehicle.name} ${tons(vehicle.mass)}`, vehicle.id));
  }
  vehicleSelect.value = state.vehicle.id;
  vehicleSelect.addEventListener('change', () => {
    // 試験の途中で車を変えると、走っている車と力の結果が合わなくなるので、試験をやめる
    leaveTest();
    state.vehicle = VEHICLES.find((v) => v.id === vehicleSelect.value)!;
    draw();
  });

  $('open-stage-select').addEventListener('click', showStageSelect);
  $('load-sample').addEventListener('click', () => changeDesign(() => design.loadSample()));
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', () => changeDesign(() => design.clear()));
  document.addEventListener('keydown', (event) => {
    // ステージを選んでいるあいだは、うしろの橋を変えない
    const choosingStage = !$('stage-select').hidden;
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !isTyping(event) && !choosingStage) {
      event.preventDefault();
      undo();
    }
  });
  $('run-test').addEventListener('click', () => (state.test ? leaveTest() : startTest()));
  $('predict').addEventListener('click', () => setPredicting(!state.predicting));

  $('open-tools').addEventListener('click', () => openDrawer('tools'));
  $('open-info').addEventListener('click', () => openDrawer('info'));
  for (const button of document.querySelectorAll('[data-close-drawer]')) {
    button.addEventListener('click', closeDrawer);
  }
}

/** スマホの画面で、左右のパネルを引き出す */
function openDrawer(drawer: Drawer): void {
  app.dataset.drawer = drawer;
}

function closeDrawer(): void {
  delete app.dataset.drawer;
}

function openedDrawer(): Drawer | undefined {
  return app.dataset.drawer as Drawer | undefined;
}

function undo(): void {
  if (design.canUndo) changeDesign(() => design.undo());
}

/** ボタンで橋をまとめて変える。タップしかけていた点も、前の形のものなので忘れる */
function changeDesign(change: () => void): void {
  leaveTest();
  state.pending = null;
  change();
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
    : introText(stage);
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
  $('hint').textContent = introText(stage);
  $('load-sample').hidden = !isSandbox(stage);
  $('legend-rigid').hidden = !stage.allowRigidJoints;

  const vehicleSelect = $<HTMLSelectElement>('vehicle');
  if (stage.vehicleId) {
    state.vehicle = VEHICLES.find((v) => v.id === stage.vehicleId)!;
    vehicleSelect.value = state.vehicle.id;
  }
  vehicleSelect.disabled = stage.vehicleId !== null;

  $('stage-select').hidden = true;
  closeDrawer();
  renderChoiceButtons();
  resizeCanvas();
}

function showStageSelect(): void {
  const cards = [...STAGES, SANDBOX_STAGE].map((s) => {
    const stars = isSandbox(s) ? '' : starText(progress.starsFor(s.id));
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
  // 強さは MPa だとなじみがないので、断面の曲がりにくさと同じく、木材を 1 としたときの何倍かで見せる
  const strengthOf = (id: MaterialId) => Math.round(MATERIALS[id].strength / MATERIALS.wood.strength);
  $('materials').replaceChildren(
    ...stage.materials.map((id) => MATERIALS[id]).map((material) =>
      choiceButton(
        `<span class="material-swatch" style="background:${MATERIAL_COLORS[material.id]}"></span>${material.name}` +
          `<small>強さ ×${strengthOf(material.id)}<br>1 m ${yen(material.pricePerMeter)}</small>`,
        state.material === material.id,
        () => {
          state.material = material.id;
          renderChoiceButtons();
        },
        'choice',
      ),
    ),
  );

  // 曲がりにくさは、角材を 1 としたときの何倍かで見せる
  const stiffnessOf = (id: SectionId) => Math.round(SECTIONS[id].I / SECTIONS.square.I);
  $('sections').replaceChildren(
    ...stage.sections.map((id) => SECTIONS[id]).map((section) =>
      choiceButton(
        `<span class="section-icon">${SECTION_ICONS[section.id]}</span>${section.name}` +
          `<small>曲がりにくさ ×${stiffnessOf(section.id)}・値段 ×${section.priceFactor}</small>`,
        state.section === section.id,
        () => {
          state.section = section.id;
          renderChoiceButtons();
        },
        'choice',
      ),
    ),
  );

  const toolLabel = TOOLS.find((tool) => tool.id === state.tool)!.label;
  $('tools-summary').textContent = `${MATERIALS[state.material].name}・${SECTIONS[state.section].name}・${toolLabel}`;

  $('tools').replaceChildren(
    ...TOOLS.filter((tool) => tool.id !== 'joint' || stage.allowRigidJoints).map((tool) =>
      choiceButton(tool.label, state.tool === tool.id, () => {
        // 試験の結果を見ているときに道具を選んだら、橋を直しにもどる
        leaveTest();
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
  // 2 本目の指は無視する（部材を置いている途中に、別の指がふれても線がとばないように）
  if (!event.isPrimary) return;
  const screen = pointerPosition(event);
  const hit = event.pointerType === 'touch' ? HIT_RADIUS.touch : HIT_RADIUS.mouse;

  // 材料と道具の引き出しは、橋の画面にさわったら閉じる（そのタップで部材は置かない）
  if (openedDrawer() === 'tools') {
    closeDrawer();
    return;
  }

  if (state.test) {
    state.selectedMemberId = findMemberNear(screen, hit)?.id ?? null;
    refresh();
    if (state.selectedMemberId) {
      if (phoneLayout.matches) openDrawer('info');
      // 結果を読むためにパネルを下まで送っていても、選んだ部材の情報が見えるようにする
      $('member-info').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return;
  }

  if (state.predicting) {
    const member = findMemberNear(screen, hit);
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
    eraseAt(screen, hit);
  } else if (state.tool === 'joint') {
    const node = findNodeNear(screen, hit);
    if (node) design.toggleJoint(node.id);
  }
  refresh();
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.dragFrom || !event.isPrimary) return;
  const screen = pointerPosition(event);
  state.pointer = snapToGrid(screen.x, screen.y);
  draw();
});

canvas.addEventListener('pointerup', (event) => {
  if (!state.dragFrom || !event.isPrimary) return;
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

// 画面のスクロールや通知などで指の動きが取り消されたら、置きかけの部材もやめる
canvas.addEventListener('pointercancel', () => {
  state.dragFrom = null;
  state.pointer = null;
  draw();
});

function eraseAt(screen: Point, hit: HitRadius): void {
  const node = findNodeNear(screen, hit);
  if (node && !design.isAnchor(node)) {
    design.removeNode(node.id);
    return;
  }
  const member = findMemberNear(screen, hit);
  if (member) design.removeMember(member.id);
}

function findNodeNear(screen: Point, hit: HitRadius) {
  return nearest(design.nodes, hit.node, (node) => {
    const p = camera.toScreen(node.x, node.y);
    return Math.hypot(p.x - screen.x, p.y - screen.y);
  });
}

function findMemberNear(screen: Point, hit: HitRadius) {
  return nearest(design.members, hit.member, (member) => {
    const [a, b] = design.endsOf(member).map((p) => camera.toScreen(p.x, p.y));
    return distanceToSegment(screen, a, b);
  });
}

/** 当たり判定を広げると候補が重なるので、いちばん近いものを選ぶ */
function nearest<T>(items: readonly T[], radius: number, distanceOf: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestDistance = radius;
  for (const item of items) {
    const distance = distanceOf(item);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
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
  closeDrawer();
  setPredicting(false);
  state.pending = null;
  state.selectedMemberId = null;
  const outcome = simulateCrossing(design.toBridge(), state.vehicle, { roadY: stage.roadY });
  const stars = rateAttempt(outcome, design.totalCost(), stage.budget);
  const test: TestPlayback = { outcome, playback: new CrossingPlayback(outcome), stars };
  state.test = test;
  $('run-test').textContent = '橋を直す';
  $('hint').textContent = '車が橋をわたっているよ。部材の色と矢印の変わり方を見てみよう。';
  $('mode-badge').textContent = '試験中';
  $('mode-badge').hidden = false;
  $<HTMLButtonElement>('predict').disabled = true;
  requestAnimationFrame((now) => playAnimation(test, now));
}

/** 車が走り、こわれたときは落ちていくアニメーションを、画面の書きかえごとに進める */
function playAnimation(test: TestPlayback, previousTime: number): void {
  requestAnimationFrame((now) => {
    // 「橋を直す」で試験をやめたら、アニメーションも止める
    if (state.test !== test) return;

    // タブを切りかえたあとなどに、一気に進みすぎないようにする
    const seconds = Math.min(0.1, (now - previousTime) / 1000);
    test.playback.advance(seconds);

    if (test.playback.finished) {
      finishTest(test);
    } else {
      refresh();
      playAnimation(test, now);
    }
  });
}

function finishTest(test: TestPlayback): void {
  if (!isSandbox(stage)) progress.record(stage.id, countStars(test.stars));
  // わたり切ったあとは、負担率がいちばん大きかった瞬間にもどして色を見せる
  if (test.outcome.status === 'crossed') {
    test.playback.showHardestMoment();
    showToast('いちばん苦しかった瞬間を表示しています');
  }
  $('mode-badge').textContent = '試験の結果';
  $('hint').textContent = '部材をタップすると、押されているか引っぱられているかと、力の大きさがわかるよ。';
  refresh();
}

function leaveTest(): void {
  if (state.test) $('hint').textContent = introText(stage);
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

  const { playback } = test;
  const members = playback.currentMembers;
  const results = new Map<string, MemberResult>(members.map((m) => [m.id, m]));
  // 部材は、こわれる順番がきたものから赤くする
  const breaks = playback.breakStates;
  const brokenIds = new Set(breaks.map((state) => state.id));
  const unstableNodeId = playback.finished ? test.outcome.unstableNodeId : undefined;
  const wrongGuessIds = new Set(playback.finished ? scorePredictions(state.guesses, members).wrongIds : []);
  return {
    results,
    brokenIds,
    vehicle: state.vehicle,
    carPosition: playback.carX,
    unstableNodeId,
    wrongGuessIds,
    displacements: playback.drawnDisplacements(),
    deflectionScale: playback.deflectionScale,
    fallDistance: playback.fallDistance,
    memberFallDistance: playback.memberFallDistance,
    wholeBridgeFalls: playback.wholeBridgeFalls,
    carFalls: playback.carFalls,
    breaks,
    reactions: playback.currentReactions,
    showLoads: playback.showsLoads,
    carFaded: playback.finished && test.outcome.status === 'crossed',
  };
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
    showSectionMarks: stage.sections.length > 1,
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
  const playback = state.test?.playback;
  const onBridge = playback !== undefined && playback.frameIndex >= 0;
  const maxUtilization = onBridge ? playback.maxUtilizationSoFar : 0;

  $('max-util').textContent = onBridge ? String(utilizationPercent(maxUtilization)) : '--';
  $('util-meter').style.width = `${Math.min(100, maxUtilization * 100)}%`;

  const resultReady = state.test?.playback.finished ?? false;
  const infoToggle = $('open-info');
  infoToggle.innerHTML = resultReady ? '結果を見る' : `負担率<b>${$('max-util').textContent}%</b>`;
  infoToggle.classList.toggle('ready', resultReady);

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
      `かかる力 <b>${forceText(result.axial)}</b>`,
      `負担率 <b>${utilizationPercent(result.utilization)}%</b>`,
    );
  }
  box.innerHTML = lines.join('<br>');
}

function updateResult(): void {
  const box = $('result');
  const test = state.test;
  const wasHidden = box.hidden;
  box.hidden = !test?.playback.finished;
  if (!test?.playback.finished) return;

  const explanation = explainOutcome(test.outcome, stage);
  const starList =
    isSandbox(stage)
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
  if (wasHidden) {
    if (phoneLayout.matches) openDrawer('info');
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
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
    const score = scorePredictions(state.guesses, test.playback.currentMembers);
    saveReportImage(canvas, {
      stageId: stage.id,
      stageTitle: stage.title,
      resultTitle,
      lines: [
        `わたる車：${state.vehicle.name}（${tons(state.vehicle.mass)}）`,
        `使った金額：${yen(design.totalCost())}（予算 ${yen(stage.budget)}）`,
        `いちばん苦しい部材の負担率：${utilizationPercent(test.outcome.maxUtilization)}%`,
        ...(isSandbox(stage) ? [] : [`星：${starText(countStars(test.stars))}`]),
        ...(score.total > 0 ? [`力の予想：${score.total} 本中 ${score.correct} 本正解`] : []),
      ],
      reflection: state.reflection,
    });
  }, 'secondary small');
  form.append(save);
  return form;
}

function predictionText(test: TestPlayback): string {
  if (state.guesses.size === 0) return '';
  const score = scorePredictions(state.guesses, test.playback.currentMembers);
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
