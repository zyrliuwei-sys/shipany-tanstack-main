#!/usr/bin/env node
// Refresh from an explicitly selected template, regardless of bundle location.
// node sync.mjs /absolute/path/to/shipany-tanstack-main
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] || process.cwd());
const FILES = [
  'src/modules/indexnow/service.ts',
  'src/lib/indexnow.ts',
  'src/lib/indexnow-client.ts',
  'src/lib/site-origin.ts',
  'src/routes/{$key}[.]txt.ts',
  'src/routes/admin/indexnow.tsx',
  'src/server/admin/handlers/indexnow.ts',
];
for (const rel of [
  ...FILES,
  'src/routes/api/admin/indexnow.ts',
  'messages/en.json',
]) {
  if (!existsSync(join(ROOT, rel)))
    throw new Error(
      `Source template is missing ${rel}; pass its project directory to sync.mjs`
    );
}
for (const rel of FILES) {
  const dest = join(HERE, 'files', rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(ROOT, rel), dest);
}
mkdirSync(join(HERE, 'adapters'), { recursive: true });
copyFileSync(
  join(ROOT, 'src/routes/api/admin/indexnow.ts'),
  join(HERE, 'adapters/indexnow-modern.ts')
);
for (const locale of ['en']) {
  const all = JSON.parse(
    readFileSync(join(ROOT, `messages/${locale}.json`), 'utf8')
  );
  const messages = Object.fromEntries(
    Object.entries(all).filter(
      ([key]) =>
        key.startsWith('admin.indexnow.') || key === 'admin.nav.indexnow'
    )
  );
  writeFileSync(
    join(HERE, `messages.${locale}.json`),
    `${JSON.stringify(messages, null, 2)}\n`
  );
}
console.log(`Synced IndexNow bundle from ${ROOT}`);
