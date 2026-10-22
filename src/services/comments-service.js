import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';

export const COMMENTS_PAGE_SIZE = 20;
export const COMMENT_MAX_LENGTH = 2000;

export class CommentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommentError';
  }
}

const toComment = (row) => ({
  id: row.id,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  authorLabel: row.author_label,
  isMine: row.is_mine,
  canEdit: row.can_edit,
  canDelete: row.can_delete,
});

// Plain text only; the server trims and enforces the same limits.
export function validateCommentBody(body) {
  const text = String(body ?? '').trim();
  if (!text) return 'Write a comment first.';
  if (text.length > COMMENT_MAX_LENGTH) return `Comments can be at most ${COMMENT_MAX_LENGTH} characters.`;
  return null;
}

// One page, newest first. `cursor` is the { createdAt, id } of the last comment already shown; both values are
// passed back exactly as the server returned them.
// Resolves { total, hasMore, comments, nextCursor }.
export async function listComments(taskId, { cursor = null, signal } = {}) {
  if (!isUuid(taskId) || (cursor && !isUuid(cursor.id))) throw new CommentError('This task is no longer available.');
  let query = supabaseClient.rpc('list_task_comments', {
    p_task_id: taskId,
    p_limit: COMMENTS_PAGE_SIZE,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error?.code === 'P0002') throw new CommentError('This task is no longer available.');
  if (error || !data) throw new CommentError('Could not load comments.');

  const comments = data.rows.map(toComment);
  const last = data.rows.at(-1);
  return {
    total: Number(data.total),
    hasMore: Boolean(data.has_more),
    comments,
    nextCursor: data.has_more && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

function mapWriteError(error, fallback) {
  if (error?.code === 'P0002') return new CommentError('This task is no longer available.');
  if (error?.code === '42501') return new CommentError('You no longer have permission to do that.');
  return new CommentError(fallback);
}

export async function addComment(taskId, body) {
  if (!isUuid(taskId)) throw new CommentError('This task is no longer available.');
  const problem = validateCommentBody(body);
  if (problem) throw new CommentError(problem);

  const { error } = await supabaseClient.from('task_comments').insert({ task_id: taskId, body: body.trim() });
  if (error) throw mapWriteError(error, 'Could not post the comment. Please try again.');
}

// A row that is not returned means it was deleted, or access/authorship was lost; the caller reloads.
export async function updateComment(commentId, body) {
  if (!isUuid(commentId)) throw new CommentError('That comment no longer exists.');
  const problem = validateCommentBody(body);
  if (problem) throw new CommentError(problem);

  const { data, error } = await supabaseClient
    .from('task_comments')
    .update({ body: body.trim() })
    .eq('id', commentId)
    .select('id, body, updated_at');
  if (error) throw mapWriteError(error, 'Could not save the comment. Please try again.');
  if (!data?.length) throw new CommentError('That comment can no longer be edited.');
  return { body: data[0].body, updatedAt: data[0].updated_at };
}

export async function deleteComment(commentId) {
  if (!isUuid(commentId)) throw new CommentError('That comment no longer exists.');
  const { data, error } = await supabaseClient.from('task_comments').delete().eq('id', commentId).select('id');
  if (error) throw mapWriteError(error, 'Could not delete the comment. Please try again.');
  if (!data?.length) throw new CommentError('That comment was already removed or you can no longer delete it.');
}
