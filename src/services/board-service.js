import { supabaseClient } from './supabase-client.js';
import { getProject } from './projects-service.js';

const PAGE_SIZE = 1000;

const byPositionThenId = (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function withSignal(query, signal) {
  return signal ? query.abortSignal(signal) : query;
}

// Reads every row in pages, so boards with more than one API page are never silently truncated.
async function fetchAll(buildQuery, signal) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await withSignal(
      buildQuery().range(from, from + PAGE_SIZE - 1),
      signal,
    );
    if (error) throw new Error('Could not load this board.');
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

// Loads the project, its stages and its tasks. Access is decided by RLS; a project that is missing
// or not accessible throws ProjectNotFoundError (from getProject) before anything else is read.
export async function getBoard(projectId, { signal } = {}) {
  const project = await getProject(projectId, { signal });

  const [stageRows, taskRows] = await Promise.all([
    fetchAll(
      () =>
        supabaseClient
          .from('project_stages')
          .select('id, name, position, is_done')
          .eq('project_id', project.id)
          .order('position')
          .order('id'),
      signal,
    ),
    fetchAll(
      () =>
        supabaseClient
          .from('tasks')
          .select('id, stage_id, title, description, position, done, created_at, updated_at')
          .eq('project_id', project.id)
          .order('position')
          .order('id'),
      signal,
    ),
  ]);

  const stages = stageRows
    .map((stage) => ({
      id: stage.id,
      name: stage.name,
      position: stage.position,
      isDone: stage.is_done,
      tasks: [],
    }))
    .sort(byPositionThenId);

  const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
  for (const task of taskRows) {
    stagesById.get(task.stage_id)?.tasks.push({
      id: task.id,
      title: task.title,
      description: task.description ?? '',
      position: task.position,
      done: task.done,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    });
  }
  stages.forEach((stage) => stage.tasks.sort(byPositionThenId));

  return { project, stages };
}
