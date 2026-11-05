import type { CrossingOutcome } from '../engine/crossing';
import { GRAVITY } from '../engine/materials';
import type { MemberResult } from '../engine/types';

/** 画面の上で車が走る速さ（m/秒）。実際より遅くして、色の変化を目で追えるようにする */
const DRIVE_SPEED = 8;
/** 橋に乗る前と、わたり切ったあとに岸を走るきょり（m） */
const BANK_RUN = 5;
/** たわみを大きくして見せるときの最大の倍率と、画面に出す最大のたわみ（m） */
const MAX_DEFLECTION_SCALE = 300;
const MAX_DRAWN_DEFLECTION = 1.5;
/** こわれたあと、落ちていくのを見せる時間（秒） */
const FALL_DURATION = 1.6;
/** 倍率は、きりのよい数にする */
const NICE_SCALES = [300, 200, 100, 50, 20, 10, 5, 2, 1];

export type PlaybackPhase = 'driving' | 'falling' | 'finished';

/**
 * 走行試験の結果を、アニメーションとして再生する。
 * 計算は 0.5 m ごとにしかしていないので、そのあいだの車の位置やたわみは前後の結果から補う。
 */
export class CrossingPlayback {
  phase: PlaybackPhase = 'driving';
  /** 車の中心の x 座標（m） */
  carX: number;
  /** こわれて落ちたきょり（m） */
  fallDistance = 0;
  /** たわみを何倍にして見せるか */
  readonly deflectionScale: number;

  private readonly endX: number;
  private readonly firstX: number;
  private readonly step: number;
  private fallTime = 0;

  constructor(readonly outcome: CrossingOutcome) {
    const { frames } = outcome;
    this.firstX = frames[0]?.position ?? outcome.stoppedAt ?? 0;
    this.step = frames.length > 1 ? frames[1].position - frames[0].position : 0.5;
    this.carX = this.firstX - BANK_RUN;
    this.endX = outcome.status === 'crossed' ? frames[frames.length - 1].position + BANK_RUN : (outcome.stoppedAt ?? this.firstX);
    this.deflectionScale = chooseDeflectionScale(outcome);
  }

  /** 前の画面から seconds 秒すすめる */
  advance(seconds: number): void {
    if (this.phase === 'driving') {
      this.carX = Math.min(this.endX, this.carX + DRIVE_SPEED * seconds);
      if (this.carX >= this.endX) this.phase = this.outcome.status === 'crossed' ? 'finished' : 'falling';
    } else if (this.phase === 'falling') {
      this.fallTime += seconds;
      this.fallDistance = 0.5 * GRAVITY * this.fallTime ** 2;
      if (this.fallTime >= FALL_DURATION) this.phase = 'finished';
    }
  }

  /**
   * 部材が落ちたきょり（m）。落ち終わったら元の位置にもどして、どの部材がこわれたかを見られるようにする
   */
  get memberFallDistance(): number {
    return this.phase === 'falling' ? this.fallDistance : 0;
  }

  /** 形がくずれたときは、こわれた部材だけでなく橋全体が落ちる */
  get wholeBridgeFalls(): boolean {
    return this.outcome.status === 'unstable';
  }

  /** 車も谷へ落ちるか。形がくずれたときは、車は岸の上で止まる */
  get carFalls(): boolean {
    return this.phase !== 'driving' && this.outcome.status !== 'unstable';
  }

  get finished(): boolean {
    return this.phase === 'finished';
  }

  /** いまの車の位置にいちばん近い計算結果の番号（まだ橋に乗っていなければ -1） */
  get frameIndex(): number {
    const { frames } = this.outcome;
    if (frames.length === 0 || this.carX < this.firstX - this.step / 2) return -1;
    return Math.min(frames.length - 1, Math.round((this.carX - this.firstX) / this.step));
  }

  get currentMembers(): MemberResult[] {
    return this.outcome.frames[this.frameIndex]?.result.members ?? [];
  }

  /** 車が通ってきたあいだで、いちばん大きかった負担率 */
  get maxUtilizationSoFar(): number {
    const passed = this.outcome.frames.slice(0, this.frameIndex + 1);
    return Math.max(0, ...passed.flatMap((frame) => frame.result.members.map((m) => m.utilization)));
  }

  /** 負担率がいちばん大きかった瞬間に車を止める */
  showHardestMoment(): void {
    const worstOf = (members: MemberResult[]) => Math.max(0, ...members.map((m) => m.utilization));
    let hardest = 0;
    this.outcome.frames.forEach((frame, i) => {
      if (worstOf(frame.result.members) > worstOf(this.outcome.frames[hardest].result.members)) hardest = i;
    });
    this.carX = this.firstX + hardest * this.step;
    this.phase = 'finished';
  }

  /** 画面に描くための、大きくしたたわみ（m）。前後の計算結果のあいだをなめらかにつなぐ */
  drawnDisplacements(): Map<string, { dx: number; dy: number }> {
    const { frames } = this.outcome;
    const drawn = new Map<string, { dx: number; dy: number }>();
    if (frames.length === 0) return drawn;

    const exact = (this.carX - this.firstX) / this.step;
    const before = Math.max(0, Math.min(frames.length - 1, Math.floor(exact)));
    const after = Math.min(frames.length - 1, before + 1);
    const t = Math.max(0, Math.min(1, exact - before));
    // 橋に乗る前とおりたあとは、たわみを少しずつ 0 にもどす
    const lastX = this.firstX + (frames.length - 1) * this.step;
    const outside = Math.max(this.firstX - this.carX, this.carX - lastX, 0);
    const fade = Math.max(0, 1 - outside / 3);

    for (const [id, a] of frames[before].result.displacements) {
      const b = frames[after].result.displacements.get(id) ?? a;
      const scale = this.deflectionScale * fade;
      drawn.set(id, { dx: (a.dx + (b.dx - a.dx) * t) * scale, dy: (a.dy + (b.dy - a.dy) * t) * scale });
    }
    return drawn;
  }
}

function chooseDeflectionScale(outcome: CrossingOutcome): number {
  const largest = Math.max(
    0,
    ...outcome.frames.flatMap((frame) => [...frame.result.displacements.values()].map((d) => Math.hypot(d.dx, d.dy))),
  );
  if (largest === 0) return 1;
  return NICE_SCALES.find((scale) => scale <= MAX_DEFLECTION_SCALE && largest * scale <= MAX_DRAWN_DEFLECTION) ?? 1;
}
