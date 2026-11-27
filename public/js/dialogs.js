// Удаление диалога: общее предупреждение для списка чатов и самой переписки.
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
