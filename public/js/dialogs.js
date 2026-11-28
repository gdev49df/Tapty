// Предупреждения перед удалением.
import { api } from './api.js';
import { t } from './i18n.js';
import { refreshUnread } from './unread.js';
import { $, errorText, esc, sheet, toast } from './ui.js';

export function askDeleteChat(id, name, onDone) {
  const s = sheet(
    `<p>${esc(t('deleteChatAbout').replace('{name}', () => name))}</p>
     <div class="sheet-actions"><button class="btn ghost" data-close>${esc(t('cancel'))}</button><button class="btn danger" data-yes>${esc(t('deleteChat'))}</button></div>`,
    { title: t('deleteChatAsk') }
  );
  const yes = $('[data-yes]', s.body);
  yes.onclick = async () => {
    yes.disabled = true;
    try {
      await api(`/chats/${id}`, { method: 'DELETE' });
      s.close();
      toast(t('chatDeleted'));
      refreshUnread();
      onDone();
    } catch (e) {
      yes.disabled = false;
      toast(errorText(e));
    }
  };
}

// Объявление удаляют из «Моих объявлений» и со страницы редактирования.
export function askDeleteListing(onYes) {
  const s = sheet(`<p>${esc(t('removeHint'))}</p><button class="btn wide danger">${esc(t('remove'))}</button>`, { title: t('removeAsk') });
  $('button', s.body).onclick = () => {
    s.close();
    onYes();
  };
}

// Свой магазин: открытый удаляют, неоткрытую заявку отзывают.
export function askRemoveShop(open, onYes) {
  const s = sheet(
    `<p>${esc(t(open ? 'shopRemoveHint' : 'shopWithdrawHint'))}</p><button class="btn wide danger">${esc(t(open ? 'shopRemove' : 'shopWithdraw'))}</button>`,
    { title: t(open ? 'shopRemoveAsk' : 'shopWithdrawAsk') }
  );
  $('button.danger', s.body).onclick = () => {
    s.close();
    onYes();
  };
}
