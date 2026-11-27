// Вход и регистрация по логину и паролю.
import { ApiError, api, auth, setSession } from './api.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { $, $$, errorText, esc, sheet, toast } from './ui.js';

const LOGIN = /^[a-z0-9_.]{3,24}$/;

// Пароль не уходит из браузера: на сервер отправляется ключ, посчитанный из пароля и логина.
async function deriveKey(login, password) {
  const encode = (s) => new TextEncoder().encode(s);
  const base = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encode(`tapty:${login}`), iterations: 310000 },
    base,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function authForm(root, { onDone, note = '', mode = 'login' }) {
  // Набранное остаётся при переключении «Вход / Регистрация», в том числе имя, которого нет в форме входа.
  const typed = {};
  const field = (name, label, attrs, hint = '') => {
    const input = `<input class="input" name="${name}" aria-label="${esc(label)}" ${attrs}>`;
    const eye = `<button type="button" class="eye" aria-label="${esc(t('showPassword'))}">${icon('eye')}</button>`;
    return `<label class="field" data-field="${name}"><span>${esc(label)}</span>
      ${name === 'password' ? `<span class="pass">${input}${eye}</span>` : input}${hint ? `<small>${esc(hint)}</small>` : ''}<em></em></label>`;
  };

  const draw = () => {
    const signup = mode === 'register';
    root.innerHTML = `
      <div class="auth">
        ${note ? `<p class="muted">${esc(note)}</p>` : ''}
        <div class="tabs-line" role="tablist">
          ${[['login', 'signIn'], ['register', 'signUp']]
            .map(([id, key]) => `<button type="button" role="tab" data-mode="${id}" aria-selected="${mode === id}">${esc(t(key))}</button>`)
            .join('')}
        </div>
        <form class="form" novalidate>
          ${signup ? field('name', t('fName'), 'maxlength="40" autocomplete="name"') : ''}
          ${field(
            'login', t('fLogin'),
            'maxlength="24" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"',
            signup ? t('loginRule') : ''
          )}
          ${field(
            'password', t('fPassword'),
            `type="password" maxlength="100" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="${signup ? 'new-password' : 'current-password'}"`,
            signup ? t('passwordRule') : ''
          )}
          <p class="form-error" role="alert"></p>
          <button class="btn wide">${esc(t(signup ? 'signUpButton' : 'signInButton'))}</button>
          ${signup ? `<p class="muted small">${esc(t('noRecovery'))}</p>` : ''}
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
    const eye = $('.eye', form);
    // Нажатие на глаз не забирает фокус у поля, поэтому клавиатура на телефоне не закрывается.
    eye.onpointerdown = (e) => e.preventDefault();
    eye.onclick = () => showPassword(form, form.elements.password.type === 'password');
    form.addEventListener('input', (e) => e.target.closest('[data-field]')?.classList.remove('bad'));
    form.onsubmit = submit;
  };

  function showPassword(form, visible) {
    const input = form.elements.password;
    const { selectionStart, selectionEnd } = input;
    input.type = visible ? 'text' : 'password';
    if (document.activeElement === input) input.setSelectionRange(selectionStart, selectionEnd);
    const eye = $('.eye', form);
    eye.innerHTML = icon(visible ? 'eyeOff' : 'eye');
    eye.setAttribute('aria-label', t(visible ? 'hidePassword' : 'showPassword'));
  }

  function showError(name, text) {
    const box = $(`[data-field="${name}"]`, root);
    if (!box) return false;
    box.classList.add('bad');
    $('em', box).textContent = text;
    $('input', box).focus();
    return true;
  }

  async function submit(e) {
    e.preventDefault();
    const form = e.target;
    const signup = mode === 'register';
    const login = form.elements.login.value.trim().toLowerCase();
    const password = form.elements.password.value;
    const name = form.elements.name?.value.trim();
    if (signup && name.length < 2) return showError('name', t('e_name'));
    if (!LOGIN.test(login)) return showError('login', t('loginRule'));
    if (password.length < (signup ? 8 : 1)) return showError('password', t('passwordRule'));

    const button = $('.btn.wide', form);
    const errorBox = $('.form-error', form);
    errorBox.textContent = '';
    showPassword(form, false);
    button.disabled = true;
    try {
      if (!crypto.subtle) throw new ApiError(0, 'insecure');
      const key = await deriveKey(login, password);
      const res = await api(`/auth/${signup ? 'register' : 'login'}`, { method: 'POST', body: { login, key, name } });
      setSession(res);
      toast(t('loggedIn'));
      onDone(res.user);
    } catch (err) {
      button.disabled = false;
      if (err.code === 'login_taken') return showError('login', errorText(err));
      errorBox.textContent = errorText(err);
    }
  }

  draw();
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
