import './style.css';
import { simulateCrossing, VEHICLES } from './engine/crossing';
import type { CrossingOutcome, Vehicle } from './engine/crossing';
import { isTensionOnly } from './engine/materials';
import type { MaterialId, Point, SectionId } from './engine/types';
import { BridgeDesign } from './game/design';
import { explainOutcome } from './game/explain';
import { isPerfectPrediction, nextGuess, scorePredictions } from './game/prediction';
import type { Guess } from './game/prediction';
import { countStars, isMasterBuild, Progress, rateAttempt, STAR_GOALS, utilizationPercent } from './game/score';
import type { StarCheck } from './game/score';
import { loadWork, saveWork } from './game/savedWork';
import {
  buildCustomStage,
  CustomStageShelf,
  DEFAULT_SETTINGS,
  normalizeSettings,
  settingsFromHash,
  shareLink,
} from './game/customStage';
import type { CustomStageEntry, CustomStageSettings } from './game/customStage';
import { introText, isSandbox, SANDBOX_STAGE, STAGES } from './game/stage';
import type { Stage } from './game/stage';
import { Camera } from './ui/camera';
import { materialButtons, sectionButtons, stageGroups, stageRecordHtml } from './ui/choices';
import { $, choiceButton, showToast } from './ui/dom';
import { memberKind, tons, yen } from './ui/format';
import { findMemberNear, findNodeNear, hitRadiusFor, samePoint } from './ui/hitTest';
import type { HitRadius } from './ui/hitTest';
import { drawLoupe } from './ui/loupe';
import type { LoupeLabel } from './ui/loupe';
import { CrossingPlayback } from './ui/playback';
import { drawScene } from './ui/renderer';
import type { Scene } from './ui/renderer';
import { saveReportImage } from './ui/report';
import { celebrate, shake, stamp } from './ui/celebrate';
import { play, setSoundEnabled, soundEnabled } from './ui/sound';
import {
  comparisonHtml,
  lessonHtml,
  masterHtml,
  memberInfoHtml,
  reflectionForm,
  resultDetailHtml,
  resultHeadHtml,
  starText,
} from './ui/resultPanel';
import { memberCard, nodeCard } from './ui/selectCard';
import { customStageGroup, stageMakerForm } from './ui/stageMaker';
import { TitleDemo } from './ui/titleDemo';

/** これより動かさずにはなしたら「タップ」とみなす（画面の px）。指はぶれるので広めにする */
const TAP_SLOP = { mouse: 6, touch: 12 };
/** 実験モードで選べる、列になってわたる車の台数の上限 */
const MAX_VEHICLE_COUNT = 3;
/** 置いたばかりの節点がポンとふくらんで、もとの大きさにもどるまでの時間（ミリ秒）と、最初の大きさ */
const NODE_POP_DURATION = 220;
const NODE_POP_SCALE = 1.9;

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
const customStages = new CustomStageShelf();
/** 配られたリンクから開いたときに、タイトル画面のあとすぐ遊ぶステージ */
let linkedStage: Stage | null = null;

interface EditorState {
  material: MaterialId;
  section: SectionId;
  vehicle: Vehicle;
  /** 同じ車が何台、列になってわたるか */
  vehicleCount: number;
  /** 画面を押しているあいだの、押し始めた所。はなしたときに「タップ＝選ぶ」か「なぞる＝置く」かを決める */
  press: Press | null;
  dragFrom: Point | null;
  pointer: Point | null;
  /** 指でなぞっているときの指先の位置（画面の px）。ルーペを出すのに使う */
  finger: Point | null;
  /** タップで選んだ部材。試験の結果では、力を見る部材にもなる */
  selectedMemberId: string | null;
  /** タップで選んだ節点 */
  selectedNodeId: string | null;
  test: TestPlayback | null;
  /** 試験の前に、部材の力の向きを予想しているところか */
  predicting: boolean;
  guesses: Map<string, Guess>;
  /** 振り返りシートに書く気づき */
  reflection: string;
  /** 振り返りを書く画面を開いているか */
  reflecting: boolean;
  /** 置いたばかりの節点と、置いた時刻（ポンとふくらませるのに使う） */
  poppedAt: Map<string, number>;
}

const state: EditorState = {
  material: 'wood',
  section: 'square',
  vehicle: VEHICLES[1],
  vehicleCount: 1,
  press: null,
  dragFrom: null,
  pointer: null,
  finger: null,
  selectedMemberId: null,
  selectedNodeId: null,
  test: null,
  predicting: false,
  guesses: new Map(),
  reflection: '',
  reflecting: false,
  poppedAt: new Map(),
};

/** いまの場面。上のバーの 1〜4 と、右のパネルを出すかどうかがこれで決まる */
type Phase = 'build' | 'predict' | 'test' | 'reflect';

interface TestPlayback {
  outcome: CrossingOutcome;
  playback: CrossingPlayback;
  stars: StarCheck[];
  /** 試験した橋の金額 */
  cost: number;
  /** この試験で★3 の最安記録を更新したか（試験が終わったときに決まる） */
  newRecord?: boolean;
}

type Drawer = 'tools' | 'info';

/** スマホを横にしたときの画面（style.css の @media と同じ条件） */
const phoneLayout = window.matchMedia('(orientation: landscape) and (max-height: 520px)');

const app = document.querySelector<HTMLElement>('.app')!;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const titleDemo = new TitleDemo($<HTMLCanvasElement>('title-canvas'));

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

  const countSelect = $<HTMLSelectElement>('vehicle-count');
  for (let count = 1; count <= MAX_VEHICLE_COUNT; count++) countSelect.add(new Option(`${count}台`, String(count)));
  countSelect.addEventListener('change', () => {
    leaveTest();
    state.vehicleCount = Number(countSelect.value);
    draw();
  });

  // 「はじめる」だけでなく、動いている橋のどこを押しても始められるようにする（先生用ページへのリンクはのぞく）
  $('title-screen').addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) leaveTitle();
  });
  $('open-stage-select').addEventListener('click', showStageSelect);
  $('load-sample').addEventListener('click', () => changeDesign(() => design.loadSample()));
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', () => changeDesign(() => design.clear()));
  document.addEventListener('keydown', (event) => {
    // ステージを選んだり振り返りを書いたりしているあいだは、うしろの橋を変えない
    const choosingStage =
      !$('title-screen').hidden || !$('stage-select').hidden || !$('stage-maker').hidden || state.reflecting;
    // Caps Lock がかかっていると 'Z' になるので、小文字にそろえてから見る
    const isUndoKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z';
    if (isUndoKey && !isTyping(event) && !choosingStage) {
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
  // 車が走っているあいだは「とばす」、見終わったら「もう一度見る」になるボタン
  $('replay').addEventListener('click', () => (state.test?.playback.finished ? replayTest() : skipTest()));
  $('sound').addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    showSoundSetting();
  });
  showSoundSetting();
  $('close-reflect').addEventListener('click', closeReflection);
  $('predict').addEventListener('click', () => setPredicting(!state.predicting));

  $('open-tools').addEventListener('click', () => openDrawer('tools'));
  $('open-info').addEventListener('click', () => openDrawer('info'));
  for (const button of document.querySelectorAll('[data-close-drawer]')) {
    button.addEventListener('click', closeDrawer);
  }
}

/** タイトル画面から、ステージ選択へ進む */
function leaveTitle(): void {
  titleDemo.stop();
  $('title-screen').hidden = true;
  play('place');
  if (linkedStage) {
    openStage(linkedStage);
    linkedStage = null;
  } else {
    showStageSelect();
  }
}

function showSoundSetting(): void {
  const button = $('sound');
  button.setAttribute('aria-pressed', String(soundEnabled()));
  button.textContent = soundEnabled() ? '音 オン' : '音 オフ';
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
  // 前にこのステージで組んでいた橋があれば、その続きから。下の refresh で上書きしないよう、先に読みこむ
  design = new BridgeDesign(stage);
  const saved = loadWork(stage.id);
  if (saved) design.restore(saved.bridge);
  state.reflection = saved?.reflection ?? '';
  state.material = stage.materials[0];
  state.section = stage.sections[0];
  clearSelection();
  state.guesses.clear();
  setPredicting(false);
  leaveTest();

  $('stage-chapter').textContent = stage.chapter;
  $('stage-name').textContent = stage.title;
  $('budget').textContent = yen(stage.budget);
  $('hint').textContent = hasOwnMembers()
    ? '前に組んだ橋の続きからだよ。はじめから作るときは「はじめから」を押してね。'
    : startHint();
  $('goal-text').textContent = stage.goal;
  $('load-sample').hidden = !isSandbox(stage);
  $('legend-rigid').hidden = !stage.allowRigidJoints;
  $('joint-help').hidden = !stage.allowRigidJoints;

  // 車が決まっているステージでは、選べる箱ではなく、ただの文字で見せる
  const vehicleSelect = $<HTMLSelectElement>('vehicle');
  const vehicleIsFixed = stage.vehicleId !== null;
  if (vehicleIsFixed) {
    state.vehicle = VEHICLES.find((v) => v.id === stage.vehicleId)!;
    state.vehicleCount = stage.vehicleCount;
    vehicleSelect.value = state.vehicle.id;
    $('vehicle-fixed').textContent = vehicleText();
  }
  $<HTMLSelectElement>('vehicle-count').value = String(state.vehicleCount);
  $('vehicle-choices').hidden = vehicleIsFixed;
  $('vehicle-fixed').hidden = !vehicleIsFixed;

  $('stage-select').hidden = true;
  closeDrawer();
  renderChoiceButtons();
  resizeCanvas();
}

/** わたる車を「乗用車 1.2 t」、列なら「乗用車 1.2 t × 3 台」と書く */
function vehicleText(): string {
  const vehicle = `${state.vehicle.name} ${tons(state.vehicle.mass)}`;
  return state.vehicleCount > 1 ? `${vehicle} × ${state.vehicleCount} 台` : vehicle;
}

function showStageSelect(): void {
  // まだ星を取っていない最初のステージに「つぎはここ」の印を付ける
  const nextStage = STAGES.find((s) => progress.starsFor(s.id) === 0);
  const record = (s: Stage) =>
    stageRecordHtml({
      stars: starText(progress.starsFor(s.id)),
      bestCost: progress.bestCostFor(s.id),
      masterCost: s.masterCost,
      perfectPrediction: progress.hasPerfectPrediction(s.id),
    });
  const groups = stageGroups(
    [...STAGES, SANDBOX_STAGE],
    (s) => (isSandbox(s) ? '' : record(s)),
    nextStage?.id,
    openStage,
  );
  const custom = customStageGroup(
    customStages.entries.map((entry) => {
      const stage = buildCustomStage(entry);
      return { entry, stage, record: record(stage) };
    }),
    { open: openStage, edit: openStageMaker, create: () => openStageMaker() },
  );
  $('stage-list').replaceChildren(...groups, custom);
  $('stage-select').hidden = false;
}

// ---------------------------------------------------------------- ステージ作成

/** ステージを作る（entry を渡したときは、そのステージを直す）入力欄を開く */
function openStageMaker(entry?: CustomStageEntry): void {
  const closeMaker = () => ($('stage-maker').hidden = true);
  const save = (input: CustomStageSettings) => {
    // 予算のはんぱな数や長すぎる名前は、ここで遊べる値にそろえる
    const settings = normalizeSettings(input);
    if (!settings) return;
    const saved = entry ? customStages.update(entry.id, settings) : customStages.add(settings);
    closeMaker();
    if (saved) openStage(buildCustomStage(saved));
  };
  const remove = () => {
    if (!entry) return;
    customStages.remove(entry.id);
    closeMaker();
    showStageSelect();
  };

  $('stage-maker-title').textContent = entry ? 'ステージを直す・配る' : 'ステージをつくる';
  $('stage-maker-form').replaceChildren(
    stageMakerForm(
      entry?.settings ?? DEFAULT_SETTINGS,
      { link: entry ? shareLink(entry.settings, location.href) : undefined },
      { save, cancel: closeMaker, remove: entry ? remove : undefined },
    ),
  );
  $('stage-maker').hidden = false;
}

/** 配られたリンク（# のうしろにステージの条件が入っている）から開いたら、そのステージを入れておく */
function receiveLinkedStage(): void {
  const settings = settingsFromHash(location.hash);
  if (!settings) return;
  linkedStage = buildCustomStage(customStages.add(settings));
  // 開きなおしたときに、また同じステージから始まらないよう、URL の # は消しておく
  history.replaceState(null, '', location.pathname + location.search);
}

function renderChoiceButtons(): void {
  $('materials').replaceChildren(
    ...materialButtons(stage.materials, state.material, (id) => {
      state.material = id;
      renderChoiceButtons();
    }),
  );
  // ワイヤーは太さが決まっているので、断面のボタンのかわりに説明を出す
  if (isTensionOnly(state.material)) {
    const note = document.createElement('p');
    note.className = 'wire-note';
    note.textContent = 'ワイヤーは太さが決まっているよ（直径 2 cm）。引っぱられる所にだけ使おう。';
    $('sections').replaceChildren(note);
  } else {
    $('sections').replaceChildren(
      ...sectionButtons(stage.sections, state.section, (id) => {
        state.section = id;
        renderChoiceButtons();
      }),
    );
  }
  $('tools-summary').textContent = memberKind(state);
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
  popNodesAt([start, end]);
  play('place');
  $('hint').textContent = stage.allowRigidJoints
    ? '部材を置いたよ。節点（丸）をタップすると剛接合にかえられるよ。部材をタップすると、材料をかえたり、けしたりできるよ。'
    : '部材を置いたよ。置いた部材や節点をタップすると、材料をかえたり、けしたりできるよ。';
}

/** 置いた部材の両はしの節点を、ポンとふくらませる */
function popNodesAt(points: Point[]): void {
  const now = performance.now();
  for (const node of design.nodes) {
    if (points.some((p) => samePoint(p, node))) state.poppedAt.set(node.id, now);
  }
  requestAnimationFrame(animatePop);
}

function animatePop(now: number): void {
  for (const [id, startedAt] of state.poppedAt) {
    if (now - startedAt > NODE_POP_DURATION) state.poppedAt.delete(id);
  }
  draw();
  if (state.poppedAt.size > 0) requestAnimationFrame(animatePop);
}

/** ふくらんでいる節点の、いまの大きさの倍率。はじめ大きく、すっともどる */
function poppingNodes(): Map<string, number> {
  const now = performance.now();
  const scales = new Map<string, number>();
  for (const [id, startedAt] of state.poppedAt) {
    const left = Math.max(0, 1 - (now - startedAt) / NODE_POP_DURATION);
    scales.set(id, 1 + (NODE_POP_SCALE - 1) * left * left);
  }
  return scales;
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
  play('remove');
  clearSelection();
  refresh();
}

// ---------------------------------------------------------------- 走行試験

function startTest(): void {
  closeDrawer();
  setPredicting(false);
  const outcome = simulateCrossing(design.toBridge(), state.vehicle, {
    roadY: stage.roadY,
    span: stage.span,
    count: state.vehicleCount,
  });
  const cost = design.totalCost();
  const stars = rateAttempt(outcome, cost, stage.budget);
  playTest({ outcome, playback: new CrossingPlayback(outcome), stars, cost });
}

/** 車がわたる様子を最後まで見ずに、結果へ進む */
function skipTest(): void {
  const test = state.test;
  if (!test || test.playback.finished) return;
  if (test.playback.phase === 'driving' && test.outcome.status !== 'crossed') breakEffects();
  test.playback.skipToEnd();
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
  // 試験のあいだは予想できないので、同じ場所に「とばす」を出す（わたり終わったら「もう一度見る」になる）
  $('predict').hidden = true;
  $('replay').hidden = false;
  $('replay').textContent = 'とばす';
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
    const wasDriving = test.playback.phase === 'driving';
    test.playback.advance(seconds);
    // 車が止まって橋がこわれ始めた瞬間に、画面をゆらす
    if (wasDriving && test.playback.phase !== 'driving' && test.outcome.status !== 'crossed') breakEffects();

    if (test.playback.finished) {
      finishTest(test);
    } else {
      refresh();
      playAnimation(test, now);
    }
  });
}

/** こわれた瞬間の、ゆれと音 */
function breakEffects(): void {
  shake($('canvas-wrap'));
  play('break');
}

function finishTest(test: TestPlayback): void {
  const crossed = test.outcome.status === 'crossed';
  // わたり切ったあとは、負担率がいちばん大きかった瞬間にもどして色を見せる。
  // 力の予想も、この画面に出している瞬間の力で答え合わせするので、記録する前にもどしておく
  if (crossed) test.playback.showHardestMoment();

  const firstTime = test.newRecord === undefined;
  // 「もう一度見る」では、同じ試験をもう一度記録しない
  if (!isSandbox(stage) && firstTime) {
    test.newRecord = progress.record(stage.id, countStars(test.stars), test.cost);
    if (predictedPerfectly(test)) progress.recordPerfectPrediction(stage.id);
  }
  if (crossed) {
    showToast('いちばん苦しかった瞬間を表示しています');
    stamp($('canvas-wrap'), countStars(test.stars) === 3 ? 'かんぺき！' : 'わたれた！');
    play('cross');
  }
  $('replay').textContent = 'もう一度見る';
  $('hint').textContent = '部材をタップすると、押されているか引っぱられているかと、力の大きさがわかるよ。';
  refresh();
}

/** 試験の前に、すべての部材の力の向きを予想して、全部当てたか */
function predictedPerfectly(test: TestPlayback): boolean {
  return isPerfectPrediction(scorePredictions(state.guesses, test.playback.currentMembers), design.members.length);
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
  const wrongGuessIds = playback.finished ? scorePredictions(state.guesses, playback.currentMembers).wrongIds : [];
  return { ...playback.scene(state.vehicle, state.vehicleCount), wrongGuessIds: new Set(wrongGuessIds) };
}

// ---------------------------------------------------------------- 表示の更新

/** 橋が変わったときは必ずここを通るので、ここで端末に覚えておく */
function refresh(): void {
  rememberWork();
  showPhase();
  updateGoalStars();
  updateCost();
  updateInfoPanel();
  updateSelectCard();
  draw();
}

function rememberWork(): void {
  saveWork(stage.id, { bridge: design.toBridge(), reflection: state.reflection });
}

/** ステージにはじめからある部材のほかに、自分で置いた部材があるか */
function hasOwnMembers(): boolean {
  return design.members.length > stage.presetMembers.length;
}

function draw(): void {
  const scene: Scene = {
    design,
    test: currentTestView(),
    selectedMemberId: state.selectedMemberId ?? undefined,
    selectedNodeId: state.selectedNodeId ?? undefined,
    showSectionMarks: stage.sections.length > 1,
    guesses: state.guesses,
    poppingNodes: poppingNodes(),
  };
  if (state.dragFrom && state.pointer && !samePoint(state.dragFrom, state.pointer)) {
    scene.preview = { from: state.dragFrom, to: state.pointer, valid: isShortEnough(state.dragFrom, state.pointer) };
  }
  drawScene(ctx, camera, scene);
  updateDragGuide();

  if (state.finger && state.dragFrom && state.pointer) {
    const target = camera.toScreen(state.pointer.x, state.pointer.y);
    drawLoupe(ctx, target, state.finger, loupeLabel(state.dragFrom, state.pointer));
  }
}

/**
 * まだ何も置いていないときは、左の支点から右へなぞるお手本の指を動かして見せる。
 * 説明を読まなくても、置き方が目でわかるように。1 本置けば消える
 */
function updateDragGuide(): void {
  const guide = $('drag-guide');
  guide.hidden = design.members.length > 0 || state.test !== null || state.predicting || state.press !== null;
  if (guide.hidden) return;

  const anchor = stage.anchors[0];
  const from = camera.toScreen(anchor.x, anchor.y);
  const to = camera.toScreen(anchor.x + stage.gridSize * 2, anchor.y);
  guide.style.left = `${from.x}px`;
  guide.style.top = `${from.y}px`;
  guide.style.setProperty('--length', `${to.x - from.x}px`);
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
  showMasterLine();
}

/** ★3 のあとの目標として、名人ラインを金額のメーターに出す。名人ラインをクリアしたステージでは色を変える */
function showMasterLine(): void {
  const label = $('master-line');
  const mark = $('master-mark');
  const { masterCost } = stage;
  label.hidden = mark.hidden = masterCost === undefined;
  if (masterCost === undefined) return;

  const best = progress.bestCostFor(stage.id);
  label.textContent = `名人ライン ${yen(masterCost)}` + (best !== undefined && best <= masterCost ? ' クリア！' : '');
  label.classList.toggle('got', best !== undefined && best <= masterCost);
  mark.style.left = `${(masterCost / stage.budget) * 100}%`;
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
  // hidden は 'until-found' という値もとるので、真偽値にそろえておく
  const wasHidden = Boolean(box.hidden);
  box.hidden = !test?.playback.finished;
  if (!test?.playback.finished) return;

  const usesWire = design.members.some((member) => isTensionOnly(member.material));
  const explanation = explainOutcome(test.outcome, { allowRigidJoints: stage.allowRigidJoints, usesWire });
  const prediction = scorePredictions(state.guesses, test.playback.currentMembers);
  const stars = isSandbox(stage) ? null : test.stars;
  box.innerHTML = resultHeadHtml(explanation, stars);
  if (stars && countStars(stars) === 3 && stage.masterCost !== undefined) {
    box.insertAdjacentHTML('beforeend', masterHtml(test.cost, stage.masterCost, test.newRecord ?? false));
  }

  // 次に押すボタンは、スクロールしなくても見える所に置く
  // 実験モードや作ったステージには、決まった「次」はない
  const index = STAGES.indexOf(stage);
  const nextStage = index >= 0 ? STAGES[index + 1] : undefined;
  if (test.outcome.status === 'crossed' && nextStage) {
    box.append(choiceButton('次のステージへ', false, () => openStage(nextStage), 'primary small'));
  }
  box.append(choiceButton('ふりかえりを書く', false, () => openReflection(test, explanation.title), 'secondary small'));
  if (test.outcome.status === 'crossed' && stage.lesson) box.insertAdjacentHTML('beforeend', lessonHtml(stage.lesson));
  if (test.outcome.status === 'crossed' && stage.comparison) {
    box.insertAdjacentHTML('beforeend', comparisonHtml(test.cost, stage.comparison));
  }
  box.insertAdjacentHTML('beforeend', resultDetailHtml(explanation, stars, prediction, predictedPerfectly(test)));
  // 星がポンと出る動きは、結果が出た最初の 1 回だけ（部材をタップして書きかえたときはしない）
  box.classList.toggle('appear', wasHidden);
  if (wasHidden) {
    if (phoneLayout.matches) openDrawer('info');
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (stars && countStars(stars) === 3) celebrate($('canvas-wrap'));
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
      (text) => {
        state.reflection = text;
        rememberWork();
      },
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
    `わたる車：${vehicleText()}`,
    `使った金額：${yen(test.cost)}（予算 ${yen(stage.budget)}）`,
    `いちばん苦しい部材の負担率：${utilizationPercent(test.outcome.maxUtilization)}%`,
    ...(isSandbox(stage) ? [] : [`星：${starText(countStars(test.stars))}`]),
    ...(isMasterBuild(countStars(test.stars), test.cost, stage.masterCost)
      ? [`名人ライン（${yen(stage.masterCost!)}）をクリア`]
      : []),
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
receiveLinkedStage();
openStage(STAGES[0]);
// パネルの幅が変わったときも描き直せるよう、キャンバスの大きさの変化を見張る
new ResizeObserver(resizeCanvas).observe(canvas);
new ResizeObserver(() => titleDemo.resize()).observe($('title-canvas'));
refresh();
titleDemo.start();

// 一度開けば、ネットが切れても使えるようにする（開発中はキャッシュがじゃまになるので公開版だけ）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 登録できなくても、ふつうに遊べるので何もしない
  });
}
