import { INDEXNOW_KEY_PATTERN, MAX_INDEXNOW_URLS } from '@/lib/indexnow';

// These resources return XML/plain text, not the JSON API envelope.
async function readText(path: string) {
  const response = await fetch(path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

/** Read via the browser: Workers cannot fetch their own custom domain. */
export async function checkIndexNowKeyFile(key: string, origin?: string) {
  if (!INDEXNOW_KEY_PATTERN.test(key)) throw new Error('Invalid IndexNow key');
  if (
    origin &&
    typeof window !== 'undefined' &&
    new URL(origin).origin !== window.location.origin
  )
    throw new Error(
      `Open ${new URL('/admin/indexnow', origin).href} to verify this site's key file`
    );
  const response = await readText(`/${key}.txt`);
  return {
    ok: response.ok && response.text.trim() === key,
    status: response.status,
  };
}

/** Follow bounded, same-site sitemap indexes; preserve localized URLs and queries. */
export async function readIndexNowSitemap(origin: string): Promise<string[]> {
  const expectedOrigin = new URL(origin).origin;
  if (
    typeof window !== 'undefined' &&
    expectedOrigin !== window.location.origin
  )
    throw new Error(
      `Open ${new URL('/admin/indexnow', origin).href} to submit this site's sitemap`
    );
  const visited = new Set<string>();
  const urls = new Set<string>();

  async function read(path: string, depth: number): Promise<void> {
    if (visited.has(path)) return;
    if (depth > 3 || visited.size >= 20)
      throw new Error('Sitemap index is too large');
    visited.add(path);
    const response = await readText(path);
    if (!response.ok)
      throw new Error(`Sitemap returned HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(
      response.text,
      'application/xml'
    );
    if (doc.getElementsByTagName('parsererror').length)
      throw new Error('Invalid sitemap XML');
    const root = doc.documentElement.localName;
    if (root !== 'sitemapindex' && root !== 'urlset')
      throw new Error('Invalid sitemap XML');
    const locations = [...doc.getElementsByTagNameNS('*', 'loc')]
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    for (const location of locations) {
      const url = new URL(location, expectedOrigin);
      if (url.origin !== expectedOrigin || url.username || url.password) {
        throw new Error('Sitemap URLs must belong to this site');
      }
      if (root === 'sitemapindex') {
        await read(url.pathname + url.search, depth + 1);
      } else {
        urls.add(url.href);
        if (urls.size > MAX_INDEXNOW_URLS)
          throw new Error(`Submit at most ${MAX_INDEXNOW_URLS} URLs at a time`);
      }
    }
  }
  await read('/sitemap.xml', 0);
  return [...urls];
}
