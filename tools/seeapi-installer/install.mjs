#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const owned = ['src/config/seeapi.ts', 'src/core/ai/seeapi.ts'];
const settings = 'src/modules/config/settings.ts';
const specs = 'src/modules/config/settings-test-specs.ts';
const runner = 'src/modules/config/settings-test.ts';
const service = 'src/modules/config/service.ts';
const messages = 'messages/en.json';
const managed = new Set([
  ...owned,
  settings,
  specs,
  runner,
  service,
  messages,
  '.gitignore',
]);
const hash = (text) => createHash('sha256').update(text).digest('hex');
const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => {
  throw new Error(message);
};

function addImport(source, names, from) {
  if (source.includes(`from '${from}'`) || source.includes(`from "${from}"`)) {
    for (const name of names.split(', '))
      if (!new RegExp(`\\b${name}\\b`).test(source))
        fail(`Check the existing import from ${from}.`);
    return source;
  }
  return `import { ${names} } from '${from}';\n${source}`;
}

function insertArrayEntry(source, functionName, entry) {
  const start = source.indexOf(`export function ${functionName}(`);
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) fail(`Unsupported ${functionName} definition.`);
  if (source.slice(start, end).includes(entry)) return source;
  const at = source.indexOf('return [', start);
  if (at < 0 || at > end) fail(`Unsupported ${functionName} array.`);
  const insertAt = at + 'return ['.length;
  return source.slice(0, insertAt) + `\n    ${entry},` + source.slice(insertAt);
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source))
    fail(`Unsupported ${label}; no files were changed.`);
  return source.replace(pattern, replacement);
}

const atomicSave = `  // Keep endpoint/key pairs together on D1 too, and avoid first-save races.
  await atomic((q) =>
    entries.map(([name, value]) =>
      q.insert(config).values({ name, value })
        .onConflictDoUpdate({ target: config.name, set: { value } })
    )
  );

`;

/** Build every edit before touching the target; shared files are never replaced wholesale. */
export function planInstallation(target, { force = false } = {}) {
  target = resolve(target);
  for (const path of [
    'package.json',
    'src/core/db/index.ts',
    'src/core/db/atomic.ts',
    'src/lib/crypto.ts',
    'src/routes/admin/settings.tsx',
    settings,
    specs,
    runner,
    service,
    messages,
  ])
    if (!existsSync(join(target, path)))
      fail(`Incompatible project: missing ${path}.`);
  const changes = new Map();
  const stage = (path, content) => {
    if (!existsSync(join(target, path)) || read(join(target, path)) !== content)
      changes.set(path, content);
  };
  for (const path of owned) {
    const content = read(join(here, 'files', path));
    if (
      existsSync(join(target, path)) &&
      read(join(target, path)) !== content &&
      !force
    )
      fail(
        `${path} already exists with different content. Review it before using --force.`
      );
    stage(path, content);
  }

  let text = addImport(
    read(join(target, settings)),
    'seeApiSettingGroup, seeApiSettings',
    '@/config/seeapi'
  );
  text = insertArrayEntry(text, 'getSettingGroups', 'seeApiSettingGroup');
  text = insertArrayEntry(text, 'getSettings', '...seeApiSettings');
  stage(settings, text);

  text = addImport(
    read(join(target, specs)),
    'seeApiTestSpec',
    '@/config/seeapi'
  );
  if (!/seeapi:\s*seeApiTestSpec/.test(text))
    text = replaceRequired(
      text,
      /(export const testSpecs[^=]*=\s*\{)/,
      '$1\n  seeapi: seeApiTestSpec,',
      'test specs'
    );
  stage(specs, text);

  text = addImport(
    read(join(target, runner)),
    'testSeeApiConnection',
    '@/core/ai/seeapi'
  );
  if (!/case ['"]seeapi['"]:/.test(text))
    text = replaceRequired(
      text,
      /(switch\s*\(group\)\s*\{)/,
      "$1\n      case 'seeapi':\n        return await testSeeApiConnection(configs);",
      'settings test runner'
    );
  stage(runner, text);

  text = addImport(
    read(join(target, service)),
    'normalizeSeeApiConfigs',
    '@/config/seeapi'
  );
  text = addImport(text, 'atomic', '@/core/db/atomic');
  const binding = text.match(/const ENDPOINT_SECRETS[^=]*=\s*\{[\s\S]*?\n\};/);
  if (!binding)
    fail(
      'Missing endpoint-to-secret guard; upgrade the configuration service first.'
    );
  if (!binding[0].includes('seeapi_base_url'))
    text = text.replace(
      binding[0],
      binding[0].replace(
        /=\s*\{/,
        "= {\n  seeapi_base_url: ['seeapi_api_key'],"
      )
    );
  if (!text.includes('configs = normalizeSeeApiConfigs(configs);'))
    text = replaceRequired(
      text,
      /(export async function saveConfigs\(\s*configs:\s*ConfigMap\s*\)\s*\{)/,
      '$1\n  configs = normalizeSeeApiConfigs(configs);',
      'saveConfigs'
    );

  const functionStart = text.indexOf('export async function saveConfigs(');
  const transactionStart = text.indexOf(
    '  await db().transaction(',
    functionStart
  );
  const cache = text.indexOf('  // Invalidate cache', functionStart);
  if (cache < 0) fail('Unsupported configuration cache invalidation.');
  if (transactionStart >= 0 && transactionStart < cache) {
    const legacy = read(join(here, 'patches/legacy-config-save.txt'));
    const existing = text.slice(transactionStart, cache);
    if (
      existing.replace(/\s+/g, ' ').trim() !==
      legacy.replace(/\s+/g, ' ').trim()
    )
      fail(
        'saveConfigs has custom write logic. Apply the documented atomic integration manually.'
      );
    text = text.slice(0, transactionStart) + atomicSave + text.slice(cache);
  } else {
    const body = text.slice(functionStart, cache);
    if (
      !body.includes('await atomic(') ||
      !body.includes('.onConflictDoUpdate(')
    )
      fail('saveConfigs must use atomic upserts; no files were changed.');
  }
  stage(service, text);

  const current = JSON.parse(read(join(target, messages)));
  const additions = JSON.parse(read(join(here, 'messages.en.json')));
  for (const [key, value] of Object.entries(additions))
    if (!Object.hasOwn(current, key)) current[key] = value;
  stage(messages, JSON.stringify(current, null, 2) + '\n');
  const ignorePath = join(target, '.gitignore');
  const ignore = existsSync(ignorePath) ? read(ignorePath) : '';
  if (!ignore.includes('.seeapi-backup-*/'))
    stage('.gitignore', ignore.trimEnd() + '\n.seeapi-backup-*/\n');
  return { target, changes };
}

export function install(target, options = {}) {
  const plan = planInstallation(target, options);
  if (!plan.changes.size || options.dryRun)
    return { changed: [...plan.changes.keys()], backup: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(
    plan.target,
    `.seeapi-backup-${stamp}-${randomUUID().slice(0, 8)}`
  );
  const entries = [];
  mkdirSync(backup, { recursive: true });
  // Snapshot all source files before the first edit, including files that will be created.
  for (const [path, content] of plan.changes) {
    const original = join(plan.target, path);
    const existed = existsSync(original);
    if (existed) {
      mkdirSync(dirname(join(backup, 'files', path)), { recursive: true });
      copyFileSync(original, join(backup, 'files', path));
    }
    entries.push({
      path,
      existed,
      before: existed ? hash(readFileSync(original)) : null,
      after: hash(content),
    });
  }
  const manifest = { version: 1, target: plan.target, entries };
  writeFileSync(
    join(backup, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  try {
    for (const [path, content] of plan.changes) {
      mkdirSync(dirname(join(plan.target, path)), { recursive: true });
      writeFileSync(join(plan.target, path), content);
    }
  } catch (error) {
    for (const entry of entries) {
      if (entry.existed)
        copyFileSync(
          join(backup, 'files', entry.path),
          join(plan.target, entry.path)
        );
      else rmSync(join(plan.target, entry.path), { force: true });
    }
    throw error;
  }
  return { changed: [...plan.changes.keys()], backup };
}

export function restore(target, backup) {
  target = resolve(target);
  backup = resolve(backup);
  const manifest = JSON.parse(read(join(backup, 'manifest.json')));
  if (
    manifest.version !== 1 ||
    manifest.target !== target ||
    !Array.isArray(manifest.entries)
  )
    fail('This backup belongs to another project or has an invalid manifest.');
  // Refuse to overwrite edits made since installation, and validate every backup first.
  for (const entry of manifest.entries) {
    if (isAbsolute(entry.path) || !managed.has(entry.path))
      fail('Invalid backup path.');
    const path = join(target, entry.path);
    if (!existsSync(path) || hash(readFileSync(path)) !== entry.after)
      fail(
        `${entry.path} has changed since installation. Restore it manually from ${backup}.`
      );
    if (
      entry.existed &&
      hash(readFileSync(join(backup, 'files', entry.path))) !== entry.before
    )
      fail(`Backup integrity check failed for ${entry.path}.`);
  }
  for (const entry of manifest.entries) {
    if (entry.existed)
      copyFileSync(join(backup, 'files', entry.path), join(target, entry.path));
    else rmSync(join(target, entry.path), { force: true });
  }
  return manifest.entries.map((entry) => entry.path);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    const target = args[0];
    if (!target || target.startsWith('--'))
      fail(
        'Usage: node install.mjs /path/to/project [--dry-run] [--force] [--restore BACKUP]'
      );
    const restoreAt = args.indexOf('--restore');
    if (restoreAt >= 0) {
      if (!args[restoreAt + 1]) fail('--restore needs the backup directory.');
      console.log(
        JSON.stringify(
          { restored: restore(target, args[restoreAt + 1]) },
          null,
          2
        )
      );
    } else {
      console.log(
        JSON.stringify(
          install(target, {
            force: args.includes('--force'),
            dryRun: args.includes('--dry-run'),
          }),
          null,
          2
        )
      );
      console.log(
        'Open Admin > Settings > AI > SeeAPI after rebuilding/restarting. No credentials were copied.'
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
