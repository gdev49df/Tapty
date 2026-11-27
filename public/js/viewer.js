// Фото на весь экран: листание, увеличение по нажатию, жесты браузера не отключаются.
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, $$, esc } from './ui.js';

const ZOOM = 2.5;
let current = null;

// Возвращает true, если просмотр был открыт: тогда «назад» только закрывает его.
export function closeViewer() {
  if (!current) return false;
  const close = current;
  current = null;
  close();
  return true;
}

export function openViewer(photos, start, title) {
  closeViewer();
  const opener = document.activeElement;
  const many = photos.length > 1;
  const box = document.createElement('div');
  box.className = 'viewer';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', t('viewer'));
  box.innerHTML = `
    <div class="v-track">${photos
      .map((p, i) => `<div class="v-slide"><img src="${p.startsWith('blob:') ? p : `/p/${p}`}" alt="${esc(title)}, ${i + 1}" draggable="false"></div>`)
      .join('')}</div>
    <button class="round v-close" aria-label="${esc(t('close'))}">${icon('close')}</button>
    ${
      many
        ? `<span class="counter v-counter" aria-live="polite"></span>
           <button class="round v-prev" aria-label="←">${icon('back')}</button><button class="round v-next" aria-label="→">${icon('next')}</button>`
        : ''
    }`;
  document.body.append(box);
  document.documentElement.classList.add('locked');

  const track = $('.v-track', box);
  const slides = $$('.v-slide', box);
  let at = start;
  const count = () => many && ($('.v-counter', box).textContent = `${at + 1} / ${photos.length}`);
  const show = (i, behavior = 'smooth') => {
    unzoom();
    at = (i + photos.length) % photos.length;
    track.scrollTo({ left: at * track.clientWidth, behavior });
    count();
  };

  function unzoom() {
    const slide = $('.v-slide.zoomed', box);
    if (!slide) return;
    slide.classList.remove('zoomed');
    track.classList.remove('still');
    $('img', slide).style.width = '';
    track.scrollLeft = at * track.clientWidth;
  }

  // Увеличиваем так, чтобы точка под пальцем оказалась в середине экрана.
  function zoom(slide, x, y) {
    const img = $('img', slide);
    const rect = img.getBoundingClientRect();
    const [fx, fy] = [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    slide.classList.add('zoomed');
    track.classList.add('still');
    img.style.width = `${Math.round(rect.width * ZOOM)}px`;
    slide.scrollLeft = fx * img.offsetWidth - slide.clientWidth / 2;
    slide.scrollTop = fy * img.offsetHeight - slide.clientHeight / 2;
  }

  // Мышью увеличенное фото двигают перетаскиванием.
  let drag = null;
  let dragged = false;
  track.addEventListener('pointerdown', (e) => {
    dragged = false;
    const slide = e.target.closest('.zoomed');
    if (slide && e.pointerType === 'mouse') drag = { slide, x: e.clientX, y: e.clientY, left: slide.scrollLeft, top: slide.scrollTop };
  });
  const move = (e) => {
    if (!drag) return;
    const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    drag.slide.scrollLeft = drag.left - dx;
    drag.slide.scrollTop = drag.top - dy;
  };
  const release = () => (drag = null);
  addEventListener('pointermove', move);
  addEventListener('pointerup', release);

  track.addEventListener('click', (e) => {
    if (dragged) return;
    const slide = e.target.closest('.v-slide');
    if (!slide) return;
    if (slide.classList.contains('zoomed')) unzoom();
    else zoom(slide, e.clientX, e.clientY);
  });
  track.addEventListener('scroll', () => {
    if (track.classList.contains('still')) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    if (next !== at) {
      at = next;
      count();
    }
  }, { passive: true });

  // Закрываем через историю и только один раз: повторное нажатие увело бы со страницы.
  let leaving = false;
  const leave = () => {
    if (!leaving) history.back();
    leaving = true;
  };

  const onKey = (e) => {
    if (e.key === 'Escape') leave();
    if (many && e.key === 'ArrowLeft') show(at - 1);
    if (many && e.key === 'ArrowRight') show(at + 1);
    if (e.key !== 'Tab') return;
    const buttons = $$('button', box);
    const i = buttons.indexOf(document.activeElement);
    e.preventDefault();
    buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  };
  const onResize = () => show(at, 'instant');
  document.addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  $('.v-close', box).onclick = leave;
  if (many) {
    $('.v-prev', box).onclick = () => show(at - 1);
    $('.v-next', box).onclick = () => show(at + 1);
  }

  current = () => {
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', onResize);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', release);
    box.remove();
    document.documentElement.classList.remove('locked');
    opener?.focus?.({ preventScroll: true });
  };
  // Отдельная запись в истории, чтобы кнопка «назад» на телефоне закрывала просмотр, а не страницу.
  history.pushState(history.state, '');
  show(start, 'instant');
  $('.v-close', box).focus({ preventScroll: true });
}
