import './style.css';
import { simulateCrossing, VEHICLES } from './engine/crossing';
import type { CrossingOutcome, Vehicle } from './engine/crossing';
import { MATERIALS, SECTIONS } from './engine/materials';
import type { MaterialId, MemberResult, SectionId } from './engine/types';
import { BridgeDesign, memberCost } from './game/design';
import { explainOutcome, modeLabel } from './game/explain';
import { FIRST_STAGE } from './game/stage';
import { Camera } from './ui/camera';
import { MATERIAL_COLORS } from './ui/colors';
import { drawScene, endpoints } from './ui/renderer';
import type { Point, Scene } from './ui/renderer';

type Tool = 'connect' | 'erase' | 'joint';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'connect', label: 'つなぐ', hint: '点から点へなぞるか、2 つの点を順にタップして部材を置こう。' },
  { id: 'erase', label: 'けす', hint: 'けしたい部材か節点をタップしよう。' },
  { id: 'joint', label: '接合をかえる', hint: '節点をタップすると、ピン接合（丸）と剛接合（四角）が切りかわるよ。' },
];

const FRAME_INTERVAL_MS = 40;

const stage = FIRST_STAGE;
const design = new BridgeDesign(stage);
const camera = new Camera();

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
};

interface TestPlayback {
  outcome: CrossingOutcome;
  frameIndex: number;
  finished: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

// ---------------------------------------------------------------- 画面の準備

function setupControls(): void {
  $('stage-name').textContent = stage.title;
  $('budget').textContent = yen(stage.budget);

  const vehicleSelect = $<HTMLSelectElement>('vehicle');
  for (const vehicle of VEHICLES) {
    vehicleSelect.add(new Option(`${vehicle.name}　${(vehicle.mass / 1000).toFixed(1)} t`, vehicle.id));
  }
  vehicleSelect.value = state.vehicle.id;
  vehicleSelect.addEventListener('change', () => {
    state.vehicle = VEHICLES.find((v) => v.id === vehicleSelect.value)!;
  });

  renderChoiceButtons();

  $('load-sample').addEventListener('click', () => {
    leaveTest();
    design.loadSample();
    refresh();
  });
  $('clear').addEventListener('click', () => {
    leaveTest();
    design.clear();
    refresh();
  });
  $('run-test').addEventListener('click', () => (state.test ? leaveTest() : startTest()));
}

function renderChoiceButtons(): void {
  $('materials').replaceChildren(
    ...Object.values(MATERIALS).map((material) =>
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
    ...Object.values(SECTIONS).map((section) =>
      choiceButton(section.name, state.section === section.id, () => {
        state.section = section.id;
        renderChoiceButtons();
      }),
    ),
  );

  $('tools').replaceChildren(
    ...TOOLS.map((tool) =>
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
      maxY: stage.buildArea.maxY + 1,
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
  state.pending = null;
  state.selectedMemberId = null;
  const outcome = simulateCrossing(design.toBridge(), state.vehicle, { roadY: stage.roadY });
  state.test = { outcome, frameIndex: 0, finished: false };
  $('run-test').textContent = '橋を直す';
  $('mode-badge').hidden = false;
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
    refresh();
  }
}

function leaveTest(): void {
  state.test = null;
  state.selectedMemberId = null;
  $('run-test').textContent = '試験スタート';
  $('mode-badge').hidden = true;
  refresh();
}

function currentTestView(): Scene['test'] {
  const test = state.test;
  if (!test) return undefined;

  const frame = test.outcome.frames[test.frameIndex];
  const results = new Map<string, MemberResult>((frame?.result.members ?? []).map((m) => [m.id, m]));
  const brokenIds = new Set(test.finished ? test.outcome.broken.map((b) => b.id) : []);
  const carPosition = frame?.position ?? test.outcome.stoppedAt ?? 0;
  return { results, brokenIds, vehicle: state.vehicle, carPosition };
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
  };
  if (state.dragFrom && state.pointer && !samePoint(state.dragFrom, state.pointer)) {
    const length = Math.hypot(state.pointer.x - state.dragFrom.x, state.pointer.y - state.dragFrom.y);
    scene.preview = { from: state.dragFrom, to: state.pointer, valid: length <= stage.maxMemberLength };
  }
  drawScene(ctx, camera, scene);
}

function updateCost(): void {
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

  $('max-util').textContent = frames.length > 0 ? String(Math.round(maxUtilization * 100)) : '--';
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
      `負担率 <b>${Math.round(result.utilization * 100)}%</b>`,
    );
  }
  box.innerHTML = lines.join('<br>');
}

function updateResult(): void {
  const box = $('result');
  const test = state.test;
  box.hidden = !test?.finished;
  if (!test?.finished) return;

  const explanation = explainOutcome(test.outcome);
  box.innerHTML =
    `<h3>${explanation.title}</h3><p>${explanation.body}</p>` +
    `<b>次はこうしてみよう</b><ul>${explanation.hints.map((h) => `<li>${h}</li>`).join('')}</ul>`;
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
// パネルの幅が変わったときも描き直せるよう、キャンバスの大きさの変化を見張る
new ResizeObserver(resizeCanvas).observe(canvas);
refresh();
