import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  install,
  planInstallation,
  restore,
} from '../tools/seeapi-installer/install.mjs';

const root = resolve(import.meta.dirname, '..');
const packageDir = join(root, 'tools/seeapi-installer');
const paths = [
  'src/modules/config/settings.ts',
  'src/modules/config/settings-test-specs.ts',
  'src/modules/config/settings-test.ts',
  'src/modules/config/service.ts',
  'messages/en.json',
  '.gitignore',
];
const read = (path) => readFileSync(path, 'utf8');

function fixture() {
  const target = mkdtempSync(join(tmpdir(), 'seeapi-installer-test-'));
  for (const path of [
    'src',
    'messages',
    'package.json',
    'tsconfig.json',
    '.gitignore',
  ])
    cpSync(join(root, path), join(target, path), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(target, 'node_modules'), 'dir');
  const strip = (text, from) =>
    text.replace(
      new RegExp(`^import\\s*\\{[^}]*\\}\\s*from ['"]${from}['"];?\\n`, 'gm'),
      ''
    );
  let text = strip(read(join(target, paths[0])), '@/config/seeapi')
    .replace(/^\s*seeApiSettingGroup,\n/m, '\n')
    .replace(/^\s*\.\.\.seeApiSettings,\n/m, '\n');
  writeFileSync(
    join(target, paths[0]),
    text + '\n// Project-specific provider configuration stays intact.\n'
  );
  text = strip(read(join(target, paths[1])), '@/config/seeapi').replace(
    /^\s*seeapi:\s*seeApiTestSpec,\n/m,
    '\n'
  );
  writeFileSync(join(target, paths[1]), text);
  text = strip(read(join(target, paths[2])), '@/core/ai/seeapi').replace(
    /\s*case ['"]seeapi['"]:\s*return await testSeeApiConnection\(configs\);/,
    ''
  );
  writeFileSync(join(target, paths[2]), text);
  text = strip(
    strip(read(join(target, paths[3])), '@/config/seeapi'),
    '@/core/db/atomic'
  )
    .replace(/^\s*seeapi_base_url:\s*\['seeapi_api_key'\],\n/m, '\n')
    .replace(/^\s*configs = normalizeSeeApiConfigs\(configs\);\n/m, '\n');
  const start = text.indexOf('  // Keep endpoint/key pairs together');
  const end = text.indexOf('  // Invalidate cache', start);
  assert(start >= 0 && end > start);
  text =
    text.slice(0, start) +
    read(join(packageDir, 'patches/legacy-config-save.txt')) +
    text.slice(end);
  writeFileSync(join(target, paths[3]), text);
  const messages = JSON.parse(read(join(target, 'messages/en.json')));
  for (const key of Object.keys(
    JSON.parse(read(join(packageDir, 'messages.en.json')))
  ))
    delete messages[key];
  messages['project.custom'] = 'Keep the target project copy';
  writeFileSync(
    join(target, 'messages/en.json'),
    JSON.stringify(messages, null, 2) + '\n'
  );
  writeFileSync(
    join(target, '.gitignore'),
    read(join(target, '.gitignore')).replace('.seeapi-backup-*/\n', '')
  );
  for (const path of ['src/config/seeapi.ts', 'src/core/ai/seeapi.ts'])
    rmSync(join(target, path));
  return target;
}

test('portable installer backs up a legacy project, preserves its copy, works, repeats safely, and restores exactly', () => {
  const target = fixture();
  try {
    const before = new Map(
      paths.map((path) => [path, read(join(target, path))])
    );
    assert(planInstallation(target).changes.size > 0);
    const linkedInstaller = join(target, 'installer-link');
    symlinkSync(packageDir, linkedInstaller, 'dir');
    const cli = execFileSync(
      process.execPath,
      [join(linkedInstaller, 'install.mjs'), target, '--dry-run'],
      { encoding: 'utf8' }
    );
    assert(
      cli.includes('"changed": ['),
      'the CLI must execute through symlinked paths too'
    );
    assert.equal(install(target, { dryRun: true }).backup, null);
    assert(!readdirSync(target).some((p) => p.startsWith('.seeapi-backup-')));
    for (const [path, content] of before)
      assert.equal(read(join(target, path)), content);
    const result = install(target);
    assert(result.backup);
    for (const [path, content] of before)
      assert.equal(read(join(result.backup, 'files', path)), content);
    assert(
      read(join(target, paths[0])).includes(
        'Project-specific provider configuration stays intact.'
      )
    );
    assert.equal(
      JSON.parse(read(join(target, 'messages/en.json')))['project.custom'],
      'Keep the target project copy'
    );
    assert.deepEqual(install(target), { changed: [], backup: null });
    mkdirSync(join(target, 'tests'));
    cpSync(
      join(root, 'tests/seeapi.test.ts'),
      join(target, 'tests/seeapi.test.ts')
    );
    // Exercise the installed module's encrypted saves, actual batch rollback,
    // concurrent first saves and mocked provider contract in the new project.
    execFileSync(
      process.execPath,
      ['--import', 'tsx', '--test', 'tests/seeapi.test.ts'],
      { cwd: target, stdio: 'pipe' }
    );
    restore(target, result.backup);
    for (const [path, content] of before)
      assert.equal(read(join(target, path)), content);
    assert(!existsSync(join(target, 'src/config/seeapi.ts')));
    assert(!existsSync(join(target, 'src/core/ai/seeapi.ts')));
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('preflight rejects custom save logic without modifying any target files', () => {
  const target = fixture();
  try {
    const path = join(target, 'src/modules/config/service.ts');
    writeFileSync(
      path,
      read(path).replace('if (existing) {', 'if (existing && customRule()) {')
    );
    const before = new Map(
      paths.map((path) => [path, read(join(target, path))])
    );
    assert.throws(() => install(target), /custom write logic/);
    for (const [path, content] of before)
      assert.equal(read(join(target, path)), content);
    assert(!existsSync(join(target, 'src/config/seeapi.ts')));
    assert(!readdirSync(target).some((p) => p.startsWith('.seeapi-backup-')));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('conflicting owned files require force and restore never overwrites later project edits', () => {
  const target = fixture();
  try {
    const owned = join(target, 'src/config/seeapi.ts');
    writeFileSync(owned, '// Existing local integration\n');
    assert.throws(() => install(target), /already exists/);
    const result = install(target, { force: true });
    assert.equal(
      read(join(result.backup, 'files/src/config/seeapi.ts')),
      '// Existing local integration\n'
    );
    const changed = join(target, 'messages/en.json');
    writeFileSync(changed, read(changed) + '\n');
    const before = new Map(
      paths.map((path) => [path, read(join(target, path))])
    );
    assert.throws(
      () => restore(target, result.backup),
      /has changed since installation/
    );
    for (const [path, content] of before)
      assert.equal(read(join(target, path)), content);
    assert(existsSync(join(target, 'src/core/ai/seeapi.ts')));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('packaged source is synchronized and installing on the source project needs no edits', () => {
  for (const path of ['src/config/seeapi.ts', 'src/core/ai/seeapi.ts'])
    assert.equal(read(join(root, path)), read(join(packageDir, 'files', path)));
  assert.equal(planInstallation(root).changes.size, 0);
});
