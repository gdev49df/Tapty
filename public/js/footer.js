// Подвал с разделами. Рисуется заново только при смене языка.
import { lang, t } from './i18n.js';
import { $, esc } from './ui.js';

let drawn = null;

function draw() {
  drawn = lang();
  const column = (title, links) =>
    `<nav aria-label="${esc(title)}"><h2>${esc(title)}</h2><ul>${links
      .map(([href, text]) => `<li><a href="${href}">${esc(text)}</a></li>`)
      .join('')}</ul></nav>`;
  $('#footer').innerHTML = `
    <div class="foot">
      <div class="foot-about">
        <a href="/" class="logo" aria-label="tapty."><span>tapty<b>.</b></span></a>
        <p>${esc(t('footerAbout'))}</p>
        <a href="/new" class="btn ghost">${esc(t('postAd'))}</a>
      </div>
      ${column(t('forBuyers'), [['/', t('allAds')], ['/fav', t('fav')], ['/chats', t('messages')]])}
      ${column(t('forSellers'), [['/new', t('postAd')], ['/me', t('myAds')]])}
      ${column(t('help'), [['/rules', t('rules')]])}
      <p class="foot-credit">Разработано gDev</p>
    </div>`;
}

export const footer = {
  update(show) {
    if (drawn !== lang()) draw();
    $('#footer').hidden = !show;
    document.body.classList.toggle('has-footer', show);
  },
};
