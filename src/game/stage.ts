import type { BridgeNode, MaterialId, SectionId } from '../engine/types';

export type Coordinate = [x: number, y: number];

/** はじめから置いてある部材（直す課題などで使う） */
export interface PresetMember {
  from: Coordinate;
  to: Coordinate;
  material?: MaterialId;
}

export interface Stage {
  id: string;
  chapter: string;
  title: string;
  /** ステージの目標（画面の下に出す） */
  goal: string;
  /** 最初に見せるヒント */
  hint: string;
  /** 谷の幅（m）。左岸が x = 0、右岸が x = span */
  span: number;
  /** 道路の高さ（m） */
  roadY: number;
  /** 谷の深さ（m） */
  depth: number;
  /** はじめから置いてある支点 */
  anchors: BridgeNode[];
  /** 節点を置ける範囲 */
  buildArea: { minX: number; maxX: number; minY: number; maxY: number };
  /** 節点が吸い付く格子の間隔（m） */
  gridSize: number;
  /** 1 本の部材の最大の長さ（m） */
  maxMemberLength: number;
  budget: number;
  /** わたる車の id。null なら生徒が選べる（実験モード） */
  vehicleId: string | null;
  materials: MaterialId[];
  sections: SectionId[];
  allowRigidJoints: boolean;
  allowDiagonals: boolean;
  presetMembers: PresetMember[];
}

/** 剛接合の節点 1 つあたりの値段（円） */
export const RIGID_JOINT_PRICE = 1500;

function anchorsFor(span: number, withLowAnchors: boolean): BridgeNode[] {
  const anchors: BridgeNode[] = [
    { id: 'anchor-left', x: 0, y: 0, joint: 'pin', support: 'pin' },
    { id: 'anchor-right', x: span, y: 0, joint: 'pin', support: 'roller' },
  ];
  if (withLowAnchors) {
    anchors.push(
      { id: 'anchor-left-low', x: 0, y: -4, joint: 'pin', support: 'pin' },
      { id: 'anchor-right-low', x: span, y: -4, joint: 'pin', support: 'pin' },
    );
  }
  return anchors;
}

/** ステージの共通部分を埋めて作る */
function defineStage(
  stage: Pick<Stage, 'id' | 'chapter' | 'title' | 'goal' | 'hint' | 'span' | 'budget' | 'vehicleId'> &
    Partial<Stage> & { lowAnchors?: boolean },
): Stage {
  const { lowAnchors = false, ...rest } = stage;
  return {
    roadY: 0,
    depth: 10,
    anchors: anchorsFor(stage.span, lowAnchors),
    buildArea: { minX: 0, maxX: stage.span, minY: lowAnchors ? -8 : -6, maxY: 8 },
    gridSize: 2,
    maxMemberLength: 6,
    materials: ['wood'],
    sections: ['square'],
    allowRigidJoints: false,
    allowDiagonals: true,
    presetMembers: [],
    ...rest,
  };
}

export const STAGES: Stage[] = [
  defineStage({
    id: '1-1',
    chapter: '第1章　はじめての橋',
    title: '1-1　小さな谷',
    goal: '軽自動車をわたらせよう',
    hint: '道路の高さで岸から岸まで部材をつなぎ、上か下から支えよう。',
    span: 8,
    budget: 12_000,
    vehicleId: 'kei',
  }),
  defineStage({
    id: '1-2',
    chapter: '第1章　はじめての橋',
    title: '1-2　すこし広い谷',
    goal: '乗用車をわたらせよう',
    hint: '1 本の部材は 6 m まで。長い谷は、いくつかの部材を組み合わせてわたそう。',
    span: 16,
    budget: 30_000,
    vehicleId: 'car',
  }),
  defineStage({
    id: '2-1',
    chapter: '第2章　三角形のひみつ',
    title: '2-1　くずれる橋を直そう',
    goal: 'この橋は形がくずれてしまう。部材を足して、乗用車をわたらせよう',
    hint: 'まずは試験してみよう。四角形の中に斜めの部材を入れると……？',
    span: 16,
    budget: 30_000,
    vehicleId: 'car',
    presetMembers: [
      ...[0, 4, 8, 12].map((x): PresetMember => ({ from: [x, 0], to: [x + 4, 0] })),
      ...[4, 8].map((x): PresetMember => ({ from: [x, 4], to: [x + 4, 4] })),
      ...[4, 8, 12].map((x): PresetMember => ({ from: [x, 0], to: [x, 4] })),
      { from: [0, 0], to: [4, 4] },
      { from: [16, 0], to: [12, 4] },
    ],
  }),
  defineStage({
    id: '2-2',
    chapter: '第2章　三角形のひみつ',
    title: '2-2　予算をまもって',
    goal: '予算の中で、乗用車をわたらせよう',
    hint: '三角形をうまく並べると、少ない部材で強い橋になるよ。',
    span: 24,
    budget: 38_000,
    vehicleId: 'car',
  }),
  defineStage({
    id: '2-3',
    chapter: '第2章　三角形のひみつ',
    title: '2-3　上に組めない橋',
    goal: '道路より上に部材を置かずに、乗用車をわたらせよう',
    hint: '上がだめなら下がある。三角形は道路の下に組んでもいいよ。',
    span: 16,
    budget: 30_000,
    vehicleId: 'car',
    buildArea: { minX: 0, maxX: 16, minY: -6, maxY: 0 },
  }),
  defineStage({
    id: '3-1',
    chapter: '第3章　引っぱる力と押す力',
    title: '3-1　バスがわたる橋',
    goal: '重いバス（11 t）をわたらせよう',
    hint: '試験で赤くこくなる部材は、押されて曲がりやすい。そこだけ断面を変えてみよう。',
    span: 16,
    budget: 60_000,
    vehicleId: 'bus',
    materials: ['wood', 'steel'],
    sections: ['square', 'pipe', 'hbeam'],
    lowAnchors: true,
  }),
  defineStage({
    id: '3-2',
    chapter: '第3章　引っぱる力と押す力',
    title: '3-2　斜めの部材が使えない',
    goal: '斜めの部材を使わずに、乗用車をわたらせよう',
    hint: 'ピン接合の四角形はくずれる。角を「剛接合」にすると……？（ラーメン構造）',
    span: 12,
    budget: 80_000,
    vehicleId: 'car',
    materials: ['wood', 'steel'],
    sections: ['square', 'pipe', 'hbeam'],
    allowRigidJoints: true,
    allowDiagonals: false,
  }),
  defineStage({
    id: '3-3',
    chapter: '第3章　引っぱる力と押す力',
    title: '3-3　トラックがわたる橋',
    goal: '20 t のトラックを、予算の中でわたらせよう',
    hint: '鋼材（鉄）は強いけれど高い。押される部材だけ鋼材にしてみよう。',
    span: 16,
    budget: 80_000,
    vehicleId: 'truck',
    materials: ['wood', 'steel'],
    sections: ['square', 'pipe', 'hbeam'],
  }),
  defineStage({
    id: '4-1',
    chapter: '第4章　チャレンジ',
    title: '4-1　大きな谷',
    goal: '24 m の谷に、バスがわたれる橋をかけよう',
    hint: 'これまでに見つけたことを全部使おう。形・材料・断面のどれを変えると、いちばん効くかな？',
    span: 24,
    budget: 110_000,
    vehicleId: 'bus',
    materials: ['wood', 'steel', 'aluminum'],
    sections: ['square', 'pipe', 'hbeam'],
    allowRigidJoints: true,
    lowAnchors: true,
  }),
];

/** 制約なしで自由に試せる実験モード */
export const SANDBOX_STAGE: Stage = defineStage({
  id: 'sandbox',
  chapter: '実験モード',
  title: '自由に作ろう',
  goal: '材料・断面・接合・車を自由に変えて試そう',
  hint: '同じ形で材料や接合だけを変えると、ちがいがよくわかるよ。',
  span: 24,
  budget: 200_000,
  vehicleId: null,
  maxMemberLength: 8.5,
  materials: ['wood', 'steel', 'aluminum'],
  sections: ['square', 'pipe', 'hbeam'],
  allowRigidJoints: true,
  lowAnchors: true,
});

export function isSandbox(stage: Stage): boolean {
  return stage.id === SANDBOX_STAGE.id;
}

/** ステージを始めたときに出す説明（目標とヒント） */
export function introText(stage: Stage): string {
  return `${stage.goal}。${stage.hint}`;
}
