import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';

const directory = await mkdtemp(join(tmpdir(), 'shipany-indexnow-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-indexnow-test-secret-not-a-real-credential',
  NODE_ENV: 'test',
  VITE_APP_URL: 'https://indexnow.example.com',
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
  { stdio: 'pipe', env: process.env }
);

const { db } = await import('../src/core/db');
const { config, user } = await import('../src/config/db/schema');
const { envConfigs } = await import('../src/config');
const { indexNowAccess } = await import('../src/lib/indexnow');
const {
  getIndexNowKey,
  saveIndexNowKey,
  submitUrls,
  normalizeIndexNowUrls,
  siteOrigin,
  keyFileUrl,
} = await import('../src/modules/indexnow/service');
const { executeAdmin, findOperation, runAdminRoute } =
  await import('../src/server/admin/execute');
const { getAdminConfigs, getCustomConfigs, saveConfigs, replaceCustomConfigs } =
  await import('../src/modules/config/service');
const { checkSessionOrigin } = await import('../src/server/admin/auth');
const { Route: keyRoute } = await import('../src/routes/{$key}[.]txt');
const keyHandler = (
  keyRoute.options.server!.handlers as {
    GET: (context: { params: { key: string } }) => Promise<Response>;
  }
).GET;

const key = 'test-indexnow-key-12345678';
const origin = 'https://indexnow.example.com';
const actor = { userId: 'indexnow-admin', permissions: ['*'] };
await db().insert(user).values({
  id: actor.userId,
  name: 'Test admin',
  email: 'indexnow-admin@example.test',
});
const call = (
  operation: string,
  input: unknown,
  permissions = actor.permissions,
  idempotencyKey?: string
) =>
  executeAdmin(
    findOperation(operation),
    input,
    { ...actor, permissions },
    idempotencyKey
  );
const resetLimits = () => globalThis.__minIntervalRateLimitStore?.clear();
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('legacy permission summaries can load status without granting write access from isAdmin alone', () => {
  const legacy = { isAdmin: true };
  assert.deepEqual(indexNowAccess(legacy), {
    canLoad: true,
    canRead: false,
    canWrite: false,
    canSubmit: false,
  });
  assert.equal(indexNowAccess({ isAdmin: false }).canLoad, false);
  const status = {
    key,
    keyFileUrl: `${origin}/${key}.txt`,
    origin,
    publicSite: true,
    permissions: { read: true, write: false, submit: true },
  };
  assert.deepEqual(indexNowAccess(legacy, status), {
    canLoad: true,
    canRead: true,
    canWrite: false,
    canSubmit: true,
  });
});

test('concurrent first saves produce one valid key row', async () => {
  assert.equal(await getIndexNowKey(), null);
  await Promise.all([
    saveIndexNowKey(key),
    saveIndexNowKey('another-valid-key-12345678'),
  ]);
  const rows = await db()
    .select()
    .from(config)
    .where(eq(config.name, 'indexnow_key'));
  assert.equal(rows.length, 1);
  assert.ok([key, 'another-valid-key-12345678'].includes(rows[0].value!));
});

test('saving and rotating the key immediately changes the public verification route', async () => {
  resetLimits();
  const response = await call('indexnow_update', { key });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.keyFileUrl, `${origin}/${key}.txt`);
  const file = await keyHandler({ params: { key } });
  assert.equal(file.status, 200);
  assert.equal(await file.text(), key);
  assert.equal(file.headers.get('cache-control'), 'no-store');
  assert.equal(
    (await keyHandler({ params: { key: 'other-key-123' } })).status,
    404
  );
  assert.equal((await keyHandler({ params: { key: '../bad' } })).status, 404);
  await saveIndexNowKey('rotated-valid-key-12345');
  assert.equal((await keyHandler({ params: { key } })).status, 404);
  await saveIndexNowKey(key);
});

test('legacy encrypted keys remain verifiable after upgrading the installer', async () => {
  const { encryptSecret } = await import('../src/lib/crypto');
  const previous = process.env.CONFIG_ENCRYPTION_KEY;
  try {
    process.env.CONFIG_ENCRYPTION_KEY =
      'isolated-indexnow-legacy-encryption-secret';
    const encrypted = await encryptSecret(key);
    assert.notEqual(encrypted, key);
    await db()
      .update(config)
      .set({ value: encrypted })
      .where(eq(config.name, 'indexnow_key'));
    assert.equal(await getIndexNowKey(), key);
    const file = await keyHandler({ params: { key } });
    assert.equal(file.status, 200);
    assert.equal(await file.text(), key);
    delete process.env.CONFIG_ENCRYPTION_KEY;
    assert.equal(
      await getIndexNowKey(),
      null,
      'do not serve ciphertext when the old encryption key is missing'
    );
  } finally {
    if (previous === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = previous;
    await saveIndexNowKey(key);
  }
});

test('IndexNow operations require their own permissions and protect against CSRF', async () => {
  await assert.rejects(
    call('indexnow_get', {}, ['admin.settings.read']),
    /Forbidden/
  );
  await assert.rejects(
    call('indexnow_update', { key }, [
      'admin.indexnow.read',
      'admin.settings.write',
    ]),
    /Forbidden/
  );
  await assert.rejects(
    call('indexnow_submit', { urls: [origin] }, ['admin.indexnow.read']),
    /Forbidden/
  );
  resetLimits();
  assert.equal(
    (await call('indexnow_get', {}, ['admin.indexnow.read'])).status,
    200
  );
  const anonymous = await runAdminRoute('indexnow_get', {
    request: new Request('http://localhost:3000/api/admin/indexnow'),
  });
  assert.equal(anonymous.status, 401);
  assert.throws(
    () =>
      checkSessionOrigin(
        new Request('http://localhost:3000/api/admin/indexnow', {
          method: 'PUT',
          headers: { origin: 'https://other.example.com' },
        }),
        actor
      ),
    /Same-origin/
  );
});

test('general and custom settings cannot bypass IndexNow key permissions', async () => {
  await saveIndexNowKey(key);
  await saveConfigs({ indexnow_key: 'unauthorized-key-12345' });
  assert.equal(await getIndexNowKey(), key);
  assert.equal((await getAdminConfigs()).indexnow_key, undefined);
  assert.ok(
    !(await getCustomConfigs()).some(({ key }) => key === 'indexnow_key')
  );
  await replaceCustomConfigs([]);
  assert.equal(await getIndexNowKey(), key);
  await assert.rejects(
    replaceCustomConfigs([
      { key: 'indexnow_key', value: 'unauthorized-key-12345' },
    ]),
    /Reserved key/
  );
});

test('invalid keys, foreign hosts, unsafe protocols, credentials, and oversized lists are rejected before fetch', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request');
  });
  await assert.rejects(saveIndexNowKey('../bad'), /Invalid/);
  await assert.rejects(call('indexnow_update', { key: 'short' }));
  for (const url of [
    'https://other.example.com/page',
    'ftp://indexnow.example.com/page',
    'https://u:p@indexnow.example.com/page',
    'not-a-url',
  ]) {
    await assert.rejects(submitUrls(key, [url]), /URL/);
  }
  await assert.rejects(submitUrls(key, []), /1–10000/);
  await assert.rejects(submitUrls(key, Array(10001).fill(origin)), /1–10000/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('submission deduplicates URLs, removes fragments, and stops after HTTP 202', async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.host, 'indexnow.example.com');
      assert.equal(body.keyLocation, `${origin}/${key}.txt`);
      assert.deepEqual(body.urlList, [`${origin}/page`]);
      assert.equal(options?.redirect, 'error');
      assert.ok(options?.signal);
      return new Response('', { status: 202 });
    }
  );
  const result = await submitUrls(key, [
    `${origin}/page#top`,
    `${origin}/page`,
  ]);
  assert.equal(result.submitted, 1);
  assert.equal(result.results[0].ok, true);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(normalizeIndexNowUrls([` ${origin}/zh/page `]), [
    `${origin}/zh/page`,
  ]);
});

test('provider retries are bounded and never expose its response body', async (t) => {
  const statuses = [429, 500, 200];
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(key, { status: statuses.shift()! })
  );
  const result = await submitUrls(key, [origin]);
  assert.equal(result.results[0].ok, true);
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.ok(!JSON.stringify(result).includes(key));
});

test('invalid ownership is reported without retrying on other engines', async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(key, { status: 403 })
  );
  const result = await submitUrls(key, [origin]);
  assert.equal(result.results[0].ok, false);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('local origins cannot submit to external search engines', async (t) => {
  const previous = envConfigs.app_url;
  const previousRuntime = process.env.VITE_APP_URL;
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('')
  );
  try {
    envConfigs.app_url = 'http://localhost:3002';
    process.env.VITE_APP_URL = 'http://localhost:3002';
    await assert.rejects(
      submitUrls(key, ['http://localhost:3002/']),
      /public site/
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    envConfigs.app_url = previous;
    process.env.VITE_APP_URL = previousRuntime;
  }
});

test('runtime deployment URL controls the key location and submissions even after a localhost build', async (t) => {
  const previous = envConfigs.app_url;
  const previousBindings = (globalThis as any).__CF_ENV__;
  const publicOrigin = 'https://deployed.example.com';
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.host, 'deployed.example.com');
      assert.equal(body.keyLocation, `${publicOrigin}/${key}.txt`);
      assert.deepEqual(body.urlList, [`${publicOrigin}/page`]);
      return new Response('', { status: 202 });
    }
  );
  try {
    envConfigs.app_url = 'http://localhost:3000';
    (globalThis as any).__CF_ENV__ = { VITE_APP_URL: publicOrigin };
    assert.equal(siteOrigin(), publicOrigin);
    assert.equal(keyFileUrl(key), `${publicOrigin}/${key}.txt`);
    const result = await submitUrls(key, [`${publicOrigin}/page`]);
    assert.equal(result.results[0].ok, true);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    envConfigs.app_url = previous;
    if (previousBindings === undefined) delete (globalThis as any).__CF_ENV__;
    else (globalThis as any).__CF_ENV__ = previousBindings;
  }
});

test('repeated concurrent submissions with an idempotency key send at most once', async (t) => {
  resetLimits();
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 200 })
  );
  const input = { urls: [`${origin}/idempotent`] };
  const responses = await Promise.allSettled([
    call('indexnow_submit', input, ['*'], 'same-indexnow-request'),
    call('indexnow_submit', input, ['*'], 'same-indexnow-request'),
  ]);
  assert.ok(
    responses.some((r) => r.status === 'fulfilled' && r.value.status === 200)
  );
  assert.equal(fetchMock.mock.callCount(), 1);
  const replay = await call(
    'indexnow_submit',
    input,
    ['*'],
    'same-indexnow-request'
  );
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(fetchMock.mock.callCount(), 1);
});
