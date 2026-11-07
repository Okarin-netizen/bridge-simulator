import './style.css';
import { simulateCrossing, VEHICLES } from './engine/crossing';
import type { CrossingOutcome, Vehicle } from './engine/crossing';
import { MATERIALS, SECTIONS } from './engine/materials';
import type { MaterialId, MemberResult, Point, SectionId } from './engine/types';
import { BridgeDesign } from './game/design';
import { explainOutcome } from './game/explain';
import { nextGuess, scorePredictions } from './game/prediction';
import type { Guess } from './game/prediction';
import { countStars, Progress, rateAttempt, utilizationPercent } from './game/score';
import type { StarCheck } from './game/score';
import { introText, isSandbox, SANDBOX_STAGE, STAGES } from './game/stage';
import type { Stage } from './game/stage';
import { Camera } from './ui/camera';
import { materialButtons, sectionButtons, stageCard } from './ui/choices';
import { $, choiceButton, showToast } from './ui/dom';
import { tons, yen } from './ui/format';
import { findMemberNear, findNodeNear, hitRadiusFor, samePoint } from './ui/hitTest';
import type { HitRadius } from './ui/hitTest';
import { drawLoupe } from './ui/loupe';
import { CrossingPlayback } from './ui/playback';
import { drawScene } from './ui/renderer';
import type { Scene } from './ui/renderer';
import { saveReportImage } from './ui/report';
import { memberInfoHtml, reflectionForm, resultHtml, starText } from './ui/resultPanel';

type Tool = 'connect' | 'change' | 'erase' | 'joint';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'connect', label: 'つなぐ', hint: '点から点へなぞるか、2 つの点を順にタップして部材を置こう。' },
  { id: 'change', label: '材料をかえる', hint: '部材をタップすると、いま選んでいる材料と断面にかわるよ。' },
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
  /** 指でなぞっているときの指先の位置（画面の px）。ルーペを出すのに使う */
  finger: null as Point | null,
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

/** スマホを横にしたときの画面（style.css の @media と同じ条件） */
const phoneLayout = window.matchMedia('(orientation: landscape) and (max-height: 520px)');

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
  const cards = [...STAGES, SANDBOX_STAGE].map((s) =>
    stageCard(s, isSandbox(s) ? '' : starText(progress.starsFor(s.id)), () => openStage(s)),
  );
  $('stage-list').replaceChildren(...cards);
  $('stage-select').hidden = false;
}

function renderChoiceButtons(): void {
  $('materials').replaceChildren(
    ...materialButtons(stage.materials, state.material, (id) => {
      state.material = id;
      renderChoiceButtons();
    }),
  );
  $('sections').replaceChildren(
    ...sectionButtons(stage.sections, state.section, (id) => {
      state.section = id;
      renderChoiceButtons();
    }),
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
  const hit = hitRadiusFor(event);

  // 材料と道具の引き出しは、橋の画面にさわったら閉じる（そのタップで部材は置かない）
  if (openedDrawer() === 'tools') {
    closeDrawer();
    return;
  }

  if (state.test) {
    state.selectedMemberId = findMemberNear(design, camera, screen, hit)?.id ?? null;
    refresh();
    if (state.selectedMemberId) {
      if (phoneLayout.matches) openDrawer('info');
      // 結果を読むためにパネルを下まで送っていても、選んだ部材の情報が見えるようにする
      $('member-info').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return;
  }

  if (state.predicting) {
    const member = findMemberNear(design, camera, screen, hit);
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
    state.finger = event.pointerType === 'touch' ? screen : null;
  } else if (state.tool === 'change') {
    changeMaterialAt(screen, hit);
  } else if (state.tool === 'erase') {
    eraseAt(screen, hit);
  } else if (state.tool === 'joint') {
    const node = findNodeNear(design, camera, screen, hit);
    if (node) design.toggleJoint(node.id);
  }
  refresh();
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.dragFrom || !event.isPrimary) return;
  const screen = pointerPosition(event);
  state.pointer = snapToGrid(screen.x, screen.y);
  if (state.finger) state.finger = screen;
  draw();
});

canvas.addEventListener('pointerup', (event) => {
  if (!state.dragFrom || !event.isPrimary) return;
  const screen = pointerPosition(event);
  const end = snapToGrid(screen.x, screen.y);
  const start = state.dragFrom;
  state.dragFrom = null;
  state.pointer = null;
  state.finger = null;

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
  state.finger = null;
  draw();
});

function changeMaterialAt(screen: Point, hit: HitRadius): void {
  const member = findMemberNear(design, camera, screen, hit);
  if (!member) return;
  const problem = design.changeMaterial(member.id, state.material, state.section);
  if (problem) showToast(problem);
}

function eraseAt(screen: Point, hit: HitRadius): void {
  const node = findNodeNear(design, camera, screen, hit);
  if (node && !design.isAnchor(node)) {
    design.removeNode(node.id);
    return;
  }
  const member = findMemberNear(design, camera, screen, hit);
  if (member) design.removeMember(member.id);
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

  if (state.finger && state.pointer) {
    drawLoupe(ctx, camera.toScreen(state.pointer.x, state.pointer.y), state.finger);
  }
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
  box.innerHTML = memberInfoHtml(design, member, currentTestView()?.results.get(member.id));
}

function updateResult(): void {
  const box = $('result');
  const test = state.test;
  const wasHidden = box.hidden;
  box.hidden = !test?.playback.finished;
  if (!test?.playback.finished) return;

  const explanation = explainOutcome(test.outcome, stage);
  const prediction = scorePredictions(state.guesses, test.playback.currentMembers);
  box.innerHTML = resultHtml(explanation, isSandbox(stage) ? null : test.stars, prediction);
  box.append(
    reflectionForm(
      state.reflection,
      (text) => (state.reflection = text),
      () => saveReport(test, explanation.title),
    ),
  );

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

/** 振り返りシートを画像で保存する */
function saveReport(test: TestPlayback, resultTitle: string): void {
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
