import { supabaseClient } from './supabase-client.js';
import { getAuthEpoch } from './auth-service.js';
import { isUuid } from '../utils/validation.js';

export const ADMIN_PAGE_SIZE = 10;
export const STAGE_NAME_MAX = 100;

export class AdminAccessError extends Error {
  constructor() {
    super('Admin access is required.');
    this.name = 'AdminAccessError';
  }
}

// Not found and not accessible look identical on purpose.
export class AdminNotFoundError extends Error {
  constructor(what = 'Item') {
    super(`${what} not found.`);
    this.name = 'AdminNotFoundError';
  }
}

// UI hint only: used for navigation and route guarding. Every admin read and write is authorized by the database.
let adminCache = { epoch: -1, value: false };
export async function isAdmin() {
  const epoch = getAuthEpoch();
  if (adminCache.epoch === epoch) return adminCache.value;
  const { data, error } = await supabaseClient.rpc('is_admin');
  const value = !error && data === true;
  if (epoch === getAuthEpoch()) adminCache = { epoch, value };
  return value;
}

function withSignal(query, signal) {
  return signal ? query.abortSignal(signal) : query;
}

function translate(error, what, fallback) {
  if (error?.code === '42501') return new AdminAccessError();
  if (error?.code === 'P0002') return new AdminNotFoundError(what);
  // These messages come from our own database functions and are written to be shown.
  if (['22023', '23514'].includes(error?.code) && error.message) return new Error(error.message);
  return new Error(fallback);
}

const pageRange = (page) => {
  const from = (Math.max(1, page) - 1) * ADMIN_PAGE_SIZE;
  return [from, from + ADMIN_PAGE_SIZE - 1];
};

const mapProject = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description ?? '',
  ownerId: row.owner_id,
  ownerLabel: row.owner_label,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  stageCount: Number(row.stage_count),
  taskCount: Number(row.task_count),
});

export async function listAdminProjects({ page = 1, search = '', signal } = {}) {
  const { data, error } = await withSignal(
    supabaseClient.rpc('admin_list_projects', {
      p_limit: ADMIN_PAGE_SIZE,
      p_offset: (Math.max(1, page) - 1) * ADMIN_PAGE_SIZE,
      p_search: search || null,
    }),
    signal,
  );
  if (error) throw translate(error, 'Project', 'Could not load projects.');
  return { rows: data.map(mapProject), total: Number(data[0]?.total_count ?? 0) };
}

export async function getAdminProject(id, { signal } = {}) {
  if (!isUuid(id)) throw new AdminNotFoundError('Project');
  const { data, error } = await withSignal(
    supabaseClient.rpc('admin_list_projects', { p_limit: 1, p_offset: 0, p_project_id: id }),
    signal,
  );
  if (error) throw translate(error, 'Project', 'Could not load this project.');
  if (!data.length) throw new AdminNotFoundError('Project');
  return mapProject(data[0]);
}

const mapStage = (row) => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  position: row.position,
  isDone: row.is_done,
});

export async function listProjectStages(projectId, { page = 1, signal } = {}) {
  if (!isUuid(projectId)) throw new AdminNotFoundError('Project');
  const [from, to] = pageRange(page);
  const { data, error, count } = await withSignal(
    supabaseClient
      .from('project_stages')
      .select('id, project_id, name, position, is_done', { count: 'exact' })
      .eq('project_id', projectId)
      .order('position')
      .order('id')
      .range(from, to),
    signal,
  );
  if (error) throw new Error('Could not load stages.');
  return { rows: data.map(mapStage), total: count ?? 0 };
}

// Every stage of a project (a handful), for pickers and name lookups.
export async function listAllProjectStages(projectId, { signal } = {}) {
  if (!isUuid(projectId)) throw new AdminNotFoundError('Project');
  const { data, error } = await withSignal(
    supabaseClient
      .from('project_stages')
      .select('id, project_id, name, position, is_done')
      .eq('project_id', projectId)
      .order('position')
      .order('id')
      .limit(200),
    signal,
  );
  if (error) throw new Error('Could not load stages.');
  return data.map(mapStage);
}

export async function getAdminStage(id, { signal } = {}) {
  if (!isUuid(id)) throw new AdminNotFoundError('Stage');
  const { data, error } = await withSignal(
    supabaseClient
      .from('project_stages')
      .select('id, project_id, name, position, is_done')
      .eq('id', id)
      .maybeSingle(),
    signal,
  );
  if (error) throw new Error('Could not load this stage.');
  if (!data) throw new AdminNotFoundError('Stage');
  const { count, error: countError } = await withSignal(
    supabaseClient.from('tasks').select('id', { count: 'exact', head: true }).eq('stage_id', id),
    signal,
  );
  if (countError) throw new Error('Could not load this stage.');
  return { ...mapStage(data), taskCount: count ?? 0 };
}

// Changing is_done is applied to the stage's tasks by a database trigger, so tasks.done stays consistent.
export async function updateStage(id, { name, isDone }) {
  if (!isUuid(id)) throw new AdminNotFoundError('Stage');
  const { data, error } = await supabaseClient
    .from('project_stages')
    .update({ name: name.trim(), is_done: Boolean(isDone) })
    .eq('id', id)
    .select('id');
  if (error) throw new Error('Could not save the stage. Please try again.');
  if (!data?.length) throw new AdminNotFoundError('Stage');
}

export async function moveStage(id, index) {
  if (!isUuid(id) || !Number.isInteger(index) || index < 0) throw new AdminNotFoundError('Stage');
  const { error } = await supabaseClient.rpc('move_stage', { p_stage_id: id, p_index: index });
  if (error) throw translate(error, 'Stage', 'Could not move the stage. Please try again.');
}

// A stage that has tasks needs `targetStageId` (another stage of the same project); the database enforces it.
export async function deleteStage(id, targetStageId = null) {
  if (!isUuid(id) || (targetStageId !== null && !isUuid(targetStageId))) throw new AdminNotFoundError('Stage');
  const { data, error } = await supabaseClient.rpc('delete_stage', {
    p_stage_id: id,
    p_target_stage_id: targetStageId,
  });
  if (error) throw translate(error, 'Stage', 'Could not delete the stage. Please try again.');
  return { movedTasks: data?.moved_tasks ?? 0 };
}

const mapTask = (row) => ({
  id: row.id,
  projectId: row.project_id,
  stageId: row.stage_id,
  title: row.title,
  description: row.description ?? '',
  position: row.position,
  done: row.done,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const TASK_COLUMNS = 'id, project_id, stage_id, title, description, position, done, created_at, updated_at';

export async function listProjectTasks(projectId, { page = 1, signal } = {}) {
  if (!isUuid(projectId)) throw new AdminNotFoundError('Project');
  const [from, to] = pageRange(page);
  const { data, error, count } = await withSignal(
    supabaseClient
      .from('tasks')
      .select('id, project_id, stage_id, title, position, done, created_at, updated_at', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
    signal,
  );
  if (error) throw new Error('Could not load tasks.');
  return { rows: data.map(mapTask), total: count ?? 0 };
}

export async function getAdminTask(id, { signal } = {}) {
  if (!isUuid(id)) throw new AdminNotFoundError('Task');
  const { data, error } = await withSignal(
    supabaseClient.from('tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle(),
    signal,
  );
  if (error) throw new Error('Could not load this task.');
  if (!data) throw new AdminNotFoundError('Task');
  return mapTask(data);
}
