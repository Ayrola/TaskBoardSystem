import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
import { validTimezone } from '../utils/deadlines.js';
export const DEADLINES_PAGE_SIZE = 20;
export async function listDeadlines({ bucket, timezone, projectId, page = 1, countOnly = false, signal }) {
  if (!['overdue', 'today', 'upcoming'].includes(bucket) || !validTimezone(timezone)) throw new Error('Invalid deadline filters.');
  if (!isUuid(projectId)) throw new Error('Invalid project.');
  let query = supabaseClient.rpc('deadlines_page', {
    p_bucket: bucket, p_timezone: timezone, p_project_id: projectId,
    p_limit: countOnly ? 1 : DEADLINES_PAGE_SIZE, p_offset: (Math.max(1, Math.floor(page) || 1) - 1) * DEADLINES_PAGE_SIZE,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load deadlines. Check the timezone and try again.');
  return { ...data, total: Number(data.total) };
}
