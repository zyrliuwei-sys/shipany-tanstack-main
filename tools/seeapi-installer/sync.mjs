import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
for (const path of ['src/config/seeapi.ts', 'src/core/ai/seeapi.ts']) {
  const target = join(here, 'files', path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, path), target);
}
const messages = JSON.parse(
  readFileSync(join(root, 'messages/en.json'), 'utf8')
);
const additions = Object.fromEntries(
  Object.entries(messages).filter(
    ([key]) =>
      key.includes('.seeapi.') ||
      key.endsWith('.seeapi_base_url') ||
      key.endsWith('.seeapi_api_key')
  )
);
writeFileSync(
  join(here, 'messages.en.json'),
  JSON.stringify(additions, null, 2) + '\n'
);
copyFileSync(join(root, 'LICENSE'), join(here, 'LICENSE'));
console.log(
  'Synced SeeAPI source and English messages. No environment files or credentials included.'
);
