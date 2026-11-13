import { createFileRoute } from '@tanstack/react-router';

import { getIndexNowKey, isValidIndexNowKey } from '@/modules/indexnow/service';

// IndexNow key file: /{key}.txt must return exactly the key (UTF-8 text).
// Any other *.txt at the root 404s; static routes (robots.txt, ads.txt, …)
// take precedence over this dynamic one.
export const Route = createFileRoute('/{$key}.txt')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!isValidIndexNowKey(params.key)) {
          return new Response('Not found', { status: 404 });
        }
        const key = await getIndexNowKey();
        if (!key || params.key !== key) {
          return new Response('Not found', { status: 404 });
        }
        return new Response(key, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      },
    },
  },
});
