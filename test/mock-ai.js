// Поддельная нейросеть для локальных проверок. Что ответить, решает пятый байт картинки.
import { WorkerEntrypoint } from 'cloudflare:workers';

const GOOD = {
  category: 'hobby',
  title: 'Велосипед горный чёрный',
  description: 'Чёрная рама, заметны царапины. Пишите @prodavec_bot или +7 701 000 00 00, www.example.com',
  condition: 'used',
};

const answer = (value) => ({ choices: [{ message: { content: '```json\n' + JSON.stringify(value) + '\n```' } }] });

function search(model, prompt) {
  if (!model.startsWith('@cf/')) throw new Error('неверный запрос к модели');
  const asked = JSON.parse(prompt.slice(prompt.lastIndexOf('Просьба: ') + 'Просьба: '.length));
  if (asked.includes('сломайся')) throw new Error('модель недоступна');
  if (asked.includes('болтай')) return { response: 'Конечно, помогу!' };
  if (asked.includes('погода')) return answer({ words: [] });
  if (asked.includes('на чём ехать')) return answer({ words: ['самокат', 'велосипед'], cat: 'нет такой', city: 'astana', max: 1 });
  if (asked.includes('подешевле')) return answer({ words: [], sort: 'cheap', new: false });
  if (asked.includes('теперь шлем')) return answer({ words: ['шлем'], new: true });
  return { response: 'не JSON' };
}

export class MockAI extends WorkerEntrypoint {
  async run(model, input) {
    const { content } = input.messages[0];
    // строка вместо списка — это помощник поиска: что ответить, решают слова в просьбе
    if (typeof content === 'string') return search(model, content);
    const [text, image] = content;
    if (!model.startsWith('@cf/') || text.type !== 'text' || !image.image_url.url.startsWith('data:image/jpeg;base64,')) {
      throw new Error('неверный запрос к модели');
    }
    const mode = atob(image.image_url.url.split(',')[1]).charCodeAt(4);
    if (mode === 2) return { response: '{"category": null}' };
    if (mode === 3) throw new Error('модель недоступна');
    if (mode === 4) throw new Error('3036: you have used up your daily free allocation of neurons');
    return { choices: [{ message: { content: '```json\n' + JSON.stringify(GOOD) + '\n```' } }] };
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
