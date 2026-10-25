import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';

export async function getDashboardStats({ projectId, signal } = {}) {
  if (!isUuid(projectId)) throw new Error('Choose an accessible project.');
  const count = async (table, done) => {
    let query = supabaseClient.from(table).select('id', { count: 'exact', head: true }).eq('project_id', projectId);
    if (done !== undefined) query = query.eq('done', done);
    if (signal) query = query.abortSignal(signal);
    const { count, error } = await query;
    if (error || count === null) throw new Error('Could not load this project dashboard.');
    return Number(count);
  };
  const [openTasks, doneTasks, stageCount] = await Promise.all([count('tasks', false), count('tasks', true), count('project_stages')]);
  return { totalTasks: openTasks + doneTasks, openTasks, doneTasks, stageCount };
}
