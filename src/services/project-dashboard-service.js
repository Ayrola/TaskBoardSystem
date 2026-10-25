import { supabaseClient } from './supabase-client.js';
import { ProjectNotFoundError } from './projects-service.js';
import { isUuid } from '../utils/validation.js';
import { validTimezone } from '../utils/deadlines.js';

export async function getProjectDashboard(projectId, { days = 30, timezone = 'UTC', signal } = {}) {
  if (!isUuid(projectId)) throw new ProjectNotFoundError();
  if (![7, 30, 90].includes(days) || !validTimezone(timezone)) throw new Error('Choose a valid dashboard period and timezone.');
  let query = supabaseClient.rpc('project_dashboard', { p_project_id: projectId, p_days: days, p_timezone: timezone });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error?.code === 'P0002' || error?.code === '28000') throw new ProjectNotFoundError();
  if (error || !data) throw new Error('Could not refresh this dashboard. Please try again.');
  return data;
}
