import type { CrossingOutcome } from '../engine/crossing';

/** 負担率がこれ以下なら「余裕をもって渡れた」とみなす */
export const SAFE_UTILIZATION = 0.7;

export interface StarCheck {
  label: string;
  achieved: boolean;
}

/**
 * 星 3 つの評価。
 * 渡り切れなかったときは、ほかの条件を満たしていても星はつかない。
 */
export function rateAttempt(outcome: CrossingOutcome, cost: number, budget: number): StarCheck[] {
  const crossed = outcome.status === 'crossed';
  return [
    { label: '車がわたり切った', achieved: crossed },
    { label: '予算の中で作れた', achieved: crossed && cost <= budget },
    {
      label: `負担率 ${Math.round(SAFE_UTILIZATION * 100)}% 以下で、余裕をもってわたれた`,
      achieved: crossed && outcome.maxUtilization <= SAFE_UTILIZATION,
    },
  ];
}

export function countStars(checks: StarCheck[]): number {
  return checks.filter((check) => check.achieved).length;
}

const STORAGE_KEY = 'kakehashi-lab:best-stars';

/** ステージごとの最高の星の数を、この端末に保存する */
export class Progress {
  private best: Record<string, number> = {};

  constructor() {
    try {
      this.best = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      // 保存できない環境（プライベートブラウズなど）でも遊べるようにする
      this.best = {};
    }
  }

  starsFor(stageId: string): number {
    return this.best[stageId] ?? 0;
  }

  record(stageId: string, stars: number): void {
    if (stars <= this.starsFor(stageId)) return;
    this.best[stageId] = stars;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.best));
    } catch {
      // 保存に失敗しても、遊んでいる間は覚えておく
    }
  }
}
