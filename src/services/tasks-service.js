import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
import { sanitizeRichText, RICH_TEXT_MAX_LENGTH } from '../utils/sanitize.js';

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
}

// Moves one task to `index` in the destination stage. Only IDs of the dragged task and the stage are sent;
// the server computes every position. Resolves to the affected columns so the board can refresh reliably:
// { taskId, stageId, sourceStageId, position, done, changed, tasks: [{ id, stageId, position, done }] }
export async function moveTask(taskId, stageId, index) {
  if (!isUuid(taskId) || !isUuid(stageId)) throw new TaskNotFoundError();
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid position.');

  const { data, error } = await supabaseClient.rpc('move_task', {
    p_task_id: taskId,
    p_stage_id: stageId,
    p_index: index,
  });
  if (error?.code === NOT_FOUND_CODE) throw new TaskNotFoundError();
  if (error || !data) throw new Error('Could not move the task. Please try again.');

  return {
    taskId: data.task_id,
    stageId: data.stage_id,
    sourceStageId: data.source_stage_id,
    position: data.position,
    done: data.done,
    changed: data.changed,
    tasks: data.tasks.map((task) => ({
      id: task.id,
      stageId: task.stage_id,
      position: task.position,
      done: task.done,
    })),
  };
}
