// Настройки без кода: соцсети и плашка, тех. работы, стоп-слова, вход по коду.
import { $, $$, esc, toast } from '../ui.js';
import { access, problem, send, sure } from './common.js';

const field = (name, label, value, { max, hint = '', placeholder = '' }) => `
  <label class="field"><span>${label}</span>
    <input class="input" name="${name}" value="${esc(value)}" maxlength="${max}" placeholder="${esc(placeholder)}" autocomplete="off">
    ${hint ? `<small>${hint}</small>` : ''}
  </label>`;

const FIELDS = {
  telegram: 'Ссылка на Telegram не подходит',
  instagram: 'Ссылка на Instagram не подходит',
  stopwords: 'Каждое слово — от 3 до 40 знаков, всего не больше 80',
};

function newSecret() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => alphabet[b & 31]).join('');
}

export default async function settings(ctx) {
  const data = await send('/settings');
  if (!ctx.alive()) return;
  draw(ctx, data);
}

function draw(ctx, { site, stopwords }) {
  const on = site.maintenance;
  ctx.box.innerHTML = `<div class="adm-settings"><div class="adm-col">
    <form class="adm-card${on ? ' alert' : ''}" data-form="down">
      <h2>Тех. работы</h2>
      <p>${on ? '<strong>Включены.</strong> Посетители видят экран с большим логотипом, сайт не работает. Модерация открыта.' : 'Выключены. Когда включите, посетители увидят экран «Тех. работы» с большим логотипом вместо сайта.'}</p>
      ${field('downRu', 'Сообщение на экране', site.downRu, { max: 300, placeholder: 'Обновляем сайт и скоро вернёмся.' })}
      ${field('downKk', 'То же на казахском', site.downKk, { max: 300, placeholder: 'Сайтты жаңартып жатырмыз, көп ұзамай ораламыз.' })}
      <div class="adm-buttons">
        <button type="button" class="btn small ${on ? '' : 'danger'}" data-switch>${on ? 'Выключить и открыть сайт' : 'Включить тех. работы'}</button>
        <button class="btn small ghost">Сохранить сообщение</button>
      </div>
    </form>
    <form class="adm-card" data-form="words">
      <h2>Стоп-слова</h2>
      <label class="field"><span>По одному в строке</span>
        <textarea class="input" name="stopwords" rows="10" spellcheck="false">${esc(stopwords.join('\n'))}</textarea>
        <small>Новое или изменённое объявление с таким словом не публикуется, пока вы не одобрите его в «Объявления» → «Под вопросом». Остальные публикуются сразу. Достаточно начала слова: «наркот» найдёт и «наркотики».</small>
      </label>
      <div class="adm-buttons"><button class="btn small">Сохранить список</button></div>
    </form>
    </div><div class="adm-col">
    <form class="adm-card" data-form="social">
      <h2>Соцсети и плашка сверху</h2>
      ${field('telegram', 'Telegram', site.telegram, { max: 120, placeholder: '@tapty или ссылка t.me' })}
      ${field('instagram', 'Instagram', site.instagram, { max: 120, placeholder: '@tapty или ссылка instagram.com' })}
      ${field('promoRu', 'Текст плашки', site.promoRu, { max: 140, placeholder: 'Следите за нами в наших соцсетях:', hint: 'После текста встанут названия соцсетей, у которых есть ссылка. Пусто — обычный текст.' })}
      ${field('promoKk', 'Текст плашки на казахском', site.promoKk, { max: 140, placeholder: 'Бізді әлеуметтік желілерден бақылаңыз:' })}
      <div class="adm-buttons"><button class="btn small">Сохранить</button></div>
    </form>
    ${
      access.pass
        ? '<div class="adm-card"><h2>Вход по коду</h2><p>Включён: кроме ключа нужен код из приложения.</p></div>'
        : `<div class="adm-card" data-totp><h2>Вход по коду</h2><p><strong>Выключен.</strong> Включите, чтобы одного ключа было мало.</p>
             <div class="adm-buttons"><button type="button" class="btn small" data-setup>Создать секрет</button></div></div>`
    }
  </div></div>`;

  const put = async (button, body, done) => {
    button.disabled = true;
    try {
      const next = await send('/settings', { method: 'PUT', body });
      toast(done);
      if (ctx.alive()) draw(ctx, next);
    } catch (e) {
      button.disabled = false;
      $(`[name="${e.field}"]`, ctx.box)?.focus();
      toast(FIELDS[e.field] || problem(e));
    }
  };
  const values = (form) => Object.fromEntries(new FormData(form));
  $$('form', ctx.box).forEach((form) => {
    form.onsubmit = (e) => {
      e.preventDefault();
      put($('button:not([type])', form), values(form), 'Сохранено');
    };
  });
  const toggle = $('[data-switch]', ctx.box);
  toggle.onclick = () => {
    if (!on && !sure(toggle)) return;
    put(toggle, { ...values(toggle.form), maintenance: !on }, on ? 'Сайт снова открыт' : 'Тех. работы включены');
  };
  // Секрет создаётся в браузере и никуда не отправляется.
  const setup = $('[data-setup]', ctx.box);
  if (setup) {
    setup.onclick = () => {
      const secret = newSecret();
      $('[data-totp]', ctx.box).innerHTML = `<h2>Вход по коду</h2>
        <p>1. В Google Authenticator нажмите «+», «Ввести ключ настройки», имя tapty, тип «по времени» и вставьте секрет.</p>
        <code class="backup-code">${secret.match(/.{4}/g).join(' ')}</code>
        <div class="adm-buttons"><a class="btn small ghost" href="otpauth://totp/tapty:admin?secret=${secret}&amp;issuer=tapty">Открыть в приложении на телефоне</a></div>
        <p>2. В Cloudflare откройте Workers &amp; Pages, tapty, Settings, Variables and Secrets и добавьте секрет <code>ADMIN_TOTP</code> с этим же значением.</p>
        <p class="muted small">Секрет виден только сейчас. Никому его не пересылайте.</p>`;
    };
  }
}
