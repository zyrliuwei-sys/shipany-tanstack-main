import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import {
  INDEXNOW_KEY_PATTERN,
  indexNowAccess,
  type IndexNowStatus,
  type IndexNowSubmitResult,
} from '@/lib/indexnow';
import {
  checkIndexNowKeyFile,
  readIndexNowSitemap,
} from '@/lib/indexnow-client';
import { m } from '@/paraglide/messages.js';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { TextField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

const QUERY_KEY = ['admin-indexnow'];

function IndexNowPage() {
  const permissions = useUserPermissions();
  const { canLoad } = indexNowAccess(permissions.data);
  const queryClient = useQueryClient();
  const [urls, setUrls] = useState('');
  const [result, setResult] = useState<IndexNowSubmitResult | null>(null);

  const statusQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<IndexNowStatus>('/api/admin/indexnow'),
    enabled: canLoad,
  });
  const status = statusQuery.data;
  const { canRead, canWrite, canSubmit } = indexNowAccess(
    permissions.data,
    status
  );

  const keyFileQuery = useQuery({
    queryKey: [...QUERY_KEY, 'key-file', status?.key, status?.origin],
    queryFn: () => checkIndexNowKeyFile(status!.key!, status!.origin),
    enabled: canRead && !!status?.key,
  });

  const saveKey = useMutation({
    mutationFn: (key: string) =>
      apiPut<IndexNowStatus>('/api/admin/indexnow', { key }),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      setResult(null);
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, 'key-file'] });
      toast.success(m['admin.indexnow.saved']());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: async (source: 'sitemap' | string[]) =>
      apiPost<IndexNowSubmitResult>('/api/admin/indexnow', {
        urls:
          source === 'sitemap'
            ? await readIndexNowSitemap(status!.origin)
            : source,
      }),
    onSuccess: (data) => {
      setResult(data);
      if (data.results.every((r) => r.ok)) {
        toast.success(m['admin.indexnow.submitted']({ count: data.submitted }));
      } else {
        toast.error(data.results.find((r) => !r.ok)?.attempts.at(-1)?.meaning);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const form = useForm({
    defaultValues: { key: '' },
    validators: {
      onSubmit: z.object({
        key: z
          .string()
          .trim()
          .regex(INDEXNOW_KEY_PATTERN, m['admin.indexnow.key_invalid']()),
      }),
    },
    onSubmit: async ({ value }) => {
      await saveKey.mutateAsync(value.key.trim()).catch(() => {});
    },
  });

  // Prefill the saved key once it loads.
  useEffect(() => {
    if (status?.key && !form.state.values.key) {
      form.setFieldValue('key', status.key);
    }
  }, [status?.key]);

  const keyFile = keyFileQuery.data;

  if (permissions.isPending)
    return <Loader2 className="m-6 size-5 animate-spin" />;
  if (!canLoad)
    return (
      <p role="alert" className="text-muted-foreground p-6">
        {m['admin.indexnow.forbidden']()}
      </p>
    );
  if (statusQuery.isError)
    return (
      <div role="alert" className="space-y-3 p-6">
        <p className="text-destructive">
          {m['admin.indexnow.load_error']()} {statusQuery.error.message}
        </p>
        <Button variant="outline" onClick={() => statusQuery.refetch()}>
          {m['admin.indexnow.recheck']()}
        </Button>
      </div>
    );

  if (statusQuery.isPending)
    return <Loader2 className="m-6 size-5 animate-spin" />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['admin.indexnow.title']()}</h1>
        <p className="text-muted-foreground">
          {m['admin.indexnow.description']()}
        </p>
        {status && (
          <p className="text-muted-foreground mt-2 text-sm">
            {m['admin.indexnow.site_origin']()}: <code>{status.origin}</code>
          </p>
        )}
      </div>

      {status && !status.publicSite && (
        <p className="bg-muted max-w-3xl rounded-lg p-4 text-sm" role="status">
          {m['admin.indexnow.public_site_required']()}
        </p>
      )}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{m['admin.indexnow.step_key']()}</CardTitle>
          <CardDescription>
            {m['admin.indexnow.step_key_desc']()}{' '}
            <a
              className="underline"
              href="https://www.bing.com/indexnow/getstarted"
              target="_blank"
              rel="noopener noreferrer"
            >
              bing.com/indexnow/getstarted
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <div className="flex-1">
              <form.Field name="key">
                {(field) => (
                  <TextField
                    field={field}
                    label={m['admin.indexnow.key_label']()}
                    placeholder="804998589fe84f6f800c71a2e1005e57"
                    autoComplete="off"
                    disabled={!canWrite || statusQuery.isPending}
                  />
                )}
              </form.Field>
            </div>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  type="submit"
                  disabled={!canWrite || isSubmitting || statusQuery.isPending}
                >
                  {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                  {m['admin.indexnow.save']()}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{m['admin.indexnow.step_verify']()}</CardTitle>
          <CardDescription>
            {m['admin.indexnow.step_verify_desc']()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {keyFileQuery.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {m['admin.indexnow.check_error']()} {keyFileQuery.error.message}
            </p>
          ) : statusQuery.isPending || keyFileQuery.isPending ? (
            status && !status.key ? (
              <p className="text-muted-foreground text-sm">
                {m['admin.indexnow.no_key']()}
              </p>
            ) : (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )
          ) : !keyFile || !status?.keyFileUrl ? (
            <p className="text-muted-foreground text-sm">
              {m['admin.indexnow.no_key']()}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {keyFile.ok ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : (
                <XCircle className="text-destructive size-4" />
              )}
              <a
                className="inline-flex items-center gap-1 font-mono break-all underline"
                href={status.keyFileUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {status.keyFileUrl}
                <ExternalLink className="size-3" />
              </a>
              <span
                className={keyFile.ok ? 'text-green-600' : 'text-destructive'}
              >
                {keyFile.ok
                  ? m['admin.indexnow.key_file_ok']()
                  : m['admin.indexnow.key_file_bad']({
                      status: String(keyFile.status),
                    })}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => keyFileQuery.refetch()}
            disabled={!status?.key || keyFileQuery.isFetching}
          >
            {keyFileQuery.isFetching && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {m['admin.indexnow.recheck']()}
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{m['admin.indexnow.step_submit']()}</CardTitle>
          <CardDescription>
            {m['admin.indexnow.step_submit_desc']()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => submit.mutate('sitemap')}
            disabled={
              !canSubmit ||
              !status?.key ||
              !status.publicSite ||
              !keyFile?.ok ||
              submit.isPending
            }
          >
            {submit.isPending && <Loader2 className="size-4 animate-spin" />}
            {m['admin.indexnow.submit_sitemap']()}
          </Button>
          <div className="space-y-2">
            <label htmlFor="indexnow-urls" className="text-sm font-medium">
              {m['admin.indexnow.urls_label']()}
            </label>
            <Textarea
              id="indexnow-urls"
              rows={4}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={m['admin.indexnow.urls_placeholder']()}
              disabled={!canSubmit || submit.isPending}
            />
            <Button
              variant="outline"
              onClick={() =>
                submit.mutate(
                  urls
                    .split(/\s+/)
                    .map((u) => u.trim())
                    .filter(Boolean)
                )
              }
              disabled={
                !canSubmit ||
                !status?.key ||
                !status.publicSite ||
                !keyFile?.ok ||
                !urls.trim() ||
                submit.isPending
              }
            >
              {m['admin.indexnow.submit_urls']()}
            </Button>
          </div>
          {result && (
            <div className="bg-muted space-y-1 rounded-md p-3 text-sm">
              <p className="font-medium">
                {m['admin.indexnow.result_count']({ count: result.submitted })}
              </p>
              {result.results.flatMap((r, i) =>
                r.attempts.map((a, j) => (
                  <p
                    key={`${i}-${j}`}
                    className={
                      a.status === 200 || a.status === 202
                        ? 'text-green-600'
                        : 'text-destructive'
                    }
                  >
                    {a.endpoint} · HTTP {a.status || '—'} · {a.meaning} (
                    {r.count})
                  </p>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/admin/indexnow')({
  component: IndexNowPage,
});
