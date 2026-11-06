/** 画面の部品を作ったり探したりする小さな道具 */

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function choiceButton(
  html: string,
  pressed: boolean,
  onClick: () => void,
  className = 'tool',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = html;
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', onClick);
  return button;
}

let toastTimer = 0;

/** 画面の下に、しばらくだけ短いお知らせを出す */
export function showToast(message: string): void {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2500);
}
