import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
export const ACTIVITY_PAGE_SIZE = 20;
export async function listTaskActivity({ projectId = null, taskId = null, page = 1, snapshot = null, signal } = {}) {
  if ((projectId && !isUuid(projectId)) || (taskId && !isUuid(taskId))) throw new Error('Enter valid project and task references.');
  if (snapshot && (!/^\d{1,19}$/.test(snapshot) || BigInt(snapshot) > 9223372036854775807n)) throw new Error('Invalid activity page.');
  let query = supabaseClient.rpc('task_activity_page', {
    p_snapshot_id: snapshot,
    p_project_id: projectId || null, p_task_id: taskId || null,
    p_limit: ACTIVITY_PAGE_SIZE, p_offset: (Math.max(1, Math.floor(page) || 1) - 1) * ACTIVITY_PAGE_SIZE,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load task activity. Please try again.');
  return { rows: data.rows, total: Number(data.total), snapshot: data.snapshot_id };
}
export async function listActivityProjects({ signal } = {}) {
  const projects = [];
  for (let offset = 0; ; offset += 200) {
    let query = supabaseClient.from('projects').select('id,title').order('title').order('id').range(offset,offset+199);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error('Could not load accessible projects.');
    projects.push(...data);
    if (data.length < 200) return projects;
  }
}
