import { simulateCrossing, VEHICLES } from '../engine/crossing';
import type { CrossingOutcome } from '../engine/crossing';
import type { BridgeMember, BridgeNode } from '../engine/types';
import { BridgeDesign } from '../game/design';
import { SANDBOX_STAGE } from '../game/stage';
import type { Stage } from '../game/stage';
import { Camera } from './camera';
import { CrossingPlayback } from './playback';
import { drawScene } from './renderer';
import type { Scene } from './renderer';

/*
 * タイトル画面のうしろで流す、お手本の動き。
 * 部材がポンポンと置かれて橋ができ、車がわたって部材の色が変わる、をくり返す。
 * 遊ぶ前に「組む → わたらせる → 色で力を見る」の流れが目でわかるように。
 */

/** 部材を 1 本置く間かく（ミリ秒） */
const PLACE_INTERVAL = 140;
/** 橋ができてから車が走り出すまでと、わたり切ってから最初にもどるまで（ミリ秒） */
const PAUSE_BEFORE_DRIVE = 600;
const PAUSE_AFTER_DRIVE = 1500;
/** 置いた節点がふくらんで、もとの大きさにもどるまでの時間（ミリ秒）と、最初の大きさ */
const POP_DURATION = 220;
const POP_SCALE = 1.9;

/** 低い支点はいらないので、岸の上の 2 つの支点だけにした実験モードの谷 */
const DEMO_STAGE: Stage = {
  ...SANDBOX_STAGE,
  id: 'title-demo',
  anchors: SANDBOX_STAGE.anchors.filter((anchor) => anchor.y === 0),
};

const DEMO_VEHICLE = VEHICLES.find((v) => v.id === 'car')!;

export class TitleDemo {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera = new Camera();
  private readonly design = new BridgeDesign(DEMO_STAGE);
  /** できあがった橋の部材。左から順に置いていく */
  private readonly allMembers: BridgeMember[];
  private readonly allNodes: BridgeNode[];
  private readonly outcome: CrossingOutcome;
  private playback: CrossingPlayback | null = null;
  /** いまの回を始めた時刻と、前の画面の時刻、わたり切った時刻（ミリ秒） */
  private startedAt = 0;
  private lastTime = 0;
  private finishedAt = 0;
  private frame = 0;
  /** 動かさずに、できあがった橋だけを見せているか */
  private still = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.design.loadSample();
    this.allNodes = this.design.nodes;
    this.allMembers = [...this.design.members].sort((a, b) => this.middleX(a) - this.middleX(b));
    this.outcome = simulateCrossing(this.design.toBridge(), DEMO_VEHICLE, { roadY: DEMO_STAGE.roadY });
  }

  /** 動きを最初から流す。動きを減らす設定なら、できあがった橋を止めて見せる */
  start(): void {
    this.stop();
    this.resize();
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.still) {
      this.drawStill();
      return;
    }
    this.restart(performance.now());
    const loop = (now: number) => {
      this.step(now);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  /** 画面の大きさが変わったら、谷が上下の文字やボタンとかさならないように合わせなおす */
  resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { span, depth } = DEMO_STAGE;
    // 上の空にタイトル、下の谷にボタンを置くので、橋のまわりを広めにとる
    this.camera.fit({ minX: -8, maxX: span + 8, minY: -depth, maxY: 13 }, { width, height });
    // 大きさを変えると描いた絵が消えるので、止まった絵はここで描きなおす（動いているときは次の画面で描かれる）
    if (this.still) this.drawStill();
  }

  private drawStill(): void {
    this.startedAt = -Infinity;
    this.showBuilt(this.allMembers.length, 0);
  }

  private restart(now: number): void {
    this.startedAt = now;
    this.playback = null;
  }

  private step(now: number): void {
    const elapsed = now - this.startedAt;
    const buildTime = this.allMembers.length * PLACE_INTERVAL;

    if (elapsed < buildTime + PAUSE_BEFORE_DRIVE) {
      this.showBuilt(Math.min(this.allMembers.length, Math.floor(elapsed / PLACE_INTERVAL) + 1), now);
      return;
    }

    if (!this.playback) {
      this.playback = new CrossingPlayback(this.outcome);
      this.lastTime = now;
    }
    const playback = this.playback;
    if (!playback.finished) {
      // タブを切りかえたあとなどに、一気に進みすぎないようにする
      playback.advance(Math.min(0.1, (now - this.lastTime) / 1000));
      if (playback.finished) this.finishedAt = now;
    }
    this.lastTime = now;
    this.draw({ design: this.design, test: playback.scene(DEMO_VEHICLE) });
    if (playback.finished && now - this.finishedAt > PAUSE_AFTER_DRIVE) this.restart(now);
  }

  /** はじめの count 本だけ置いた橋を描く。いちばん新しい部材の両はしは、ポンとふくらませる */
  private showBuilt(count: number, now: number): void {
    const members = this.allMembers.slice(0, count);
    const used = new Set(members.flatMap((m) => [m.a, m.b]));
    this.design.members = members;
    this.design.nodes = this.allNodes.filter((n) => used.has(n.id) || this.design.isAnchor(n));

    const placedAt = this.startedAt + (count - 1) * PLACE_INTERVAL;
    const left = Math.max(0, 1 - (now - placedAt) / POP_DURATION);
    const newest = members[members.length - 1];
    const poppingNodes = new Map<string, number>();
    if (newest && left > 0) {
      const scale = 1 + (POP_SCALE - 1) * left * left;
      poppingNodes.set(newest.a, scale).set(newest.b, scale);
    }
    this.draw({ design: this.design, poppingNodes });
  }

  private draw(scene: Scene): void {
    drawScene(this.ctx, this.camera, scene);
  }

  private middleX(member: BridgeMember): number {
    const [a, b] = this.design.endsOf(member);
    return (a.x + b.x) / 2;
  }
}
