#!/usr/bin/env node
/**
 * One-click IndexNow installer for ShipAny (TanStack Start) projects.
 *
 *   node install.mjs /path/to/project            install
 *   node install.mjs /path/to/project --force    overwrite existing IndexNow files
 *
 * Adds /admin/indexnow (paste the Bing key, check the key file, submit URLs),
 * serves the key at /{key}.txt, and registers the admin nav entry + English
 * messages. Every file it changes is backed up first to
 * <project>/.indexnow-backup-<timestamp>/.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES_DIR = join(HERE, 'files');
const NAV_ROUTE = 'src/routes/admin/route.tsx';
const NAV_MARKER = "href: '/admin/indexnow'";

const args = process.argv.slice(2);
const force = args.includes('--force');
const uninstall = args.includes('--uninstall');
const target = resolve(args.find((a) => !a.startsWith('--')) || '.');

const log = (msg) => console.log(msg);
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// ---- preflight -------------------------------------------------------------
for (const required of [
  'package.json',
  'src/core/db/index.ts',
  'src/config/db/schema.ts',
  'src/modules/config/service.ts',
  'src/modules/rbac/service.ts',
  'src/hooks/use-user-permissions.ts',
  'src/lib/rate-limit.ts',
  'src/lib/crypto.ts',
  NAV_ROUTE,
  'messages/en.json',
]) {
  if (!existsSync(join(target, required))) {
    fail(
      `${target} doesn't look like a ShipAny TanStack project (missing ${required})`
    );
  }
}

const operationsPath = join(target, 'src/lib/admin-operations.ts');
const handlerRegistry = join(target, 'src/server/admin/handlers.ts');
const modernTarget =
  existsSync(operationsPath) &&
  existsSync(handlerRegistry) &&
  ['indexnow_get', 'indexnow_update', 'indexnow_submit'].every(
    (name) =>
      readFileSync(operationsPath, 'utf8').includes(name) &&
      readFileSync(handlerRegistry, 'utf8').includes(name)
  );
const payload = listFiles(FILES_DIR)
  .map((src) => relative(FILES_DIR, src))
  .filter(
    (rel) => modernTarget || rel !== 'src/server/admin/handlers/indexnow.ts'
  );

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = join(target, `.indexnow-backup-${stamp}`);
const backup = (rel) => {
  const src = join(target, rel);
  if (!existsSync(src)) return;
  const dest = join(backupDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
};

if (uninstall)
  fail(
    'Restore the project backup or use Git to undo this upgrade. File-only uninstallation would leave broken imports in sitemap/admin integrations.'
  );

// ---- install ---------------------------------------------------------------
const clashes = payload.filter((rel) => existsSync(join(target, rel)));
if (clashes.length && !force) {
  fail(
    `Already present (use --force to overwrite):\n  ${clashes.join('\n  ')}`
  );
}

for (const rel of payload) {
  backup(rel);
  mkdirSync(dirname(join(target, rel)), { recursive: true });
  const source =
    modernTarget && rel === 'src/routes/api/admin/indexnow.ts'
      ? join(HERE, 'adapters/indexnow-modern.ts')
      : join(FILES_DIR, rel);
  copyFileSync(source, join(target, rel));
  log(`+ ${rel}`);
}

// Old templates can bake localhost into sitemap URLs while Workers runtime
// vars contain the real domain. Keep generated URLs aligned with submission.
for (const rel of [
  'src/routes/sitemap[.]xml.ts',
  'src/routes/robots[.]txt.ts',
]) {
  const path = join(target, rel);
  if (!existsSync(path)) continue;
  let text = readFileSync(path, 'utf8');
  if (!text.includes('envConfigs.app_url')) continue;
  backup(rel);
  text = text.replaceAll('envConfigs.app_url', 'serverSiteOrigin()');
  if (!text.includes("from '@/lib/site-origin'"))
    text = `import { serverSiteOrigin } from '@/lib/site-origin';\n${text}`;
  if (!text.includes('envConfigs.'))
    text = text.replace(
      /import\s*\{\s*envConfigs\s*\}\s*from\s*['"]@\/config['"];?\s*\n/,
      ''
    );
  writeFileSync(path, text);
  log(`+ ${rel}: use runtime public origin`);
}

// Messages: add our keys, never overwrite the project's own wording.
for (const l of ['en']) {
  const rel = `messages/${l}.json`;
  if (!existsSync(join(target, rel))) {
    log(
      `! ${rel} not found — skipped (add the keys from messages.${l}.json yourself)`
    );
    continue;
  }
  const msgs = JSON.parse(readFileSync(join(target, rel), 'utf8'));
  const ours = JSON.parse(
    readFileSync(join(HERE, `messages.${l}.json`), 'utf8')
  );
  const added = Object.keys(ours).filter((k) => !(k in msgs));
  if (added.length) {
    backup(rel);
    for (const k of added) msgs[k] = ours[k];
    writeFileSync(join(target, rel), `${JSON.stringify(msgs, null, 2)}\n`);
  }
  log(`+ ${rel}: ${added.length} keys added`);
}

// Admin nav: insert an entry right before the Settings item.
const navPath = join(target, NAV_ROUTE);
let nav = readFileSync(navPath, 'utf8');
if (nav.includes(NAV_MARKER)) {
  log(`= ${NAV_ROUTE}: nav entry already present`);
} else {
  const at = nav.indexOf("href: '/admin/settings'");
  const importAt = nav.indexOf("} from 'lucide-react';");
  if (at === -1 || importAt === -1) {
    log(`! Couldn't find the Settings nav item in ${NAV_ROUTE}. Add manually:`);
    log(
      `  { href: '/admin/indexnow', label: m['admin.nav.indexnow'](), icon: Radar },`
    );
  } else {
    backup(NAV_ROUTE);
    const lineStart = nav.lastIndexOf('\n', nav.lastIndexOf('{', at)) + 1;
    const indent = nav.slice(lineStart).match(/^\s*/)[0];
    const inner = `${indent}  `;
    const entry =
      `${indent}{\n` +
      `${inner}href: '/admin/indexnow',\n` +
      `${inner}label: m['admin.nav.indexnow'](),\n` +
      `${inner}icon: Radar,\n` +
      `${indent}},\n`;
    nav = nav.slice(0, lineStart) + entry + nav.slice(lineStart);
    if (
      !/\bRadar\b/.test(nav.slice(0, nav.indexOf("} from 'lucide-react';")))
    ) {
      nav = nav.replace(
        "} from 'lucide-react';",
        "  Radar,\n} from 'lucide-react';"
      );
    }
    writeFileSync(navPath, nav);
    log(`+ ${NAV_ROUTE}: nav entry added`);
  }
}

log(`\n✔ IndexNow installed into ${target}`);
if (existsSync(backupDir))
  log(`  Backup of changed files: ${relative(target, backupDir)}`);
log('\nNext:');
log(
  '  1. pnpm build              (regenerates routeTree + messages, checks types)'
);
log('  2. deploy, then open /admin/indexnow');
log(
  '     Set VITE_APP_URL to the deployed public HTTPS origin (Workers: wrangler.jsonc vars).'
);
log(
  '     Super admins work immediately. Other roles need admin.indexnow.read / write / submit.'
);
log(
  '     If available, pnpm admin:token sync-permissions registers these codes without changing roles.'
);
log('  3. paste the key from https://www.bing.com/indexnow/getstarted → Save');
log('  4. when the key file shows ✔, click "Submit all sitemap URLs"');
