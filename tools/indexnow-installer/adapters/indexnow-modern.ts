import { createFileRoute } from '@tanstack/react-router';
import { runAdminRoute } from '@/server/admin/execute';

import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';

function run(name: string, context: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(context.request, {
    intervalMs: 300,
    keyPrefix: 'indexnow-ip',
  });
  return limited ?? runAdminRoute(name, context);
}

export const Route = createFileRoute('/api/admin/indexnow')({
  server: {
    handlers: {
      GET: (context) => run('indexnow_get', context),
      PUT: (context) => run('indexnow_update', context),
      POST: (context) => run('indexnow_submit', context),
    },
  },
});
