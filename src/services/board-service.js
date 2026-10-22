import { supabaseClient } from './supabase-client.js';
import { getProject } from './projects-service.js';
import { isUuid } from '../utils/validation.js';

// Each column is read independently with keyset pagination on (position, id). That pair is the same order the
// database uses everywhere (move_task renumbers by it), it is unique because id is unique, and a cursor stays
// valid while rows are inserted or deleted elsewhere in the column. It does NOT survive a reorder: after any
// move the caller must drop its cursors and refetch (see `depths` in getBoard).
export const BOARD_PAGE_SIZE = 50;
// A reload re-reads at most this many rows per column in one request; deeper pages load again on demand.
export const BOARD_RELOAD_LIMIT = 500;

const byPositionThenId = (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const TASK_COLUMNS = 'id, stage_id, title, description, position, done, created_at, updated_at';

const mapTask = (task) => ({
  id: task.id,
  title: task.title,
  description: task.description ?? '',
  position: task.position,
  done: task.done,
  createdAt: task.created_at,
  updatedAt: task.updated_at,
});

function withSignal(query, signal) {
  return signal ? query.abortSignal(signal) : query;
}

// Rows strictly after the cursor in (position, id) order. Both values are validated because they are
// interpolated into a PostgREST filter expression.
function afterCursor(query, cursor) {
  if (!cursor) return query;
  if (!Number.isInteger(cursor.position) || cursor.position < 0 || !isUuid(cursor.id)) {
    throw new Error('Invalid page cursor.');
  }
  return query.or(`position.gt.${cursor.position},and(position.eq.${cursor.position},id.gt.${cursor.id})`);
}

// Reads `limit` tasks after `cursor`. One extra row is requested so the end of the list is known exactly.
// Resolves { tasks, hasMore, nextCursor } where nextCursor is the position and id of the last returned task.
export async function fetchColumnTasks(stageId, { cursor = null, limit = BOARD_PAGE_SIZE, signal } = {}) {
  if (!isUuid(stageId)) throw new Error('Could not load tasks.');
  const size = Math.min(Math.max(1, limit), BOARD_RELOAD_LIMIT);

  const { data, error } = await withSignal(
    afterCursor(
      supabaseClient.from('tasks').select(TASK_COLUMNS).eq('stage_id', stageId),
      cursor,
    )
      .order('position')
      .order('id')
      .limit(size + 1),
    signal,
  );
  if (error) throw new Error('Could not load tasks.');

  const hasMore = data.length > size;
  const rows = hasMore ? data.slice(0, size) : data;
  const last = rows.at(-1);
  return {
    tasks: rows.map(mapTask),
    hasMore,
    nextCursor: hasMore && last ? { position: last.position, id: last.id } : null,
  };
}

// Loads the project, its stages, exact per-stage task totals and the first page of every column.
// `depths` (stage id -> number of rows currently shown) makes a reload re-read each column from the top down to
// at least that depth in ONE request per column, so the result is a consistent snapshot rather than old and new
// pages glued together. Access is decided by RLS; a missing or inaccessible project throws ProjectNotFoundError.
export async function getBoard(projectId, { signal, depths } = {}) {
  const project = await getProject(projectId, { signal });

  const [stagesResult, countsResult] = await Promise.all([
    withSignal(
      supabaseClient
        .from('project_stages')
        .select('id, name, position, is_done')
        .eq('project_id', project.id)
        .order('position')
        .order('id')
        .limit(200),
      signal,
    ),
    withSignal(supabaseClient.rpc('board_stage_counts', { p_project_id: project.id }), signal),
  ]);
  if (stagesResult.error || countsResult.error) throw new Error('Could not load this board.');

  const totals = new Map(countsResult.data.map((row) => [row.stage_id, Number(row.task_count)]));
  const stages = stagesResult.data
    .map((stage) => ({
      id: stage.id,
      name: stage.name,
      position: stage.position,
      isDone: stage.is_done,
    }))
    .sort(byPositionThenId);

  const pages = await Promise.all(
    stages.map((stage) =>
      fetchColumnTasks(stage.id, {
        limit: Math.max(BOARD_PAGE_SIZE, depths?.get(stage.id) ?? 0),
        signal,
      }),
    ),
  );

  stages.forEach((stage, index) => {
    const page = pages[index];
    stage.tasks = page.tasks;
    stage.hasMore = page.hasMore;
    stage.nextCursor = page.nextCursor;
    stage.loadingMore = false;
    stage.loadError = false;
    // A fully read column is its own authority; otherwise the database count includes the unloaded rows.
    stage.taskCount = page.hasMore ? Math.max(totals.get(stage.id) ?? 0, page.tasks.length + 1) : page.tasks.length;
  });

  return { project, stages };
}
