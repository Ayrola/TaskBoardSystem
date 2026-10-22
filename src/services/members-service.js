import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
import { ProjectNotFoundError } from './projects-service.js';

export const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 10;

export class DuplicateMemberError extends Error {
  constructor() {
    super('This user is already on the project.');
    this.name = 'DuplicateMemberError';
  }
}

export class MemberUnavailableError extends Error {
  constructor() {
    super('That user is no longer available.');
    this.name = 'MemberUnavailableError';
  }
}

const withSignal = (query, signal) => (signal ? query.abortSignal(signal) : query);

// The directory RPCs answer "Project not found" (P0002) to non-owners, so the UI cannot probe foreign projects.
function mapDirectoryError(error, fallback) {
  if (error?.code === 'P0002') return new ProjectNotFoundError();
  return new Error(fallback);
}

// Owner first, then members in the order they were added. Server-side this is owner-only.
export async function listMembers(projectId, { signal } = {}) {
  if (!isUuid(projectId)) throw new ProjectNotFoundError();

  const { data, error } = await withSignal(supabaseClient.rpc('list_project_members', { p_project_id: projectId }), signal);
  if (error) throw mapDirectoryError(error, 'Could not load the project users.');

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    label: row.label,
    isOwner: row.is_owner === true,
    addedAt: row.added_at,
  }));
}

// Bounded, owner-only lookup of registered users (id + display label). Fewer than 2 characters returns nothing.
export async function searchUsers(projectId, query, { signal } = {}) {
  if (!isUuid(projectId)) throw new ProjectNotFoundError();
  const text = String(query ?? '').trim();
  if (text.length < SEARCH_MIN_LENGTH) return [];

  const { data, error } = await withSignal(
    supabaseClient.rpc('search_users_for_project', { p_project_id: projectId, p_query: text, p_limit: SEARCH_LIMIT }),
    signal,
  );
  if (error) throw mapDirectoryError(error, 'Could not search users.');
  return (data ?? []).map((row) => ({ userId: row.user_id, label: row.label }));
}

export async function addMember(projectId, userId) {
  if (!isUuid(projectId)) throw new ProjectNotFoundError();
  if (!isUuid(userId)) throw new MemberUnavailableError();

  const { error } = await supabaseClient.from('project_members').insert({ project_id: projectId, user_id: userId });
  if (!error) return;
  if (error.code === '23505') throw new DuplicateMemberError();
  if (error.code === '23503') throw new MemberUnavailableError();
  // RLS denial: the caller is not (or no longer) the owner.
  if (error.code === '42501' || error.code === '23514') throw new ProjectNotFoundError();
  throw new Error('Could not add this user. Please try again.');
}

// Resolves false when the membership was already gone (nothing to remove).
export async function removeMember(projectId, userId) {
  if (!isUuid(projectId) || !isUuid(userId)) throw new ProjectNotFoundError();

  const { data, error } = await supabaseClient
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) throw new Error('Could not remove this user. Please try again.');
  return (data?.length ?? 0) > 0;
}
