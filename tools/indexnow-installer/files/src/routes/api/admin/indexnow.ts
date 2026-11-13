// Standalone adapter for templates without the unified IndexNow admin operations.
import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import {
  getIndexNowKey,
  IndexNowInputError,
  isPublicSite,
  isValidIndexNowKey,
  keyFileUrl,
  saveIndexNowKey,
  siteOrigin,
  submitUrls,
} from '@/modules/indexnow/service';
import { hasPermission } from '@/modules/rbac/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

async function status(userId: string) {
  const key = await getIndexNowKey();
  const [read, write, submit] = await Promise.all(
    ['read', 'write', 'submit'].map((action) =>
      hasPermission(userId, `admin.indexnow.${action}`)
    )
  );
  return {
    key,
    keyFileUrl: key ? keyFileUrl(key) : null,
    origin: siteOrigin(),
    publicSite: isPublicSite(),
    permissions: { read, write, submit },
  };
}
async function readJson(request: Request) {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new IndexNowInputError('Content-Type must be application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new IndexNowInputError('JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new IndexNowInputError('Request too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new IndexNowInputError('Invalid JSON');
  }
}
async function handle({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 300,
    keyPrefix: 'indexnow-ip',
  });
  if (limited) return limited;
  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });
    if (
      request.method !== 'GET' &&
      request.headers.get('origin') !== new URL(request.url).origin
    )
      return respErr('Same-origin request required', { status: 403 });
    const userLimited = enforceMinIntervalRateLimit(request, {
      intervalMs: request.method === 'POST' ? 10_000 : 300,
      keyPrefix: 'indexnow-user',
      extraKey: session.user.id,
    });
    if (userLimited) return userLimited;
    const permission =
      request.method === 'GET'
        ? 'admin.indexnow.read'
        : request.method === 'PUT'
          ? 'admin.indexnow.write'
          : 'admin.indexnow.submit';
    if (!(await hasPermission(session.user.id, permission)))
      return respErr('Forbidden', { status: 403 });
    const noStore = { headers: { 'Cache-Control': 'no-store' } };
    if (request.method === 'GET')
      return respData(await status(session.user.id), noStore);
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new IndexNowInputError('Object input required');
    if (request.method === 'PUT') {
      if (typeof body.key !== 'string' || !isValidIndexNowKey(body.key.trim()))
        throw new IndexNowInputError('Invalid IndexNow key');
      await saveIndexNowKey(body.key);
      return respData(await status(session.user.id), noStore);
    }
    const key = await getIndexNowKey();
    if (!key) throw new IndexNowInputError('Save an IndexNow key first');
    return respData(await submitUrls(key, body.urls), noStore);
  } catch (error) {
    return respErr(
      error instanceof IndexNowInputError
        ? error.message
        : 'Unable to process IndexNow request',
      { status: error instanceof IndexNowInputError ? 400 : 500 }
    );
  }
}
export const Route = createFileRoute('/api/admin/indexnow')({
  server: { handlers: { GET: handle, PUT: handle, POST: handle } },
});
