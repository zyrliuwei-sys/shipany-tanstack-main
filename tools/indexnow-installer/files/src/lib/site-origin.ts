import { envConfigs } from '@/config';

/** Server-owned canonical origin; Workers bindings can differ from the build. */
export function serverSiteOrigin(): string {
  const bindings = (globalThis as { __CF_ENV__?: Record<string, unknown> })
    .__CF_ENV__;
  const runtime =
    typeof process !== 'undefined' ? process.env.VITE_APP_URL : undefined;
  const value = bindings?.VITE_APP_URL || runtime || envConfigs.app_url;
  if (typeof value !== 'string')
    throw new Error('Configure VITE_APP_URL with the public website URL');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      'Configure VITE_APP_URL with an HTTP(S) website URL without credentials'
    );
  return url.origin;
}
