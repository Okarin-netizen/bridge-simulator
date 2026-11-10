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
  /** わたり切ったときに見せる「わかったこと」（実験モードにはない） */
  lesson?: string;
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
    lesson: '道路だけの橋は形を保てない。上や下から支える部材を足すと、車の重さを岸まで伝えられる。',
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
    lesson: '1 本の部材は長くできないので、短い部材を三角形に組み合わせて、長い谷をわたる。',
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
    lesson: '三角形は、つなぎ目が回っても形が変わらない。三角形を組み合わせた骨組みを「トラス構造」という。四角形に入れた斜めの部材は、建物の「筋かい」と同じ役目。',
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
    lesson: '同じお金でも、組み方を変えると強さが変わる。むだな部材を減らして、安くて強い形を探すのが設計。',
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
    lesson: 'トラスは道路の下に組んでもよい。上に組んでも下に組んでも、上側の部材は押され、下側の部材は引っぱられる。',
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
    lesson: '押される細長い部材は、急に横へ曲がる（座屈）。押される部材には、どの向きにも曲がりにくいパイプが向く。',
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
    hint: 'ピン接合の四角形はくずれる。角の節点をタップして「剛接合（ごうせつごう）」にすると……？（ラーメン構造）',
    lesson: 'つなぎ目を固める「剛接合」にすると、斜めの部材がなくても四角形がくずれない。これを「ラーメン構造」といい、校舎の柱と梁と同じしくみ。部材が曲げられるので、トラスより材料がたくさんいる。',
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
    lesson: '材料は適材適所で使う。強いけれど高い鋼材は、大きな力で押される部材にだけ使う。',
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
    lesson: '形（三角形）・断面・材料の工夫を組み合わせると、少ないお金で強い橋ができる。',
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
