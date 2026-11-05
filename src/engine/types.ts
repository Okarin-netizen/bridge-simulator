// 構造計算で使う型。単位はすべて SI（m, N, Pa, kg）。y 軸は上向きが正。

export type MaterialId = 'wood' | 'steel' | 'aluminum';
export type SectionId = 'square' | 'pipe' | 'hbeam';

/** 節点の接合方法。pin = 回る（モーメントを伝えない）、rigid = 固定（モーメントを伝える） */
export type JointType = 'pin' | 'rigid';

/** 支点の種類。pin = 回転だけ自由、roller = 横にすべる、fixed = まったく動かない */
export type SupportType = 'pin' | 'roller' | 'fixed';

export interface BridgeNode {
  id: string;
  x: number;
  y: number;
  joint: JointType;
  support?: SupportType;
}

export interface BridgeMember {
  id: string;
  a: string;
  b: string;
  material: MaterialId;
  section: SectionId;
}

export interface Bridge {
  nodes: BridgeNode[];
  members: BridgeMember[];
}

/** 節点にかかる力（N）。fy は上向きが正なので、重さは負の値になる */
export interface NodeLoad {
  node: string;
  fx: number;
  fy: number;
}

/** 部材がこわれる（またはこわれそうな）原因 */
export type FailureMode = 'tension' | 'compression' | 'buckling' | 'bending';

export interface MemberResult {
  id: string;
  length: number;
  /** 軸力（N）。正 = 引張、負 = 圧縮 */
  axial: number;
  /** 部材内の最大曲げモーメント（N·m）。ピン接合だけの部材では 0 */
  moment: number;
  /** 負担率。1 を超えるとこわれる */
  utilization: number;
  /** 負担率を決めている原因 */
  mode: FailureMode;
}

export interface AnalysisResult {
  /** 形がくずれずに力を支えられるか（不安定構造なら false） */
  stable: boolean;
  /** 形がくずれるとき、くずれ始める節点 */
  unstableNodeId?: string;
  members: MemberResult[];
  /** 節点の変位（m）と回転（rad） */
  displacements: Map<string, { dx: number; dy: number; rot: number }>;
  /** 支点反力（N） */
  reactions: Map<string, { rx: number; ry: number; m: number }>;
}
