import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
export const CHECKLIST_TEXT_MAX = 500;
export class ChecklistChangedError extends Error {
  constructor() { super('The checklist changed. It has been refreshed; try moving the item again.'); this.name = 'ChecklistChangedError'; }
}
export function validateChecklistText(text) {
  const clean = String(text ?? '').trim();
  if (!clean || clean.length > CHECKLIST_TEXT_MAX) throw new Error(`Enter an item of 1–${CHECKLIST_TEXT_MAX} characters.`);
  return clean;
}
export async function getTaskChecklist(taskId, { signal } = {}) {
  if (!isUuid(taskId)) throw new Error('Task not found.');
  let query = supabaseClient.rpc('get_task_checklist', { p_task_id: taskId });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load this checklist. Check task access and try again.');
  return { items: data.items, total: Number(data.total), completed: Number(data.completed) };
}
export async function writeTaskChecklist(taskId, action, { itemId = null, text = null, completed = null, order = null, expectedOrder = null } = {}) {
  if (!isUuid(taskId) || (itemId && !isUuid(itemId))) throw new Error('Invalid checklist item.');
  if (action === 'add' || action === 'edit') text = validateChecklistText(text);
  const { data, error } = await supabaseClient.rpc('write_task_checklist', {
    p_task_id: taskId, p_action: action, p_item_id: itemId, p_text: text,
    p_completed: completed, p_order: order, p_expected_order: expectedOrder,
  });
  if (error?.code === '40001') throw new ChecklistChangedError();
  if (error) throw new Error('Could not save the checklist. Reload and check task access.');
  return data;
}
export async function getChecklistProgress(taskIds, { signal } = {}) {
  if (!taskIds.length) return new Map();
  if (taskIds.length > 500 || !taskIds.every(isUuid)) throw new Error('Invalid tasks.');
  let query = supabaseClient.rpc('task_checklist_progress', { p_task_ids: taskIds });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load checklist progress.');
  return new Map(data.map(row => [row.task_id, { total: Number(row.total), completed: Number(row.completed) }]));
}
