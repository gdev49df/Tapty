// Обзор: что ждёт решения, цифры за сегодня и неделю, графики за 30 дней.
import { $, $$, esc } from '../ui.js';
import { isoDay, send } from './common.js';

const TILES = [['users', 'Новые пользователи'], ['listings', 'Объявления'], ['messages', 'Сообщения'], ['shops', 'Заявки на магазины']];
const CHARTS = [['users', 'Новые пользователи'], ['listings', 'Новые объявления'], ['messages', 'Сообщения в чатах']];
const WAITING = [['queue', 'Жалобы'], ['listings', 'Объявления под вопросом'], ['shops', 'Заявки на магазины']];

const HEIGHT = 168;
const LEFT = 32;
const TOP = 8;
const BASE = HEIGHT - 24;

// Верх шкалы: круглое чётное число не меньше самого большого дня.
function ceiling(max) {
  for (let step = 1; ; step *= 10) {
    for (const n of [2, 4, 6, 10]) if (n * step >= max) return n * step;
  }
}

function bars(days, key, width) {
  const top = ceiling(Math.max(...days.map((d) => d[key])));
  const slot = (width - LEFT) / days.length;
  const w = Math.max(2, Math.min(24, slot - 2));
  const y = (v) => BASE - (v / top) * (BASE - TOP);
  const grid = [0, top / 2, top]
    .map((v) => `<line class="grid-line" x1="${LEFT}" x2="${width}" y1="${y(v)}" y2="${y(v)}"/><text x="${LEFT - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`)
    .join('');
  const marks = days
    .map((d, i) => {
      const x = LEFT + i * slot + (slot - w) / 2;
      const h = BASE - y(d[key]);
      const r = Math.min(4, w / 2, h);
      const bar = h
        ? `<path class="bar" d="M${x},${BASE}v${r - h}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}v${h - r}z"/>`
        : '';
      // область наведения во всю высоту: в пустой или низкий столбик тоже легко попасть
      return `<g data-day="${i}">${bar}<rect class="hit" x="${LEFT + i * slot}" y="0" width="${slot}" height="${BASE}"/></g>`;
    })
    .join('');
  const labels = [[0, 'start'], [Math.floor(days.length / 2), 'middle'], [days.length - 1, 'end']]
    .map(([i, anchor]) => {
      const x = anchor === 'start' ? LEFT : anchor === 'end' ? width : LEFT + (i + 0.5) * slot;
      return `<text x="${x}" y="${HEIGHT - 6}" text-anchor="${anchor}">${isoDay(days[i].date)}</text>`;
    })
    .join('');
  return `<svg width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${grid}${marks}${labels}</svg>`;
}

// Один график: наведение или стрелки показывают день в заголовке.
function chart(box, days, key) {
  const plot = $('.adm-plot', box);
  const read = $('output', box);
  const total = days.reduce((sum, d) => sum + d[key], 0);
  let at = -1;
  const show = (i) => {
    at = i;
    $$('g[data-day]', plot).forEach((g, k) => g.classList.toggle('on', k === i));
    read.textContent = i < 0 ? `за 30 дней: ${total}` : `${isoDay(days[i].date)}: ${days[i][key]}`;
  };
  plot.onpointermove = plot.onpointerdown = (e) => {
    const g = e.target.closest('g[data-day]');
    if (g) show(Number(g.dataset.day));
  };
  plot.onpointerleave = () => show(-1);
  plot.onblur = () => show(-1);
  plot.onkeydown = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    show(at < 0 ? days.length - 1 : Math.min(days.length - 1, Math.max(0, at + step)));
  };
  return () => {
    plot.innerHTML = bars(days, key, Math.max(240, plot.clientWidth));
    show(at);
  };
}

export default async function overview(ctx) {
  const [stats, counts] = await Promise.all([send('/stats'), ctx.counts()]);
  if (!ctx.alive()) return;
  const { totals, today, week, days } = stats;
  ctx.box.innerHTML = `
    <section>
      <h2>Ждут решения</h2>
      <div class="adm-waiting">${WAITING.map(
        ([tab, name]) => `<button type="button" data-go="${tab}"${counts[tab] ? ' class="some"' : ''}><b>${counts[tab]}</b><span>${name}</span></button>`
      ).join('')}</div>
    </section>
    <section>
      <h2>Сегодня</h2>
      <dl class="adm-tiles">${TILES.map(
        ([key, name]) => `<div><dt>${name}</dt><dd>${today[key]}</dd><dd class="sub">за 7 дней: ${week[key]}</dd></div>`
      ).join('')}</dl>
      <p class="muted">Всего пользователей: ${totals.users}. Активных объявлений: ${totals.listings}. Открытых магазинов: ${totals.shops}.</p>
    </section>
    <section>
      <h2>За 30 дней</h2>
      <div class="adm-charts">${CHARTS.map(
        ([key, name]) => `<figure data-chart="${key}"><figcaption><h3>${name}</h3><output></output></figcaption>
          <div class="adm-plot" tabindex="0" role="img" aria-label="${esc(name)} по дням. Стрелки влево и вправо показывают значения"></div></figure>`
      ).join('')}</div>
      <details class="adm-numbers"><summary>Таблица по дням</summary>
        <table><thead><tr><th>День</th>${CHARTS.map(([, name]) => `<th>${name}</th>`).join('')}</tr></thead>
        <tbody>${[...days].reverse().map((d) => `<tr><td>${isoDay(d.date)}</td>${CHARTS.map(([key]) => `<td>${d[key]}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </details>
      <p class="muted small">Удалённые аккаунты, объявления и переписки в цифры не входят. Сутки считаются по времени Астаны.</p>
    </section>`;
  $$('[data-go]', ctx.box).forEach((b) => (b.onclick = () => ctx.open(b.dataset.go)));
  const draw = CHARTS.map(([key]) => chart($(`[data-chart="${key}"]`, ctx.box), days, key));
  let width = 0;
  const watcher = new ResizeObserver(() => {
    const now = $('.adm-plot', ctx.box)?.clientWidth;
    if (!now || now === width) return;
    width = now;
    draw.forEach((fn) => fn());
  });
  watcher.observe($('.adm-charts', ctx.box));
  ctx.onLeave(() => watcher.disconnect());
}
