import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';

const directory = await mkdtemp(join(tmpdir(), 'seeapi-settings-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-seeapi-test-secret',
  CONFIG_ENCRYPTION_KEY: 'isolated-seeapi-encryption-test-secret',
  NODE_ENV: 'test',
});
execFileSync(
  process.execPath,
  [
    'node_modules/drizzle-kit/bin.cjs',
    'push',
    '--dialect=sqlite',
    '--schema=./src/config/db/schema.sqlite.ts',
    `--url=${process.env.DATABASE_URL}`,
    '--force',
  ],
  { stdio: 'pipe' }
);

const { db } = await import('../src/core/db');
const { config } = await import('../src/config/db/schema');
const {
  saveConfigs,
  getAllConfigs,
  getAdminConfigs,
  filterPublicConfigs,
  assertEndpointSecretsResupplied,
} = await import('../src/modules/config/service');
const { getSettings, getSettingGroups } =
  await import('../src/modules/config/settings');
const { getTestSpec, runTest } =
  await import('../src/modules/config/settings-test');
const { normalizeSeeApiBaseUrl } = await import('../src/config/seeapi');
const key = 'seeapi-isolated-test-key';
after(() => rm(directory, { recursive: true, force: true }));

test('SeeAPI uses the existing AI settings and secret handling without exposing keys publicly', async () => {
  assert.equal(getSettingGroups().find((g) => g.name === 'seeapi')?.tab, 'ai');
  assert.equal(
    getSettings().find((s) => s.name === 'seeapi_api_key')?.type,
    'password'
  );
  assert.deepEqual(getTestSpec('seeapi')?.fields, []);
  await saveConfigs({
    seeapi_base_url: 'https://api.seeapi.com/v1/',
    seeapi_api_key: `  ${key}  `,
  });
  const [row] = await db()
    .select()
    .from(config)
    .where(eq(config.name, 'seeapi_api_key'));
  assert.match(row.value, /^enc:v1:/);
  assert(!row.value.includes(key));
  const admin = await getAdminConfigs();
  assert.match(admin.seeapi_api_key, /^••••••••/);
  assert(!JSON.stringify(admin).includes(key));
  assert.equal(
    (await getAllConfigs()).seeapi_base_url,
    'https://api.seeapi.com'
  );
  assert(
    !(
      'seeapi_api_key' in
      filterPublicConfigs(await getAllConfigs(), ['seeapi_api_key'])
    )
  );
  await saveConfigs({ seeapi_api_key: admin.seeapi_api_key });
  assert.equal((await getAllConfigs()).seeapi_api_key, key);
});

test('concurrent settings saves preserve complete pairs and a failed batch rolls back every field', async () => {
  await Promise.all(
    ['a', 'b'].map((version) =>
      saveConfigs({
        seeapi_api_key: `${key}-${version}`,
        seeapi_test_version: version,
      })
    )
  );
  const saved = await getAllConfigs();
  assert.equal(saved.seeapi_api_key, `${key}-${saved.seeapi_test_version}`);
  // A rejecting trigger forces a real SQLite batch failure after
  // the first statement; no implementation-only mocks of atomic writes.
  await db().run(
    sql.raw(
      `CREATE TRIGGER reject_seeapi_test_config BEFORE INSERT ON config WHEN NEW.name = 'seeapi_test_failure' BEGIN SELECT RAISE(ABORT, 'isolated test failure'); END`
    )
  );
  await assert.rejects(
    saveConfigs({
      seeapi_api_key: `${key}-rollback`,
      seeapi_test_failure: 'fail',
    })
  );
  const [row] = await db()
    .select()
    .from(config)
    .where(eq(config.name, 'seeapi_api_key'));
  const { decryptSecret } = await import('../src/lib/crypto');
  assert.equal(await decryptSecret(row.value), saved.seeapi_api_key);
});

test('invalid destinations and malformed keys fail before saving or sending a request', async () => {
  for (const url of [
    'http://api.seeapi.com',
    'https://api.seeapi.com.evil.example',
    'https://api.seeapi.com@evil.example',
    'https://user:pass@api.seeapi.com',
    'https://api.seeapi.com/other',
    'https://api.seeapi.com?key=x',
    'http://127.0.0.1',
  ]) {
    assert.throws(() => normalizeSeeApiBaseUrl(url));
    await assert.rejects(
      saveConfigs({ seeapi_base_url: url, seeapi_api_key: key })
    );
  }
  await assert.rejects(saveConfigs({ seeapi_api_key: 'key\nother' }));
  assert.throws(
    () =>
      assertEndpointSecretsResupplied(
        { seeapi_base_url: 'https://api.seeapi.com' },
        { seeapi_base_url: 'https://old.example', seeapi_api_key: key }
      ),
    /re-entering seeapi_api_key/
  );
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('fetch must not be called');
  };
  try {
    const invalidConfigs: Record<string, string>[] = [
      {},
      { seeapi_api_key: '••••••••abcd' },
      { seeapi_api_key: key, seeapi_base_url: 'https://evil.example' },
    ];
    for (const configs of invalidConfigs) {
      const result = await runTest('seeapi', {}, configs);
      assert.equal(result.success, false);
      assert(!result.message.includes('fetch must not be called'));
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('connection tests use only authenticated GET /v1/credits and never echo provider data or secrets', async () => {
  const nativeFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    assert.equal(String(input), 'https://api.seeapi.com/v1/credits');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      `Bearer ${key}`
    );
    assert(init?.signal);
    assert.equal(init?.body, undefined);
    return Response.json({ credits: { balance: 10 }, sensitive: key });
  };
  try {
    const result = await runTest(
      'seeapi',
      {},
      { seeapi_api_key: key, seeapi_base_url: 'https://api.seeapi.com/v1/' }
    );
    assert.equal(result.success, true);
    assert.equal(requests, 1);
    assert(!JSON.stringify(result).includes(key));
    for (const status of [401, 402, 403, 429, 500]) {
      globalThis.fetch = async () =>
        Response.json({ error: { message: key } }, { status });
      const failed = await runTest('seeapi', {}, { seeapi_api_key: key });
      assert.equal(failed.success, false);
      assert(!JSON.stringify(failed).includes(key));
    }
    for (const response of [
      new Response('<html>login</html>'),
      Response.json({ success: false, error: key }),
    ]) {
      globalThis.fetch = async () => response;
      assert.equal(
        (await runTest('seeapi', {}, { seeapi_api_key: key })).success,
        false
      );
    }
    globalThis.fetch = async () => {
      throw new Error(key);
    };
    const failed = await runTest('seeapi', {}, { seeapi_api_key: key });
    assert.equal(failed.success, false);
    assert(!JSON.stringify(failed).includes(key));
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
