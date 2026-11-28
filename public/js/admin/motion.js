// Движение в модерации там, где одними стилями не обойтись. Кто просил меньше движения, его не видит.
import { $$ } from '../ui.js';

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const play = (el, frames, duration = 300, options = {}) =>
  el && !calm() ? el.animate(frames, { duration, easing: 'cubic-bezier(.2, .8, .2, 1)', ...options }) : null;

export const pop = (el) => play(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }], 360);
export const spin = (el) => play(el, [{ transform: 'rotate(0)' }, { transform: 'rotate(1turn)' }], 600);
export const shake = (el) => play(el, [0, -8, 7, -5, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })), 360);

// Цифры набегают от нуля.
export function countUp(elements) {
  if (calm()) return;
  for (const el of elements) {
    const to = Number(el.textContent);
    if (!(to > 0)) continue;
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - start) / 700));
      el.textContent = Math.round(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = 0;
    requestAnimationFrame(step);
  }
}

// строки списка по их ключам
const rows = (box) => new Map($$('[data-key]', box).map((el) => [el.dataset.key, el.closest('li, tr') || el]));
export const snapshot = (box) => new Map([...rows(box)].map(([key, row]) => [key, row.textContent]));

// Перед заменой списка то, чего в новом уже нет, уезжает в сторону.
export async function leaveRows(old, next) {
  const kept = rows(next);
  const gone = [...rows(old)].filter(([key]) => !kept.has(key)).map(([, row]) => row);
  // ушло слишком много: это уже другой список, провожать нечего
  if (!gone.length || gone.length > 50) return;
  const away = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(40px)' }];
  await Promise.allSettled(gone.map((row) => play(row, away, 260, { easing: 'ease-in', fill: 'forwards' })?.finished));
}

// Изменившиеся строки ненадолго подсвечиваются: видно, что именно поменялось.
export function flashRows(before, box) {
  for (const [key, row] of rows(box)) {
    if (!before.has(key) || before.get(key) === row.textContent) continue;
    play(row, [{ backgroundColor: 'rgba(120, 55, 212, .2)' }, { backgroundColor: 'rgba(120, 55, 212, 0)' }], 1200);
  }
}
