import './style.css';
import { simulateCrossing, VEHICLES } from './engine/crossing';
import type { CrossingOutcome, Vehicle } from './engine/crossing';
import { MATERIALS, SECTIONS } from './engine/materials';
import type { MaterialId, MemberResult, Point, SectionId } from './engine/types';
import { BridgeDesign } from './game/design';
import { explainOutcome } from './game/explain';
import { nextGuess, scorePredictions } from './game/prediction';
import type { Guess } from './game/prediction';
import { countStars, Progress, rateAttempt, STAR_GOALS, utilizationPercent } from './game/score';
import type { StarCheck } from './game/score';
import { introText, isSandbox, SANDBOX_STAGE, STAGES } from './game/stage';
import type { Stage } from './game/stage';
import { Camera } from './ui/camera';
import { materialButtons, sectionButtons, stageGroups } from './ui/choices';
import { $, choiceButton, showToast } from './ui/dom';
import { tons, yen } from './ui/format';
import { findMemberNear, findNodeNear, hitRadiusFor, samePoint } from './ui/hitTest';
import type { HitRadius } from './ui/hitTest';
import { drawLoupe } from './ui/loupe';
import type { LoupeLabel } from './ui/loupe';
import { CrossingPlayback } from './ui/playback';
import { drawScene } from './ui/renderer';
import type { Scene } from './ui/renderer';
import { saveReportImage } from './ui/report';
import { memberInfoHtml, reflectionForm, resultDetailHtml, resultHeadHtml, starText } from './ui/resultPanel';
import { memberCard, nodeCard } from './ui/selectCard';

/** これより動かさずにはなしたら「タップ」とみなす（画面の px）。指はぶれるので広めにする */
const TAP_SLOP = { mouse: 6, touch: 12 };

interface Press {
  /** 押し始めた所（画面の px） */
  screen: Point;
  hit: HitRadius;
  touch: boolean;
}

let stage: Stage = STAGES[0];
let design = new BridgeDesign(stage);
const camera = new Camera();
const progress = new Progress();

const state = {
  material: 'wood' as MaterialId,
  section: 'square' as SectionId,
  vehicle: VEHICLES[1] as Vehicle,
  /** 画面を押しているあいだの、押し始めた所。はなしたときに「タップ＝選ぶ」か「なぞる＝置く」かを決める */
  press: null as Press | null,
  dragFrom: null as Point | null,
  pointer: null as Point | null,
  /** 指でなぞっているときの指先の位置（画面の px）。ルーペを出すのに使う */
  finger: null as Point | null,
  /** タップで選んだ部材。試験の結果では、力を見る部材にもなる */
  selectedMemberId: null as string | null,
  /** タップで選んだ節点 */
  selectedNodeId: null as string | null,
  test: null as TestPlayback | null,
  /** 試験の前に、部材の力の向きを予想しているところか */
  predicting: false,
  guesses: new Map<string, Guess>(),
  /** 振り返りシートに書く気づき */
  reflection: '',
  /** 振り返りを書く画面を開いているか */
  reflecting: false,
};

/** いまの場面。上のバーの 1〜4 と、右のパネルを出すかどうかがこれで決まる */
type Phase = 'build' | 'predict' | 'test' | 'reflect';

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
    // ステージを選んだり振り返りを書いたりしているあいだは、うしろの橋を変えない
    const choosingStage = !$('stage-select').hidden || state.reflecting;
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !isTyping(event) && !choosingStage) {
      event.preventDefault();
      undo();
    }
    // 選んだ部材や節点は、キーボードでもけしたり、選ぶのをやめたりできる
    if (state.test || isTyping(event) || choosingStage || !hasSelection()) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      closeSelectCard();
    }
  });
  $('run-test').addEventListener('click', () => (state.test ? leaveTest() : startTest()));
  $('replay').addEventListener('click', replayTest);
  $('close-reflect').addEventListener('click', closeReflection);
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

/** ボタンで橋をまとめて変える。選んでいた部材や節点も、前の形のものなので選びなおし */
function changeDesign(change: () => void): void {
  leaveTest();
  clearSelection();
  change();
  refresh();
}

/** 振り返りの欄に書いているときの Ctrl + Z は、文字の取り消しにまかせる */
function isTyping(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
}

function setPredicting(on: boolean): void {
  state.predicting = on;
  clearSelection();
  $('predict').setAttribute('aria-pressed', String(on));
  $('hint').textContent = on
    ? '部材をタップして予想しよう。1 回で赤（押される）、2 回で青（引っぱられる）、3 回でもとにもどるよ。'
    : startHint();
  showPhase();
  draw();
}

/**
 * ステージを始めたときに下に出す文。目標は橋の上の帯にいつも出ているので、ヒントだけにする。
 * スマホでは帯を出す場所がないので、目標もここに書く。
 */
function startHint(): string {
  return phoneLayout.matches ? introText(stage) : stage.hint;
}

/** ステージを開いて、そのステージで使える材料や道具だけを並べる */
function openStage(next: Stage): void {
  stage = next;
  design = new BridgeDesign(stage);
  state.material = stage.materials[0];
  state.section = stage.sections[0];
  clearSelection();
  state.guesses.clear();
  state.reflection = '';
  setPredicting(false);
  leaveTest();

  $('stage-chapter').textContent = stage.chapter;
  $('stage-name').textContent = stage.title;
  $('budget').textContent = yen(stage.budget);
  $('hint').textContent = startHint();
  $('goal-text').textContent = stage.goal;
  $('load-sample').hidden = !isSandbox(stage);
  $('legend-rigid').hidden = !stage.allowRigidJoints;
  $('joint-help').hidden = !stage.allowRigidJoints;

  // 車が決まっているステージでは、選べる箱ではなく、ただの文字で見せる
  const vehicleSelect = $<HTMLSelectElement>('vehicle');
  const vehicleIsFixed = stage.vehicleId !== null;
  if (vehicleIsFixed) {
    state.vehicle = VEHICLES.find((v) => v.id === stage.vehicleId)!;
    vehicleSelect.value = state.vehicle.id;
    $('vehicle-fixed').textContent = `${state.vehicle.name} ${tons(state.vehicle.mass)}`;
  }
  vehicleSelect.hidden = vehicleIsFixed;
  $('vehicle-fixed').hidden = !vehicleIsFixed;

  $('stage-select').hidden = true;
  closeDrawer();
  renderChoiceButtons();
  resizeCanvas();
}

function showStageSelect(): void {
  // まだ星を取っていない最初のステージに「つぎはここ」の印を付ける
  const nextStage = STAGES.find((s) => progress.starsFor(s.id) === 0);
  const groups = stageGroups(
    [...STAGES, SANDBOX_STAGE],
    (s) => (isSandbox(s) ? '' : starText(progress.starsFor(s.id))),
    nextStage?.id,
    openStage,
  );
  $('stage-list').replaceChildren(...groups);
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
  $('tools-summary').textContent = `${MATERIALS[state.material].name}・${SECTIONS[state.section].name}`;
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

  // 材料の引き出しは、橋の画面にさわったら閉じる（そのタップでは何もしない）
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

  // 「タップ＝選ぶ」「なぞる＝置く」。どちらになるかは、指をはなしたときに決める
  canvas.setPointerCapture(event.pointerId);
  const touch = event.pointerType === 'touch';
  state.press = { screen, hit, touch };
  state.dragFrom = snapPoint(screen, state.press);
  state.pointer = state.dragFrom;
  state.finger = touch ? screen : null;
  draw();
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.press || !event.isPrimary) return;
  const screen = pointerPosition(event);
  state.pointer = snapPoint(screen, state.press);
  if (state.finger) state.finger = screen;
  draw();
});

canvas.addEventListener('pointerup', (event) => {
  if (!state.press || !state.dragFrom || !event.isPrimary) return;
  const screen = pointerPosition(event);
  const press = state.press;
  const start = state.dragFrom;
  const end = snapPoint(screen, press);
  endPress();

  if (isTap(press, screen, start, end)) {
    selectAt(press.screen, press.hit);
  } else {
    placeMember(start, end);
  }
  refresh();
});

// 画面のスクロールや通知などで指の動きが取り消されたら、置きかけの部材もやめる
canvas.addEventListener('pointercancel', () => {
  endPress();
  draw();
});

function endPress(): void {
  state.press = null;
  state.dragFrom = null;
  state.pointer = null;
  state.finger = null;
}

/**
 * 部材のはしを付ける点。指のときは、近くに今ある節点があればそこに吸いつける。
 * 指は点よりずっと太いので、方眼の点だけだと、となりの点につないでしまいやすい。
 */
function snapPoint(screen: Point, press: Press): Point {
  const node = press.touch ? findNodeNear(design, camera, screen, press.hit) : undefined;
  return node ? { x: node.x, y: node.y } : snapToGrid(screen.x, screen.y);
}

/** ほとんど動かさずにはなしたか（点がずれていない、または指のぶれ程度しか動いていない） */
function isTap(press: Press, screen: Point, start: Point, end: Point): boolean {
  if (samePoint(start, end)) return true;
  const moved = Math.hypot(screen.x - press.screen.x, screen.y - press.screen.y);
  return moved < (press.touch ? TAP_SLOP.touch : TAP_SLOP.mouse);
}

function placeMember(start: Point, end: Point): void {
  const problem = design.connect(start, end, state.material, state.section);
  if (problem) {
    showToast(problem);
    return;
  }
  // 部材が節点で区切られて番号が変わることがあるので、選んでいたものは選びなおし
  clearSelection();
  $('hint').textContent = stage.allowRigidJoints
    ? '部材を置いたよ。節点（丸）をタップすると剛接合にかえられるよ。部材をタップすると、材料をかえたり、けしたりできるよ。'
    : '部材を置いたよ。置いた部材や節点をタップすると、材料をかえたり、けしたりできるよ。';
}

// ---------------------------------------------------------------- 置いた部材や節点を選んで直す

/** 組み立て中のタップ：節点か部材の上なら選ぶ（同じものなら選ぶのをやめる）、何もない所なら選ぶのをやめる */
function selectAt(screen: Point, hit: HitRadius): void {
  const node = findNodeNear(design, camera, screen, hit);
  // 支点はけせないので、接合をかえられるステージだけで選べるようにする
  if (node && (!design.isAnchor(node) || stage.allowRigidJoints)) {
    if (node.id === state.selectedNodeId) {
      clearSelection();
      return;
    }
    clearSelection();
    state.selectedNodeId = node.id;
    $('hint').textContent = stage.allowRigidJoints
      ? '「ピン接合」か「剛接合」をえらぼう。新しく置くときは、点から点へなぞってね。'
      : '「けす」を押すと、この節点とつながる部材がきえるよ。';
    return;
  }

  const member = findMemberNear(design, camera, screen, hit);
  if (!member || member.id === state.selectedMemberId) {
    clearSelection();
    return;
  }
  clearSelection();
  state.selectedMemberId = member.id;
  $('hint').textContent = '材料や断面をえらぶか、「けす」を押そう。新しく置くときは、点から点へなぞってね。';
}

function hasSelection(): boolean {
  return state.selectedMemberId !== null || state.selectedNodeId !== null;
}

function clearSelection(): void {
  state.selectedMemberId = null;
  state.selectedNodeId = null;
}

function closeSelectCard(): void {
  clearSelection();
  refresh();
}

function changeSelectedMember(material: MaterialId, section: SectionId): void {
  if (!state.selectedMemberId) return;
  // 同じ材料と断面のボタンを押したときは、何も変えない
  if (design.changeMaterial(state.selectedMemberId, material, section) === null) refresh();
}

function deleteSelected(): void {
  if (state.selectedNodeId) {
    design.removeNode(state.selectedNodeId);
    $('hint').textContent = '節点をけしたよ。';
  } else if (state.selectedMemberId) {
    design.removeMember(state.selectedMemberId);
    $('hint').textContent = '部材をけしたよ。';
  }
  clearSelection();
  refresh();
}

// ---------------------------------------------------------------- 走行試験

function startTest(): void {
  closeDrawer();
  setPredicting(false);
  const outcome = simulateCrossing(design.toBridge(), state.vehicle, { roadY: stage.roadY });
  const stars = rateAttempt(outcome, design.totalCost(), stage.budget);
  playTest({ outcome, playback: new CrossingPlayback(outcome), stars });
}

/** 同じ橋のまま、車がわたる様子をはじめから見直す */
function replayTest(): void {
  if (!state.test) return;
  state.selectedMemberId = null;
  playTest({ ...state.test, playback: new CrossingPlayback(state.test.outcome) });
}

function playTest(test: TestPlayback): void {
  state.test = test;
  $('run-test').textContent = '橋を直す';
  $('hint').textContent = '車が橋をわたっているよ。部材の色と矢印の変わり方を見てみよう。';
  // 試験のあいだは予想できないので、同じ場所に「もう一度見る」を出す（わたり終わるまでは押せない）
  $('predict').hidden = true;
  $('replay').hidden = false;
  $<HTMLButtonElement>('replay').disabled = true;
  refresh();
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
  $<HTMLButtonElement>('replay').disabled = false;
  $('hint').textContent = '部材をタップすると、押されているか引っぱられているかと、力の大きさがわかるよ。';
  refresh();
}

function leaveTest(): void {
  if (state.test) $('hint').textContent = startHint();
  state.test = null;
  state.selectedMemberId = null;
  closeReflection();
  $('run-test').textContent = '試験スタート';
  $('predict').hidden = false;
  $('replay').hidden = true;
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
  showPhase();
  updateGoalStars();
  updateCost();
  updateInfoPanel();
  updateSelectCard();
  draw();
}

function draw(): void {
  const scene: Scene = {
    design,
    test: currentTestView(),
    selectedMemberId: state.selectedMemberId ?? undefined,
    selectedNodeId: state.selectedNodeId ?? undefined,
    showSectionMarks: stage.sections.length > 1,
    guesses: state.guesses,
  };
  if (state.dragFrom && state.pointer && !samePoint(state.dragFrom, state.pointer)) {
    scene.preview = { from: state.dragFrom, to: state.pointer, valid: isShortEnough(state.dragFrom, state.pointer) };
  }
  drawScene(ctx, camera, scene);

  if (state.finger && state.dragFrom && state.pointer) {
    const target = camera.toScreen(state.pointer.x, state.pointer.y);
    drawLoupe(ctx, target, state.finger, loupeLabel(state.dragFrom, state.pointer));
  }
}

function isShortEnough(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= stage.maxMemberLength + 1e-6;
}

/** なぞっているあいだ、ルーペの下に部材の長さを出す */
function loupeLabel(from: Point, to: Point): LoupeLabel {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return { text: '始まりの点', ok: true };
  if (!isShortEnough(from, to)) return { text: `長すぎ（${stage.maxMemberLength} m まで）`, ok: false };
  return { text: `長さ ${length.toFixed(1)} m`, ok: true };
}

/** 選んだ部材や節点の札を出す。札が選んだものにかぶらないよう、上半分にあれば札を下に出す */
function updateSelectCard(): void {
  const card = $('select-card');
  const member = state.test ? undefined : design.members.find((m) => m.id === state.selectedMemberId);
  const node = state.test ? undefined : design.nodes.find((n) => n.id === state.selectedNodeId);
  card.hidden = !member && !node;

  let selectedAt: Point | undefined;
  if (member) {
    const [a, b] = design.endsOf(member);
    selectedAt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    card.replaceChildren(
      ...memberCard(design, member, {
        changeMaterial: (material) => changeSelectedMember(material, member.section),
        changeSection: (section) => changeSelectedMember(member.material, section),
        remove: deleteSelected,
        close: closeSelectCard,
      }),
    );
  } else if (node) {
    selectedAt = node;
    card.replaceChildren(
      ...nodeCard(design, node, {
        changeJoint: (joint) => {
          design.setJoint(node.id, joint);
          refresh();
        },
        remove: deleteSelected,
        close: closeSelectCard,
      }),
    );
  }
  if (selectedAt) {
    const onScreen = camera.toScreen(selectedAt.x, selectedAt.y);
    card.classList.toggle('bottom', onScreen.y < canvas.clientHeight / 2);
  }
}

function currentPhase(): Phase {
  if (state.reflecting) return 'reflect';
  if (state.test) return 'test';
  return state.predicting ? 'predict' : 'build';
}

/** 上のバーで、いまの場面に印を付ける。右のパネルを出すかどうかは、style.css が data-phase を見て決める */
function showPhase(): void {
  const phase = currentPhase();
  app.dataset.phase = phase;
  for (const step of $('steps').children) {
    step.classList.toggle('current', (step as HTMLElement).dataset.phase === phase);
  }
}

/** 目標の帯に星の条件を並べる。試験が終わったら、取れた星をぬる */
function updateGoalStars(): void {
  const list = $('goal-stars');
  list.hidden = isSandbox(stage);
  const finished = state.test?.playback.finished ? state.test : null;
  list.innerHTML = STAR_GOALS.map((goal, i) => {
    const got = finished?.stars[i].achieved ?? false;
    return `<li class="${got ? 'got' : ''}">${got ? '★' : '☆'} ${goal}</li>`;
  }).join('');
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
  const stars = isSandbox(stage) ? null : test.stars;
  box.innerHTML = resultHeadHtml(explanation, stars);

  // 次に押すボタンは、スクロールしなくても見える所に置く
  const nextStage = STAGES[STAGES.indexOf(stage) + 1];
  if (test.outcome.status === 'crossed' && nextStage) {
    box.append(choiceButton('次のステージへ', false, () => openStage(nextStage), 'primary small'));
  }
  box.append(choiceButton('ふりかえりを書く', false, () => openReflection(test, explanation.title), 'secondary small'));
  box.insertAdjacentHTML('beforeend', resultDetailHtml(explanation, stars, prediction));
  if (wasHidden) {
    if (phoneLayout.matches) openDrawer('info');
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

// ---------------------------------------------------------------- ふりかえり

/** 試験した橋の絵と結果を見ながら、気づきを書く画面を開く */
function openReflection(test: TestPlayback, resultTitle: string): void {
  state.reflecting = true;
  $<HTMLImageElement>('reflect-picture').src = canvas.toDataURL('image/png');
  $('reflect-lines').replaceChildren(
    ...reportLines(test).map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }),
  );
  $('reflect-form').replaceChildren(
    reflectionForm(
      state.reflection,
      (text) => (state.reflection = text),
      () => saveReport(test, resultTitle),
    ),
  );
  $('reflect').hidden = false;
  showPhase();
}

function closeReflection(): void {
  state.reflecting = false;
  $('reflect').hidden = true;
  showPhase();
}

/** 振り返りの画面と振り返りシートに書く、試験のまとめ */
function reportLines(test: TestPlayback): string[] {
  const score = scorePredictions(state.guesses, test.playback.currentMembers);
  return [
    `わたる車：${state.vehicle.name}（${tons(state.vehicle.mass)}）`,
    `使った金額：${yen(design.totalCost())}（予算 ${yen(stage.budget)}）`,
    `いちばん苦しい部材の負担率：${utilizationPercent(test.outcome.maxUtilization)}%`,
    ...(isSandbox(stage) ? [] : [`星：${starText(countStars(test.stars))}`]),
    ...(score.total > 0 ? [`力の予想：${score.total} 本中 ${score.correct} 本正解`] : []),
  ];
}

/** 振り返りシートを画像で保存する */
function saveReport(test: TestPlayback, resultTitle: string): void {
  saveReportImage(canvas, {
    stageId: stage.id,
    stageTitle: stage.title,
    resultTitle,
    lines: reportLines(test),
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
