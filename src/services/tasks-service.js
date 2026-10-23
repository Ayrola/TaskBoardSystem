import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
import { sanitizeRichText, RICH_TEXT_MAX_LENGTH } from '../utils/sanitize.js';
import { drainAttachmentCleanup } from './attachments-service.js';

// Raised when the task or stage does not exist or is not accessible; both look the same on purpose.
export class TaskNotFoundError extends Error {
  constructor() {
    super('Task not found.');
    this.name = 'TaskNotFoundError';
  }
}

const NOT_FOUND_CODE = 'P0002'; // raised by the create_task / update_task functions

// Every write goes through here, so the description is sanitized exactly once per save.
function prepareDescription(value) {
  const clean = sanitizeRichText(value);
  if (clean.length > RICH_TEXT_MAX_LENGTH) throw new Error('The description is too long.');
  return clean === '' ? null : clean;
}

// New tasks are appended to the end of the stage by the database (serialized per project).
export async function createTask({ projectId, stageId, title, description }) {
  if (!isUuid(projectId) || !isUuid(stageId)) throw new TaskNotFoundError();

  const { data, error } = await supabaseClient.rpc('create_task', {
    p_project_id: projectId,
    p_stage_id: stageId,
    p_title: title.trim(),
    p_description: prepareDescription(description),
  });
  if (error?.code === NOT_FOUND_CODE) throw new TaskNotFoundError();
  if (error || !data) throw new Error('Could not save the task. Please try again.');
  return data;
}

// Changing the stage moves the task to the end of the new stage; `done` follows the stage in the database.
export async function updateTask(taskId, { stageId, title, description }) {
  if (!isUuid(taskId) || !isUuid(stageId)) throw new TaskNotFoundError();

  const { error } = await supabaseClient.rpc('update_task', {
    p_task_id: taskId,
    p_title: title.trim(),
    p_description: prepareDescription(description),
    p_stage_id: stageId,
  });
  if (error?.code === NOT_FOUND_CODE) throw new TaskNotFoundError();
  if (error) throw new Error('Could not save the task. Please try again.');
}

// Deleting goes through the RPC so the column is renumbered under the project lock.
export async function deleteTask(taskId) {
  if (!isUuid(taskId)) throw new TaskNotFoundError();

  const { error } = await supabaseClient.rpc('delete_task', { p_task_id: taskId });
  if (error?.code === NOT_FOUND_CODE) throw new TaskNotFoundError();
  if (error) throw new Error('Could not delete the task. Please try again.');
  // The task's attachment rows were removed with it; remove their files too (best effort, retried later).
  await drainAttachmentCleanup();
}

// Raised when the destination column changed so the requested placement no longer exists (nothing was moved).
export class StalePlacementError extends Error {
  constructor() {
    super('The column changed. Reload and try again.');
    this.name = 'StalePlacementError';
  }
}

// Authoritative move. The browser never sends a position computed from the rows it happens to have loaded:
// it names a placement relative to the real column and the server renumbers the WHOLE source and destination
// columns under the project lock.
//   afterTaskId = null, toEnd = false -> top of the column
//   afterTaskId = <id>                -> directly after that task (it may be the last LOADED task of a longer column;
//                                        the dropped task then sits before every still-unloaded task)
//   toEnd = true                      -> after the last task of the whole column, loaded or not
// Resolves { taskId, stageId, sourceStageId, position, done, changed, sourceCount, destCount }. Positions of other
// tasks are not returned: every affected cursor is stale afterwards, so the caller refetches the columns.
export async function moveTask({ taskId, stageId, afterTaskId = null, toEnd = false }) {
  if (!isUuid(taskId) || !isUuid(stageId) || (afterTaskId !== null && !isUuid(afterTaskId))) {
    throw new TaskNotFoundError();
  }

  const { data, error } = await supabaseClient.rpc('move_task_relative', {
    p_task_id: taskId,
    p_stage_id: stageId,
    p_after_task_id: toEnd ? null : afterTaskId,
    p_to_end: Boolean(toEnd),
  });
  if (error?.code === NOT_FOUND_CODE) throw new TaskNotFoundError();
  if (error?.code === '40001') throw new StalePlacementError();
  if (error || !data) throw new Error('Could not move the task. Please try again.');

  return {
    taskId: data.task_id,
    stageId: data.stage_id,
    sourceStageId: data.source_stage_id,
    position: data.position,
    done: data.done,
    changed: data.changed,
    sourceCount: Number(data.source_count),
    destCount: Number(data.dest_count),
  };
}

// Used by links from paginated label results, including tasks outside the board's loaded pages.
export async function getTask(taskId, { signal } = {}) {
  if (!isUuid(taskId)) throw new TaskNotFoundError();
  let query = supabaseClient.from('tasks').select('id, project_id, stage_id, title, description, done, created_at, updated_at').eq('id', taskId).maybeSingle();
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Could not load the task.');
  if (!data) throw new TaskNotFoundError();
  return { id: data.id, projectId: data.project_id, stageId: data.stage_id, title: data.title,
    description: data.description ?? '', done: data.done, createdAt: data.created_at, updatedAt: data.updated_at };
}
