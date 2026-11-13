/** IndexNow submission and public ownership verification (https://www.indexnow.org/documentation). */
import { eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { config } from '@/config/db/schema';
import { decryptSecret } from '@/lib/crypto';
import {
  INDEXNOW_KEY_PATTERN,
  MAX_INDEXNOW_URLS,
  type IndexNowSubmitResult,
} from '@/lib/indexnow';
import { serverSiteOrigin } from '@/lib/site-origin';

export const INDEXNOW_CONFIG_KEY = 'indexnow_key';
export const INDEXNOW_ENDPOINTS = [
  'https://api.indexnow.org/indexnow',
  'https://www.bing.com/indexnow',
  'https://yandex.com/indexnow',
] as const;

export class IndexNowInputError extends Error {}

export function isValidIndexNowKey(key: string) {
  return INDEXNOW_KEY_PATTERN.test(key);
}

// This ownership token is intentionally served at /{key}.txt. It is not an
// account credential. Read it without the settings cache so rotation takes
// effect immediately across server instances.
export async function getIndexNowKey(): Promise<string | null> {
  const [row] = await db()
    .select({ value: config.value })
    .from(config)
    .where(eq(config.name, INDEXNOW_CONFIG_KEY))
    .limit(1);
  // The legacy installer stored this through the generic secret-settings
  // service. Preserve encrypted keys while bypassing its stale config cache.
  const key = row?.value ? (await decryptSecret(row.value))?.trim() : null;
  return key && isValidIndexNowKey(key) ? key : null;
}

export async function saveIndexNowKey(input: string): Promise<void> {
  const key = input.trim();
  if (!isValidIndexNowKey(key))
    throw new IndexNowInputError('Invalid IndexNow key');
  // A single upsert also handles concurrent first saves on every DB provider.
  await db()
    .insert(config)
    .values({ name: INDEXNOW_CONFIG_KEY, value: key })
    .onConflictDoUpdate({ target: config.name, set: { value: key } });
}

export function siteOrigin() {
  return serverSiteOrigin();
}

export function isPublicSite() {
  const url = new URL(siteOrigin());
  const host = url.hostname.toLowerCase();
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.port &&
    host.includes('.') &&
    !/^[\d.]+$/.test(host) &&
    !host.includes(':') &&
    !['.localhost', '.local', '.test', '.invalid', '.internal'].some((suffix) =>
      host.endsWith(suffix)
    )
  );
}

export function keyFileUrl(key: string) {
  if (!isValidIndexNowKey(key))
    throw new IndexNowInputError('Invalid IndexNow key');
  return `${siteOrigin()}/${key}.txt`;
}

const MEANINGS: Record<number, string> = {
  200: 'OK — URLs submitted',
  202: 'Accepted — key validation pending',
  400: 'Bad request — invalid format',
  403: 'Forbidden — key file missing or invalid',
  422: 'URLs do not belong to this host or key',
  429: 'Too many requests — try later',
};

/** Validate the complete request before making any external submission. */
export function normalizeIndexNowUrls(urls: string[]): string[] {
  if (!Array.isArray(urls) || !urls.length || urls.length > MAX_INDEXNOW_URLS) {
    throw new IndexNowInputError(`Supply 1–${MAX_INDEXNOW_URLS} URLs`);
  }
  const host = new URL(siteOrigin()).host;
  const normalized = urls.map((input) => {
    if (typeof input !== 'string' || input.length > 2048) {
      throw new IndexNowInputError('Invalid URL');
    }
    let url: URL;
    try {
      url = new URL(input.trim());
    } catch {
      throw new IndexNowInputError('Invalid URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.host !== host ||
      url.username ||
      url.password
    ) {
      throw new IndexNowInputError(
        `URLs must use HTTP(S) on ${host} without credentials`
      );
    }
    url.hash = '';
    return url.href;
  });
  return [...new Set(normalized)];
}

/** Search engines share submissions; stop after the first accepted response. */
export async function submitUrls(
  key: string,
  urls: string[]
): Promise<IndexNowSubmitResult> {
  if (!isValidIndexNowKey(key))
    throw new IndexNowInputError('Invalid IndexNow key');
  const list = normalizeIndexNowUrls(urls);
  if (!isPublicSite()) {
    throw new IndexNowInputError(
      'Configure a public site URL before submitting to IndexNow'
    );
  }
  const body = JSON.stringify({
    host: new URL(siteOrigin()).host,
    key,
    keyLocation: keyFileUrl(key),
    urlList: list,
  });
  const attempts: IndexNowSubmitResult['results'][number]['attempts'] = [];
  for (const endpoint of INDEXNOW_ENDPOINTS) {
    let status = 0;
    let meaning = 'Network error or request timed out';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': `ShipAny-IndexNow (+${siteOrigin()})`,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      meaning = MEANINGS[status] ?? `Search engine returned HTTP ${status}`;
      await response.body?.cancel();
    } catch {
      // Never return a provider body or error that could echo the key.
    }
    attempts.push({ endpoint: new URL(endpoint).host, status, meaning });
    if ([200, 202, 400, 403, 422].includes(status)) break;
  }
  const last = attempts[attempts.length - 1];
  return {
    submitted: list.length,
    results: [
      {
        ok: last.status === 200 || last.status === 202,
        count: list.length,
        attempts,
      },
    ],
  };
}
