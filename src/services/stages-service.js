import { supabaseClient } from './supabase-client.js';
import { notifyProjectsChanged } from './project-events.js';
import { isUuid } from '../utils/validation.js';

export const STAGE_NAME_MAX = 100;

export async function createStage(projectId, { name, isDone = false }) {
  const trimmed = String(name ?? '').trim();
  if (!isUuid(projectId)) throw new Error('Project not found.');
  if (!trimmed || [...trimmed].length > STAGE_NAME_MAX) throw new Error('Enter a stage name of 1–100 characters.');
  const { data, error } = await supabaseClient.rpc('create_project_stage', {
    p_project_id: projectId, p_name: trimmed, p_is_done: isDone === true,
  });
  if (error) {
    if (error.code === '23505') throw new Error('A stage with this name already exists in this project.');
    if (['42501', 'P0002', '28000'].includes(error.code)) throw new Error('Only the project owner or an admin can add stages.');
    throw new Error('Could not add the stage. Please try again.');
  }
  notifyProjectsChanged();
  return data;
}
