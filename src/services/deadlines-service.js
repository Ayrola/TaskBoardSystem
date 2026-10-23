import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
import { validTimezone } from '../utils/deadlines.js';
export const DEADLINES_PAGE_SIZE = 20;
export async function listDeadlines({ bucket, timezone, projectId = null, page = 1, signal }) {
  if (!['overdue', 'today', 'upcoming'].includes(bucket) || !validTimezone(timezone)) throw new Error('Invalid deadline filters.');
  if (projectId && !isUuid(projectId)) throw new Error('Invalid project.');
  let query = supabaseClient.rpc('deadlines_page', {
    p_bucket: bucket, p_timezone: timezone, p_project_id: projectId || null,
    p_limit: DEADLINES_PAGE_SIZE, p_offset: (Math.max(1, Math.floor(page) || 1) - 1) * DEADLINES_PAGE_SIZE,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load deadlines. Check the timezone and try again.');
  return { ...data, total: Number(data.total) };
}
export async function listDeadlineProjects({ signal } = {}) {
  const projects = [];
  for (let offset = 0; ; offset += 200) {
    let query = supabaseClient.from('projects').select('id, title').order('title').order('id').range(offset, offset + 199);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error('Could not load accessible projects.');
    projects.push(...data);
    if (data.length < 200) return projects;
  }
}
