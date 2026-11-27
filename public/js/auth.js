// Вход, регистрация, восстановление и смена пароля.
import { ApiError, api, auth, setSession } from './api.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, $$, errorText, esc, sheet, toast } from './ui.js';

const LOGIN = /^[a-z0-9_.]{3,24}$/;
const MIN = 8;

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '123123123', '12341234', '87654321', '11223344', 'password', 'password1', 'password123',
  'qwerty12', 'qwerty123', 'qwertyui', 'qwertyuiop', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'qazwsxedc', 'asdfghjk', 'abc12345',
  'iloveyou', 'admin123', 'astana123', 'almaty123', 'kazakhstan', 'qazaqstan', 'йцукенгш', 'пароль123',
]);

// Пароли, которые подбирают первыми. Проверить это может только браузер: сервер пароля не видит.
export function weakPassword(login, password) {
  const p = password.toLowerCase();
  return (
    COMMON.has(p) ||
    /^(.)\1+$/.test(p) ||
    '01234567890123456789'.includes(p) ||
    '98765432109876543210'.includes(p) ||
    (p.startsWith(login) && /^\d{0,4}$/.test(p.slice(login.length)))
  );
}

// Пароль не уходит из браузера: на сервер отправляется ключ, посчитанный из пароля и логина.
async function deriveKey(login, password) {
  if (!crypto.subtle) throw new ApiError(0, 'insecure');
  const encode = (s) => new TextEncoder().encode(s);
  const base = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encode(`tapty:${login}`), iterations: 310000 },
    base,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function field(name, label, attrs, hint = '') {
  const secret = attrs.includes('type="password"');
  const input = `<input class="input" name="${name}" aria-label="${esc(label)}" ${attrs}>`;
  const eye = `<button type="button" class="eye" aria-label="${esc(t('showPassword'))}">${icon('eye')}</button>`;
  return `<label class="field" data-field="${name}"><span>${esc(label)}</span>
    ${secret ? `<span class="pass">${input}${eye}</span>` : input}${hint ? `<small>${esc(hint)}</small>` : ''}<em></em></label>`;
}

const passwordField = (name, label, autocomplete, hint) =>
  field(
    name, label,
    `type="password" maxlength="100" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="${autocomplete}"`,
    hint
  );

function showPassword(eye, visible) {
  const input = eye.previousElementSibling;
  const { selectionStart, selectionEnd } = input;
  input.type = visible ? 'text' : 'password';
  if (document.activeElement === input) input.setSelectionRange(selectionStart, selectionEnd);
  eye.innerHTML = icon(visible ? 'eyeOff' : 'eye');
  eye.setAttribute('aria-label', t(visible ? 'hidePassword' : 'showPassword'));
}

function showError(form, name, text) {
  const box = $(`[data-field="${name}"]`, form);
  if (!box) return false;
  box.classList.add('bad');
  $('em', box).textContent = text;
  $('input', box).focus();
  return true;
}

// Общее поведение форм: «глаз» у паролей, снятие ошибки при вводе, отправка без повторных нажатий.
function bindForm(form, check, send) {
  $$('.eye', form).forEach((eye) => {
    // Нажатие на глаз не забирает фокус у поля, поэтому клавиатура на телефоне не закрывается.
    eye.onpointerdown = (e) => e.preventDefault();
    eye.onclick = () => showPassword(eye, eye.previousElementSibling.type === 'password');
  });
  form.addEventListener('input', (e) => e.target.closest('[data-field]')?.classList.remove('bad'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const bad = check();
    if (bad) return showError(form, ...bad);
    const button = $('.btn.wide', form);
    const errorBox = $('.form-error', form);
    errorBox.textContent = '';
    $$('.eye', form).forEach((eye) => showPassword(eye, false));
    button.disabled = true;
    try {
      await send();
    } catch (err) {
      button.disabled = false;
      const at = { login_taken: 'login', bad_code: 'code', wrong_password: 'password' }[err.code];
      if (!at || !showError(form, at, errorText(err))) errorBox.textContent = errorText(err);
    }
  };
}

// Резервный код показывается один раз.
function codeView(root, code, onDone) {
  root.innerHTML = `
    <div class="auth code-view">
      <h3>${esc(t('codeTitle'))}</h3>
      <p>${esc(t('codeAbout'))}</p>
      <output class="backup-code">${esc(code)}</output>
      <button type="button" class="btn ghost wide" data-copy>${icon('copy')}${esc(t('copyCode'))}</button>
      <button type="button" class="btn wide" data-done>${esc(t('codeSaved'))}</button>
    </div>`;
  $('[data-copy]', root).onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast(t('copied'));
    } catch {
      // без доступа к буферу выделяем код, чтобы скопировать вручную
      getSelection().selectAllChildren($('.backup-code', root));
    }
  };
  $('[data-done]', root).onclick = onDone;
}

export function authForm(root, { onDone, note = '', mode = 'login' }) {
  // Набранное остаётся при переключении между формами, в том числе имя, которого нет в форме входа.
  const typed = {};

  const draw = () => {
    const signup = mode === 'register';
    const recovering = mode === 'recover';
    const button = { login: 'signInButton', register: 'signUpButton', recover: 'recoverButton' }[mode];
    root.innerHTML = `
      <div class="auth">
        ${note ? `<p class="muted">${esc(note)}</p>` : ''}
        ${
          recovering
            ? `<p>${esc(t('recoverAbout'))}</p>`
            : `<div class="tabs-line" role="tablist">${[['login', 'signIn'], ['register', 'signUp']]
                .map(([id, key]) => `<button type="button" role="tab" data-mode="${id}" aria-selected="${mode === id}">${esc(t(key))}</button>`)
                .join('')}</div>`
        }
        <form class="form" novalidate>
          ${signup ? field('name', t('fName'), 'maxlength="40" autocomplete="name"') : ''}
          ${field(
            'login', t('fLogin'),
            'maxlength="24" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"',
            signup ? t('loginRule') : ''
          )}
          ${
            recovering
              ? field('code', t('fCode'), 'maxlength="24" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"')
              : ''
          }
          ${passwordField(
            'password', t(recovering ? 'fNewPassword' : 'fPassword'),
            mode === 'login' ? 'current-password' : 'new-password',
            mode === 'login' ? '' : t('passwordRule')
          )}
          <p class="form-error" role="alert"></p>
          <button class="btn wide">${esc(t(button))}</button>
          ${signup ? `<p class="muted small">${esc(t('codeLater'))}</p>` : ''}
          ${mode === 'login' ? `<button type="button" class="link-btn" data-mode="recover">${esc(t('forgot'))}</button>` : ''}
          ${recovering ? `<button type="button" class="link-btn" data-mode="login">${esc(t('toSignIn'))}</button>` : ''}
        </form>
      </div>`;
    const form = $('form', root);
    for (const [name, value] of Object.entries(typed)) if (form.elements[name]) form.elements[name].value = value;

    $$('[data-mode]', root).forEach((b) => {
      b.onclick = () => {
        if (b.dataset.mode === mode) return;
        mode = b.dataset.mode;
        Object.assign(typed, Object.fromEntries(new FormData(form)));
        draw();
      };
    });

    const value = (name) => form.elements[name]?.value.trim() ?? '';
    bindForm(
      form,
      () => {
        if (signup && value('name').length < 2) return ['name', t('e_name')];
        if (!LOGIN.test(value('login').toLowerCase())) return ['login', t('loginRule')];
        if (recovering && value('code').replace(/[^0-9a-z]/gi, '').length !== 16) return ['code', t('codeRule')];
        const { value: password } = form.elements.password;
        if (password.length < (mode === 'login' ? 1 : MIN)) return ['password', t('passwordRule')];
        if (mode !== 'login' && weakPassword(value('login').toLowerCase(), password)) return ['password', t('passwordWeak')];
        return null;
      },
      async () => {
        const login = value('login').toLowerCase();
        const key = await deriveKey(login, form.elements.password.value);
        const res = await api(`/auth/${mode}`, { method: 'POST', body: { login, key, name: value('name'), code: value('code') } });
        setSession(res);
        if (res.code) return codeView(root, res.code, () => onDone(res.user));
        toast(t('loggedIn'));
        onDone(res.user);
      }
    );
  };

  draw();
}

// Смена пароля из профиля.
export function passwordSheet(user) {
  const s = sheet(
    `<form class="form" novalidate>
      <input type="text" autocomplete="username" value="${esc(user.login)}" hidden>
      ${passwordField('password', t('fOldPassword'), 'current-password')}
      ${passwordField('next', t('fNewPassword'), 'new-password', t('passwordRule'))}
      <p class="form-error" role="alert"></p>
      <button class="btn wide">${esc(t('changePassword'))}</button>
    </form>`,
    { title: t('changePassword') }
  );
  const form = $('form', s.body);
  const { password, next } = form.elements;
  bindForm(
    form,
    () => {
      if (!password.value) return ['password', t('enterPassword')];
      if (next.value.length < MIN) return ['next', t('passwordRule')];
      return weakPassword(user.login, next.value) ? ['next', t('passwordWeak')] : null;
    },
    async () => {
      const [key, newKey] = await Promise.all([deriveKey(user.login, password.value), deriveKey(user.login, next.value)]);
      await api('/auth/password', { method: 'POST', body: { key, newKey } });
      s.close();
      toast(t('passwordChanged'));
    }
  );
}

// Новый резервный код взамен прежнего.
export function codeSheet(user, onDone) {
  const s = sheet(
    `<form class="form" novalidate>
      <p>${esc(t(user.recovery ? 'codeReplace' : 'codeCreate'))}</p>
      <input type="text" autocomplete="username" value="${esc(user.login)}" hidden>
      ${passwordField('password', t('fPassword'), 'current-password')}
      <p class="form-error" role="alert"></p>
      <button class="btn wide">${esc(t('getCode'))}</button>
    </form>`,
    { title: t('codeTitle') }
  );
  const form = $('form', s.body);
  const { password } = form.elements;
  bindForm(
    form,
    () => (password.value ? null : ['password', t('enterPassword')]),
    async () => {
      const key = await deriveKey(user.login, password.value);
      const { code } = await api('/auth/code', { method: 'POST', body: { key } });
      codeView(s.body, code, () => {
        s.close();
        onDone();
      });
      $('h3', s.body).remove(); // заголовок уже есть у шторки
    }
  );
}

// Выполняет действие, при необходимости сначала предложив войти.
export async function withAuth(note, action) {
  if (auth.signedIn()) {
    try {
      return await action();
    } catch (e) {
      if (e.code !== 'login_required') throw e;
    }
  }
  authSheet({ note, onDone: () => Promise.resolve(action()).catch((e) => toast(errorText(e))) });
}

export function authSheet({ onDone, note }) {
  const s = sheet('', { title: t('account') });
  authForm(s.body, {
    note,
    onDone: (user) => {
      s.close();
      onDone?.(user);
    },
  });
}
