import type { CrossingOutcome } from '../engine/crossing';

/** 負担率がこれ以下なら「余裕をもって渡れた」とみなす */
export const SAFE_UTILIZATION = 0.7;

/**
 * 負担率を画面に出す % にする。
 * 四捨五入だと 70.2% が「70%」と表示されるのに星がもらえず、生徒が混乱する。
 * 切り上げにして、表示が 70% 以下なら星の条件を満たし、100% 以下ならこわれない、とそろえる。
 */
export function utilizationPercent(utilization: number): number {
  // 0.7 * 100 が 70.00000000000001 になるような計算の誤差は切り上げない
  return Math.ceil(utilization * 100 - 1e-9);
}

/** 星の条件を短く書いたもの（rateAttempt と同じ順番）。試験の前から画面に出しておく */
export const STAR_GOALS = ['車がわたり切る', '予算の中で作る', `負担率 ${utilizationPercent(SAFE_UTILIZATION)}% 以下`];

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
      label: `負担率 ${utilizationPercent(SAFE_UTILIZATION)}% 以下で、余裕をもってわたれた`,
      achieved: crossed && outcome.maxUtilization <= SAFE_UTILIZATION,
    },
  ];
}

export function countStars(checks: StarCheck[]): number {
  return checks.filter((check) => check.achieved).length;
}

/**
 * ★3 を名人ライン以下の金額で取れたか。
 * 削るほど安くなるが、削りすぎるとこわれたり★3 の余裕がなくなったりする。その駆け引きのごほうび
 */
export function isMasterBuild(stars: number, cost: number, masterCost: number | undefined): boolean {
  return masterCost !== undefined && stars === 3 && cost <= masterCost;
}

const STARS_KEY = 'kakehashi-lab:best-stars';
const COST_KEY = 'kakehashi-lab:best-cost';

/** ステージごとの最高の星の数と、★3 を取れたいちばん安い金額（最安記録）を、この端末に保存する */
export class Progress {
  private bestStars: Record<string, number> = load(STARS_KEY);
  private bestCost: Record<string, number> = load(COST_KEY);

  starsFor(stageId: string): number {
    return this.bestStars[stageId] ?? 0;
  }

  /** ★3 を取れたいちばん安い金額。まだ★3 を取っていなければ undefined */
  bestCostFor(stageId: string): number | undefined {
    return this.bestCost[stageId];
  }

  /** 試験の結果を記録する。★3 の最安記録を更新したら true を返す */
  record(stageId: string, stars: number, cost: number): boolean {
    if (stars > this.starsFor(stageId)) {
      this.bestStars[stageId] = stars;
      save(STARS_KEY, this.bestStars);
    }

    const best = this.bestCostFor(stageId);
    if (stars < 3 || (best !== undefined && cost >= best)) return false;
    this.bestCost[stageId] = cost;
    save(COST_KEY, this.bestCost);
    return true;
  }
}

function load(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    // 保存できない環境（プライベートブラウズなど）でも遊べるようにする
    return {};
  }
}

function save(key: string, value: Record<string, number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存に失敗しても、遊んでいる間は覚えておく
  }
}
