import { matchPermission } from '@/core/auth/rbac';

export const INDEXNOW_KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;
export const MAX_INDEXNOW_URLS = 10_000;

export interface IndexNowStatus {
  key: string | null;
  keyFileUrl: string | null;
  origin: string;
  publicSite: boolean;
  permissions?: { read: boolean; write: boolean; submit: boolean };
}

/** Older templates expose isAdmin without individual permission codes. */
export function indexNowAccess(
  user?: { isAdmin: boolean; permissions?: string[] },
  status?: IndexNowStatus
) {
  const codes = user?.permissions;
  const has = (action: 'read' | 'write' | 'submit') =>
    matchPermission(`admin.indexnow.${action}`, codes ?? []);
  return {
    canLoad: codes ? has('read') : user?.isAdmin === true,
    canRead: status?.permissions?.read ?? has('read'),
    canWrite: status?.permissions?.write ?? has('write'),
    canSubmit: status?.permissions?.submit ?? has('submit'),
  };
}

export interface IndexNowSubmitResult {
  submitted: number;
  results: {
    ok: boolean;
    count: number;
    attempts: { endpoint: string; status: number; meaning: string }[];
  }[];
}
