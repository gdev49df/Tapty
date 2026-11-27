// Настройки для локального запуска без аккаунта Cloudflare: вместо Workers AI подставляется заглушка.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function localConfigs() {
  const source = readFileSync(join(root, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const app = JSON.parse(source);
  delete app.$schema;
  delete app.ai;
  app.main = join(root, app.main);
  app.assets.directory = join(root, app.assets.directory);
  app.services = [{ binding: 'AI', service: 'tapty-mock-ai', entrypoint: 'MockAI' }];
  const mock = { name: 'tapty-mock-ai', main: join(root, 'test/mock-ai.js'), compatibility_date: app.compatibility_date };

  const dir = mkdtempSync(join(tmpdir(), 'tapty-config-'));
  return [app, mock].flatMap((config, i) => {
    const file = join(dir, `${i}.json`);
    writeFileSync(file, JSON.stringify(config));
    return ['-c', file];
  });
}
