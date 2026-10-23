import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';

export const LABEL_TASKS_PAGE_SIZE = 20;
export async function listProjectLabels(projectId, { signal } = {}) {
  if (!isUuid(projectId)) throw new Error('Project not found.');
  const labels = [];
  // Read every catalogue page rather than silently truncating at the API row limit.
  for (let offset = 0; ; offset += 200) {
    let query = supabaseClient.from('project_labels').select('id, project_id, name, colour')
      .eq('project_id', projectId).order('name').order('id').range(offset, offset + 199);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error('Could not load project labels.');
    labels.push(...data);
    if (data.length < 200) return labels;
  }
}

export async function saveProjectLabel(projectId, labelId, { name, colour }) {
  name = name.trim();
  if (!isUuid(projectId) || (labelId && !isUuid(labelId))) throw new Error('Invalid label.');
  if (!name || name.length > 60) throw new Error('Enter a label name of 1–60 characters.');
  if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new Error('Choose a valid colour.');
  const query = labelId
    ? supabaseClient.from('project_labels').update({ name, colour }).eq('project_id', projectId).eq('id', labelId)
    : supabaseClient.from('project_labels').insert({ project_id: projectId, name, colour });
  const { data, error } = await query.select('id');
  if (error?.code === '23505') throw new Error('This project already has a label with that name.');
  if (error || !data?.length) throw new Error('Could not save the label. Check your project access and try again.');
}

export async function removeProjectLabel(projectId, labelId) {
  const { data, error } = await supabaseClient.from('project_labels').delete()
    .eq('project_id', projectId).eq('id', labelId).select('id');
  if (error || !data?.length) throw new Error('Could not remove the label. Reload and try again.');
}

export async function setTaskLabel(taskId, labelId, assigned) {
  if (!isUuid(taskId) || !isUuid(labelId)) throw new Error('Invalid label assignment.');
  const { error } = assigned
    ? await supabaseClient.from('task_labels').insert({ task_id: taskId, label_id: labelId })
    : await supabaseClient.from('task_labels').delete().eq('task_id', taskId).eq('label_id', labelId);
  if (assigned && error?.code === '23505') return;
  if (error) throw new Error('Could not change the task label. Reload and check project access.');
}

export async function listTaskLabelIds(taskId, { signal } = {}) {
  let query = supabaseClient.from('task_labels').select('label_id').eq('task_id', taskId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load task labels.');
  return new Set(data.map((row) => row.label_id));
}

export async function listLabelTasks(labelId, { page = 1, signal } = {}) {
  if (!isUuid(labelId)) throw new Error('Label not found.');
  let query = supabaseClient.rpc('label_tasks_page', {
    p_label_id: labelId, p_limit: LABEL_TASKS_PAGE_SIZE,
    p_offset: (Math.max(1, Math.floor(page) || 1) - 1) * LABEL_TASKS_PAGE_SIZE,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load matching tasks.');
  return { rows: data.rows, total: Number(data.total) };
}
