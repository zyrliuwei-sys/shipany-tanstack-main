import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  englishPathname,
  redirectChineseEdition,
} from '../src/lib/english-only';
import { localizedPath } from '../src/lib/locale-path';
import { resolveAfterAuthUrl, safeInternalPath } from '../src/lib/redirect';
import { m } from '../src/paraglide/messages.js';
import { baseLocale, getLocale, locales } from '../src/paraglide/runtime.js';
import { paraglideMiddleware } from '../src/paraglide/server.js';

test('retired Chinese links redirect permanently within the same origin and preserve queries', () => {
  const response = redirectChineseEdition(
    new Request('https://product.example/zh/pricing?utm_source=existing-link')
  );
  assert.equal(response?.status, 308);
  assert.equal(
    response.headers.get('location'),
    'https://product.example/pricing?utm_source=existing-link'
  );
  assert.equal(
    redirectChineseEdition(
      new Request('https://product.example/zh')
    )?.headers.get('location'),
    'https://product.example/'
  );
  assert.equal(
    redirectChineseEdition(
      new Request('https://product.example/zh/')
    )?.headers.get('location'),
    'https://product.example/'
  );
  assert.equal(
    redirectChineseEdition(
      new Request('https://product.example/zh//foreign.example/path')
    )?.headers.get('location'),
    'https://product.example/foreign.example/path'
  );
  assert.equal(
    redirectChineseEdition(
      new Request('https://product.example/api/admin/config')
    ),
    null
  );
  assert.equal(
    redirectChineseEdition(new Request('https://product.example/zhang')),
    null
  );
});

test('old auth and payment return targets stay English and cannot turn into external redirects', () => {
  assert.equal(
    englishPathname('/zh/\\foreign.example/path'),
    '/foreign.example/path'
  );
  assert.equal(
    resolveAfterAuthUrl({ callbackUrl: '/zh/settings/billing?order=123' }),
    '/settings/billing?order=123'
  );
  assert.equal(safeInternalPath('/zh/sign-in'), null);
  assert.equal(safeInternalPath('//foreign.example/path'), null);
  assert.equal(localizedPath('/settings/billing', 'zh'), '/settings/billing');
});

test('a stale Chinese cookie and Chinese browser preference still render English', async () => {
  assert.deepEqual(locales, ['en']);
  assert.equal(baseLocale, 'en');
  const response = await paraglideMiddleware(
    new Request('https://product.example/pricing', {
      headers: {
        cookie: 'PARAGLIDE_LOCALE=zh',
        'accept-language': 'zh-CN,zh;q=0.9',
      },
    }),
    () => {
      assert.equal(getLocale(), 'en');
      return new Response(m['common.nav.profile']());
    }
  );
  assert.equal(await response.text(), 'Profile');
});
