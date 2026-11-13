/*
 * 試験の手ごたえを出す、短い動き。
 * こわれた瞬間に画面をゆらし、★3 のときは紙ふぶきを降らせる。
 * 動きが苦手な人の設定（動きを減らす）になっていたら、どちらもしない。
 */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** 紙ふぶきの枚数と、降っている時間（ミリ秒） */
const CONFETTI_COUNT = 40;
const CONFETTI_DURATION = 1800;
const CONFETTI_COLORS = ['#d98a00', '#1f7a5c', '#3b6fd8', '#d64545', '#f2c94c'];

/** 画面を小さくゆらす。動きは style.css の .shake に書いてある */
export function shake(element: HTMLElement): void {
  if (reducedMotion.matches) return;
  element.classList.remove('shake');
  // クラスを付けなおしても動きが最初から始まるよう、一度レイアウトを計算させる
  void element.offsetWidth;
  element.classList.add('shake');
  element.addEventListener('animationend', () => element.classList.remove('shake'), { once: true });
}

/** 紙ふぶきを、上から降らせる */
export function celebrate(element: HTMLElement): void {
  if (reducedMotion.matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.random() * 400}ms`;
    piece.style.animationDuration = `${1000 + Math.random() * 800}ms`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    layer.append(piece);
  }
  element.append(layer);
  setTimeout(() => layer.remove(), CONFETTI_DURATION + 400);
}
