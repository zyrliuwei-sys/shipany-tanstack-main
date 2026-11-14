import type { Setting, SettingGroup } from '@/modules/config/settings';
import type { TestSpec } from '@/modules/config/settings-test-specs';

export const SEEAPI_DEFAULT_BASE_URL = 'https://api.seeapi.com';

export const seeApiSettingGroup = {
  name: 'seeapi',
  title: 'SeeAPI',
  description: 'SeeAPI credentials and connection check',
  tab: 'ai',
} satisfies SettingGroup;

export const seeApiSettings = [
  {
    name: 'seeapi_base_url',
    title: 'Base URL',
    type: 'text',
    placeholder: SEEAPI_DEFAULT_BASE_URL,
    defaultValue: SEEAPI_DEFAULT_BASE_URL,
    group: 'seeapi',
    tab: 'ai',
  },
  {
    name: 'seeapi_api_key',
    title: 'API Key',
    type: 'password',
    placeholder: 'Paste your complete SeeAPI key',
    group: 'seeapi',
    tab: 'ai',
  },
] satisfies Setting[];

// Authentication uses the read-only credits endpoint, with no model inputs.
export const seeApiTestSpec = {
  group: 'seeapi',
  fields: [],
} satisfies TestSpec;

/** Return the official API origin, accepting the common /v1 suffix too. */
export function normalizeSeeApiBaseUrl(value = ''): string {
  try {
    const url = new URL(value.trim() || SEEAPI_DEFAULT_BASE_URL);
    if (
      url.origin !== SEEAPI_DEFAULT_BASE_URL ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/v1'].includes(url.pathname.replace(/\/+$/, ''))
    ) {
      throw new Error();
    }
    return SEEAPI_DEFAULT_BASE_URL;
  } catch {
    throw new Error(
      'SeeAPI Base URL must be https://api.seeapi.com (optionally ending in /v1).'
    );
  }
}

/** Normalize only this integration's fields; leave other providers alone. */
export function normalizeSeeApiConfigs(
  values: Record<string, string>
): Record<string, string> {
  const result = { ...values };
  if (Object.hasOwn(values, 'seeapi_base_url')) {
    if (typeof values.seeapi_base_url !== 'string')
      throw new Error('SeeAPI Base URL must be text.');
    result.seeapi_base_url = normalizeSeeApiBaseUrl(values.seeapi_base_url);
  }
  if (Object.hasOwn(values, 'seeapi_api_key')) {
    if (typeof values.seeapi_api_key !== 'string')
      throw new Error('SeeAPI API Key must be text.');
    const key = values.seeapi_api_key.trim();
    if (key.length > 4096 || /\s/.test(key))
      throw new Error(
        'SeeAPI API Key must be a complete key without spaces or line breaks.'
      );
    result.seeapi_api_key = key;
  }
  return result;
}
