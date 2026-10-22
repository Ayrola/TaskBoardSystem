import { supabaseClient } from './supabase-client.js';

// Accessible projects (defined by RLS) with exact stage and task counts computed in the database.
export async function listProjects({ signal } = {}) {
  let query = supabaseClient.rpc('list_projects_with_counts');
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new Error('Could not load your projects.');

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    createdAt: row.created_at,
    stageCount: Number(row.stage_count),
    openTasks: Number(row.open_tasks),
    doneTasks: Number(row.done_tasks),
  }));
}
