import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';

export async function listTaskAssignees(taskIds, { signal } = {}) {
  if (!taskIds.length) return [];
  if (taskIds.length > 500 || !taskIds.every(isUuid)) throw new Error('Invalid tasks.');
  let query = supabaseClient.rpc('list_task_assignees', { p_task_ids: taskIds });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load assignees.');
  return data ?? [];
}

export async function searchTaskAssignees(projectId, text, { signal } = {}) {
  if (!isUuid(projectId)) throw new Error('Invalid project.');
  let query = supabaseClient.rpc('search_task_assignees', { p_project_id: projectId, p_query: text });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not search project participants.');
  return data ?? [];
}

export async function setTaskAssignee(taskId, userId, assigned) {
  if (!isUuid(taskId) || !isUuid(userId)) throw new Error('Invalid assignment.');
  const { error } = assigned
    ? await supabaseClient.from('task_assignees').insert({ task_id: taskId, user_id: userId })
    : await supabaseClient.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', userId);
  if (assigned && error?.code === '23505') return;
  if (error?.code === '23514') throw new Error('This user is no longer a project participant.');
  if (error) throw new Error('Could not change the assignment. Please reload and try again.');
}
