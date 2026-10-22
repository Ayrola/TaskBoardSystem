import { supabaseClient } from './supabase-client.js';

// Aggregates are computed in the database over the projects the caller can access.
// "Accessible" is defined by RLS (owned projects today, membership later), so this
// service does not filter by owner itself.
export async function getDashboardStats({ signal } = {}) {
  let query = supabaseClient.rpc('get_dashboard_stats');
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new Error('Could not load your dashboard.');

  const row = Array.isArray(data) ? data[0] : data;
  return {
    projectCount: Number(row?.project_count ?? 0),
    totalTasks: Number(row?.total_tasks ?? 0),
    openTasks: Number(row?.open_tasks ?? 0),
    doneTasks: Number(row?.done_tasks ?? 0),
  };
}
