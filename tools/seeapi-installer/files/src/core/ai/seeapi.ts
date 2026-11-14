import { normalizeSeeApiConfigs } from '@/config/seeapi';

/** Verify credentials without creating a generation or consuming model credits. */
export async function testSeeApiConnection(
  configs: Record<string, string>
): Promise<{ success: boolean; message: string }> {
  let values: Record<string, string>;
  try {
    values = normalizeSeeApiConfigs({
      seeapi_base_url: configs.seeapi_base_url || '',
      seeapi_api_key: configs.seeapi_api_key || '',
    });
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
  const key = values.seeapi_api_key;
  if (!key || key.startsWith('••••••••'))
    return {
      success: false,
      message: 'Enter a complete SeeAPI API Key before testing.',
    };

  try {
    const response = await fetch(`${values.seeapi_base_url}/v1/credits`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    // Provider error bodies can contain credentials or diagnostics. Never echo them.
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = {
        401: 'SeeAPI rejected the API Key. Check that it is complete and active.',
        402: 'SeeAPI reports insufficient credits. Check your account balance.',
        403: 'This SeeAPI key cannot access the credits endpoint. Check its permissions.',
        429: 'SeeAPI rate limit reached. Try again later.',
      };
      return {
        success: false,
        message:
          messages[response.status] ||
          `SeeAPI connection check failed (HTTP ${response.status}).`,
      };
    }
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      ('error' in data && data.error) ||
      ('success' in data && data.success === false)
    ) {
      return {
        success: false,
        message: 'SeeAPI returned an unexpected credits response.',
      };
    }
    return {
      success: true,
      message: 'SeeAPI accepted the API Key. No generation task was created.',
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error &&
        ['TimeoutError', 'AbortError'].includes(error.name)
          ? 'SeeAPI connection timed out. Try again later.'
          : 'Could not verify the SeeAPI connection. Check the service and try again.',
    };
  }
}
