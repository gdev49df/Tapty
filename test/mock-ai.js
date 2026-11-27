// Поддельная нейросеть для локальных проверок. Что ответить, решает пятый байт картинки.
import { WorkerEntrypoint } from 'cloudflare:workers';

const GOOD = {
  category: 'hobby',
  title: 'Велосипед горный чёрный',
  description: 'Чёрная рама, заметны царапины. Пишите @prodavec_bot или +7 701 000 00 00, www.example.com',
  condition: 'used',
};

export class MockAI extends WorkerEntrypoint {
  async run(model, input) {
    const [text, image] = input.messages[0].content;
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
