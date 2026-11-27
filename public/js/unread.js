// Число непрочитанных сообщений на значке «Чаты».
import { api, auth } from './api.js';

let count = 0;
let timer;

// Вызывается после каждой перерисовки меню: значки в нём появляются заново.
export function paintUnread() {
  for (const badge of document.querySelectorAll('[data-unread]')) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.hidden = !count;
  }
}

export async function refreshUnread() {
  clearTimeout(timer);
  if (!auth.signedIn()) {
    count = 0;
    return paintUnread();
  }
  if (document.visibilityState === 'visible') {
    try {
      ({ count } = await api('/chats/unread'));
      paintUnread();
    } catch {
      // без сети оставляем прежнее число
    }
  }
  clearTimeout(timer);
  timer = setTimeout(refreshUnread, 30000);
}

addEventListener('tapty:auth', refreshUnread);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshUnread());
