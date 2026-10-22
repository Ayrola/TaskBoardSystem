import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';

// Thrown when a project does not exist or is not accessible. Both cases look identical on purpose,
// so the UI never reveals whether someone else's project id exists.
export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found.');
    this.name = 'ProjectNotFoundError';
  }
}

function withSignal(query, signal) {
  return signal ? query.abortSignal(signal) : query;
}

const cleanDescription = (value) => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

export async function getProject(id, { signal } = {}) {
  if (!isUuid(id)) throw new ProjectNotFoundError();

  const { data, error } = await withSignal(
    supabaseClient.from('projects').select('id, title, description').eq('id', id).maybeSingle(),
    signal,
  );
  if (error) throw new Error('Could not load this project.');
  if (!data) throw new ProjectNotFoundError();
  return { id: data.id, title: data.title, description: data.description ?? '' };
}

// Uses the atomic RPC: the owner comes from auth.uid() and the default stages are created with it.
export async function createProject({ title, description }) {
  const { data, error } = await supabaseClient.rpc('create_project_with_default_stages', {
    p_title: title.trim(),
    p_description: cleanDescription(description),
  });
  if (error || !data) throw new Error('Could not create the project. Please try again.');
  return data;
}

// Only title and description are sent; ownership cannot be changed from the client.
export async function updateProject(id, { title, description }) {
  if (!isUuid(id)) throw new ProjectNotFoundError();

  const { data, error } = await supabaseClient
    .from('projects')
    .update({ title: title.trim(), description: cleanDescription(description) })
    .eq('id', id)
    .select('id');
  if (error) throw new Error('Could not save your changes. Please try again.');
  if (!data?.length) throw new ProjectNotFoundError();
}

// Stages and tasks are removed by the database (ON DELETE CASCADE).
export async function deleteProject(id) {
  if (!isUuid(id)) throw new ProjectNotFoundError();

  const { data, error } = await supabaseClient.from('projects').delete().eq('id', id).select('id');
  if (error) throw new Error('Could not delete the project. Please try again.');
  if (!data?.length) throw new ProjectNotFoundError();
}

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
