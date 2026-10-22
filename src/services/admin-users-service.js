import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabaseClient } from './supabase-client.js';
import { AdminAccessError, AdminNotFoundError, ADMIN_PAGE_SIZE } from './admin-service.js';
import { isUuid } from '../utils/validation.js';

// All user administration goes through the `admin-users` Edge Function; the browser holds no privileged key.
// The function validates the bearer token and the caller's current admin role on every call.
export const USER_DISPLAY_NAME_MAX = 100;
export const USER_EMAIL_MAX = 254;

export class AdminUserError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'AdminUserError';
    this.code = code;
    this.details = details ?? {};
  }
}

async function call(action, payload = {}, signal) {
  const { data, error } = await supabaseClient.functions.invoke('admin-users', {
    body: { action, ...payload },
    ...(signal ? { signal } : {}),
  });
  if (!error) return data;

  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null);
    const info = body?.error ?? {};
    const status = error.context.status;
    if (status === 401 || status === 403) throw new AdminAccessError();
    if (status === 404) throw new AdminNotFoundError('User');
    const { code, message, ...details } = info;
    throw new AdminUserError(message || 'The request failed. Please try again.', { code, details });
  }
  throw new AdminUserError('Could not reach the server. Check your connection and try again.');
}

const mapUser = (row) => ({
  id: row.id,
  email: row.email ?? '',
  displayName: row.display_name ?? '',
  role: row.role,
  emailConfirmed: row.email_confirmed,
  banned: row.banned,
  createdAt: row.created_at,
  lastSignInAt: row.last_sign_in_at,
});

export async function listAdminUsers({ page = 1, signal } = {}) {
  const data = await call('list', { page: Math.max(1, page), per_page: ADMIN_PAGE_SIZE }, signal);
  return { rows: data.users.map(mapUser), total: Number(data.total) };
}

export async function getAdminUser(id, { signal } = {}) {
  if (!isUuid(id)) throw new AdminNotFoundError('User');
  return mapUser((await call('get', { user_id: id }, signal)).user);
}

// Only display name and email can be edited. A changed email takes effect immediately (no confirmation mail).
export async function updateAdminUser(id, { displayName, email }) {
  if (!isUuid(id)) throw new AdminNotFoundError('User');
  const data = await call('update', { user_id: id, display_name: displayName, email });
  return { user: mapUser(data.user), changed: data.changed };
}

export async function getUserDeletionPreview(id) {
  if (!isUuid(id)) throw new AdminNotFoundError('User');
  const data = await call('deletion_preview', { user_id: id });
  return {
    user: mapUser(data.user),
    counts: data.counts,
    blockers: data.blockers,
    canDelete: data.can_delete,
    confirmationPhrase: data.confirmation_phrase,
  };
}

export async function deleteAdminUser(id, { confirmation, counts }) {
  if (!isUuid(id)) throw new AdminNotFoundError('User');
  return call('delete', {
    user_id: id,
    confirmation,
    expected: {
      owned_projects: counts.owned_projects,
      tasks: counts.tasks,
      attachments: counts.attachments,
    },
  });
}
