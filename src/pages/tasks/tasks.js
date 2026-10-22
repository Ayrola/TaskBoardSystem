import Sortable from 'sortablejs';
import html from './tasks.html?raw';
import './tasks.css';
import { renderFragment, setText, htmlToExcerpt } from '../../utils/render.js';
import { getBoard, fetchColumnTasks, BOARD_PAGE_SIZE } from '../../services/board-service.js';
import { ProjectNotFoundError, getProject } from '../../services/projects-service.js';
import { createTask, updateTask, deleteTask, moveTask, TaskNotFoundError, StalePlacementError } from '../../services/tasks-service.js';
import { drainAttachmentCleanup } from '../../services/attachments-service.js';
import { subscribeToBoard } from '../../services/board-realtime.js';
import { onAuthChange } from '../../services/auth-service.js';
import { openTaskFormModal } from '../../components/task-form-modal/task-form-modal.js';
import { openTaskViewModal } from '../../components/task-view-modal/task-view-modal.js';
import { openMoveTaskModal } from '../../components/move-task-modal/move-task-modal.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { showSuccess, showInfo, showError, TOAST_MESSAGES } from '../../services/toast-service.js';

export const title = 'Tasks';

const REFRESH_DEBOUNCE_MS = 300;
const LOAD_MORE_THRESHOLD_PX = 160;

export function mount(container, ctx) {
  const { params } = ctx;
  renderFragment(container, html);
  const root = container.querySelector('.page-tasks');
  const panels = root.querySelectorAll('[data-state]');
  const board = root.querySelector('[data-board]');
  const columnTemplate = root.querySelector('[data-column-template]');
  const cardTemplate = root.querySelector('[data-card-template]');
  const actions = root.querySelector('[data-actions]');
  let requestId = 0;
  // Bumped whenever cursors may have become invalid (a reload starts, a move, a realtime change). A page
  // request that finishes under an older epoch is discarded, so stale pages are never mixed into the board.
  let boardEpoch = 0;
  let activeLoads = 0;
  let data = null; // { project, stages } as last loaded; each stage carries tasks, taskCount, hasMore, nextCursor
  let activeDialog = null; // the modal currently open, so unmount can release it
  let flowActive = false; // one add/view/edit/delete flow at a time
  let stale = false; // a save failed because the task or stage no longer exists
  let moving = false; // a move request is in flight; further moves are blocked until it is reconciled
  let sortables = [];
  let dragging = false; // a drag is in progress; re-rendering now would destroy it
  let pendingRefresh = false; // a realtime change arrived while the board could not be re-rendered
  let refreshTimer = 0;
  let realtime = null;
  const savingSpinner = root.querySelector('[data-saving-spinner]');
  const savingText = root.querySelector('[data-saving-text]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function setSaving(active) {
    savingSpinner.hidden = !active;
    savingText.textContent = active ? 'Saving move…' : '';
    board.classList.toggle('is-saving', active);
    board.setAttribute('aria-busy', String(active));
    for (const sortable of sortables) sortable.option('disabled', active);
  }

  function destroySortables() {
    for (const sortable of sortables) sortable.destroy();
    sortables = [];
  }

  // Dragging starts only from the grip handle so cards stay scrollable and clickable on touch screens.
  function initSortables() {
    destroySortables();
    sortables = [...board.querySelectorAll('[data-cards]')].map((list) =>
      Sortable.create(list, {
        group: 'board-tasks',
        draggable: '.task-card',
        handle: '[data-drag-handle]',
        animation: reduceMotion.matches ? 0 : 150,
        ghostClass: 'task-ghost',
        chosenClass: 'task-chosen',
        emptyInsertThreshold: 24,
        forceFallback: false,
        disabled: moving,
        onStart: () => {
          dragging = true;
          board.classList.add('is-dragging');
        },
        onEnd: (event) => {
          dragging = false;
          board.classList.remove('is-dragging');
          if (event.from === event.to && event.oldIndex === event.newIndex) {
            flushPending();
            return;
          }
          const stageId = event.to.closest('.board-column')?.dataset.stageId;
          // The anchor is the card now directly above the drop; null means the top of the column. A drop below
          // the last LOADED card lands right after it, ahead of every unloaded task.
          const above = event.item.previousElementSibling;
          performMove(event.item.dataset.taskId, stageId, { afterTaskId: above?.dataset.taskId ?? null });
        },
      }),
    );
  }

  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
  };

  function buildCard(task) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.taskId = task.id;
    setText(card, '[data-task-title]', task.title);
    setText(card, '[data-task-assignees]', task.assignees?.length
      ? `Assigned: ${task.assignees.map((a) => a.label).join(', ')}` : 'Unassigned');
    const excerpt = htmlToExcerpt(task.description);
    if (excerpt) {
      const element = setText(card, '[data-task-excerpt]', excerpt);
      element.hidden = false;
    }
    for (const button of card.querySelectorAll('[data-task-action]')) {
      const label = `${button.dataset.taskAction[0].toUpperCase()}${button.dataset.taskAction.slice(1)} task: ${task.title}`;
      button.setAttribute('aria-label', label);
      button.title = `${button.dataset.taskAction[0].toUpperCase()}${button.dataset.taskAction.slice(1)} task`;
    }
    if (task.done) card.classList.add('border-success');
    return card;
  }

  function buildColumn(stage) {
    const column = columnTemplate.content.firstElementChild.cloneNode(true);
    column.dataset.stageId = stage.id;
    const heading = setText(column, '[data-stage-name]', stage.name);
    heading.id = `stage-${stage.id}`;
    column.setAttribute('aria-labelledby', heading.id);

    const count = setText(column, '[data-stage-count]', stage.taskCount.toLocaleString());
    count.setAttribute('aria-label', `${stage.taskCount} ${stage.taskCount === 1 ? 'task' : 'tasks'}`);
    if (stage.isDone) {
      count.className = 'badge text-bg-success rounded-pill';
      column.classList.add('is-done');
    }

    column.querySelector('[data-cards]').append(...stage.tasks.map(buildCard));
    column.querySelector('[data-stage-empty]').hidden = stage.taskCount > 0;
    updateColumnFooter(column, stage);

    const add = column.querySelector('[data-add]');
    add.setAttribute('aria-label', `Add task to ${stage.name}`);
    add.title = `Add task to ${stage.name}`;
    return column;
  }

  // Loading, "load more" and end-of-list indicators of one column.
  function updateColumnFooter(column, stage) {
    const more = column.querySelector('[data-more]');
    const end = column.querySelector('[data-more-end]');
    more.hidden = !stage.hasMore;
    end.hidden = stage.hasMore || stage.tasks.length <= BOARD_PAGE_SIZE;
    if (!stage.hasMore) return;
    setText(more, '[data-more-summary]', `Showing ${stage.tasks.length.toLocaleString()} of ${stage.taskCount.toLocaleString()} tasks`);
    more.querySelector('[data-more-spinner]').hidden = !stage.loadingMore;
    more.querySelector('[data-more-error]').hidden = !stage.loadError || stage.loadingMore;
    const button = more.querySelector('[data-load-more]');
    button.disabled = stage.loadingMore;
    button.textContent = stage.loadingMore ? 'Loading…' : stage.loadError ? 'Try again' : 'Load more';
  }

  const columnFor = (stageId) => board.querySelector(`.board-column[data-stage-id="${CSS.escape(stageId)}"]`);

  // Appends the next page of one column. The cursor is the last loaded (position, id); results are discarded if
  // the board was invalidated or re-rendered meanwhile, and ids already present are never added twice.
  async function loadMore(stageId) {
    const stage = data?.stages.find((candidate) => candidate.id === stageId);
    if (!stage || !stage.hasMore || stage.loadingMore || activeLoads > 0 || isBusy() || ctx.signal.aborted) return;

    const epoch = boardEpoch;
    stage.loadingMore = true;
    stage.loadError = false;
    updateColumnFooter(columnFor(stageId), stage);
    let result = null;
    try {
      result = await fetchColumnTasks(stageId, { cursor: stage.nextCursor, signal: ctx.signal });
    } catch {
      if (ctx.signal.aborted) return;
    }
    stage.loadingMore = false;
    if (ctx.signal.aborted) return;

    const column = columnFor(stageId);
    const stillCurrent = epoch === boardEpoch && data?.stages.includes(stage) && column;
    if (!stillCurrent) return; // the reload that invalidated this page rebuilds the column itself
    if (!result) {
      stage.loadError = true;
      updateColumnFooter(column, stage);
      return;
    }

    const known = new Set(stage.tasks.map((task) => task.id));
    const fresh = result.tasks.filter((task) => !known.has(task.id));
    stage.tasks.push(...fresh);
    stage.hasMore = result.hasMore;
    stage.nextCursor = result.nextCursor;
    if (!stage.hasMore) stage.taskCount = stage.tasks.length;
    else stage.taskCount = Math.max(stage.taskCount, stage.tasks.length + 1);
    column.querySelector('[data-cards]').append(...fresh.map(buildCard));
    setText(column, '[data-stage-count]', stage.taskCount.toLocaleString());
    updateColumnFooter(column, stage);
    // Overlap means the column moved under us; settle on a fresh snapshot.
    if (fresh.length !== result.tasks.length) scheduleRefresh();
  }

  function render({ project, stages }) {
    const id = encodeURIComponent(project.id);
    setText(root, '[data-heading]', project.title);
    const description = setText(root, '[data-project-description]', project.description);
    description.hidden = !project.description;
    root.querySelector('[data-link="edit"]').hidden = !project.canManage;
    root.querySelector('[data-link="users"]').hidden = !project.canManage;
    root.querySelector('[data-link="edit"]').href = `/projects/${id}/edit`;
    root.querySelector('[data-link="users"]').href = `/projects/${id}/users`;
    actions.hidden = false;
    document.title = `${project.title} · Tasks · Taskboard`;

    // Keep each column's scroll position across a refresh.
    const scrollTops = new Map(
      [...board.querySelectorAll('.board-column')].map((column) => [
        column.dataset.stageId,
        column.querySelector('[data-cards]').scrollTop,
      ]),
    );

    const totalTasks = stages.reduce((sum, stage) => sum + stage.taskCount, 0);
    root.querySelector('[data-no-stages]').hidden = stages.length > 0;
    root.querySelector('[data-empty-project]').hidden = totalTasks > 0 || stages.length === 0;
    board.hidden = stages.length === 0;
    destroySortables();
    board.replaceChildren(...stages.map(buildColumn));
    initSortables();

    for (const column of board.querySelectorAll('.board-column')) {
      const top = scrollTops.get(column.dataset.stageId);
      if (top) column.querySelector('[data-cards]').scrollTop = top;
    }
  }

  // `quiet` refreshes in place (after a change) without replacing the board with the loading state.
  // A reload re-reads every column from the top down to the depth currently shown (plus `boost` rows for a column
  // that just received a task), so every cursor is replaced by one taken from the same fresh snapshot.
  async function load({ quiet = false, boost } = {}) {
    const current = ++requestId;
    boardEpoch += 1;
    pendingRefresh = false; // this load already reads the newest state
    if (!quiet) show('loading');
    const depths = data
      ? new Map(data.stages.map((stage) => [stage.id, stage.tasks.length + (boost?.get(stage.id) ?? 0)]))
      : undefined;
    activeLoads += 1;
    try {
      const loaded = await getBoard(params.id, { signal: ctx.signal, depths });
      // Ignore answers that belong to an older request or to a previously opened project.
      if (current !== requestId || ctx.signal.aborted || loaded.project.id !== params.id) return;
      data = loaded;
      render(loaded);
      show('board');
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      data = null;
      actions.hidden = true;
      if (error instanceof ProjectNotFoundError) {
        handleAccessLost();
      } else {
        setText(root, '[data-error-text]', error.message);
        show('error');
      }
    } finally {
      activeLoads -= 1;
    }
  }

  const isBusy = () => moving || flowActive || dragging;

  // The project vanished or this user lost access. A denied reload proves it; the UI is not the boundary.
  function handleAccessLost() {
    clearTimeout(refreshTimer);
    realtime?.unsubscribe();
    activeDialog?.destroy();
    data = null;
    actions.hidden = true;
    setText(root, '[data-heading]', 'Project not found');
    setLive(true);
    show('notfound');
  }

  // Cheap authoritative check used when a reload has to wait (open editor, drag, save in flight).
  async function checkAccess() {
    try {
      await getProject(params.id, { signal: ctx.signal });
    } catch (error) {
      if (!ctx.signal.aborted && error instanceof ProjectNotFoundError) handleAccessLost();
    }
  }

  // A reload never runs underneath an open editor, a drag or a pending save, so unsaved fields and in-flight
  // moves are not overwritten. It is flushed as soon as that work ends.
  function refresh() {
    if (ctx.signal.aborted) return;
    if (isBusy()) {
      pendingRefresh = true;
      checkAccess();
      return;
    }
    load({ quiet: true });
  }

  function flushPending() {
    if (pendingRefresh && !isBusy() && !ctx.signal.aborted) load({ quiet: true });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  }

  function setLive(online) {
    root.querySelector('[data-live-status]').textContent = online ? '' : 'Live updates paused. Reconnecting…';
  }

  async function runDialog(open) {
    activeDialog = open();
    try {
      return await activeDialog.result;
    } finally {
      activeDialog = null;
    }
  }

  // Runs one user flow (it may chain modals), then refreshes the board and returns focus.
  async function runFlow(flow, focusTarget) {
    if (flowActive || moving || !data) return;
    flowActive = true;
    let changed = false;
    try {
      changed = await flow();
    } finally {
      flowActive = false;
    }
    if (ctx.signal.aborted) return;
    if (changed || stale) {
      stale = false;
      await load({ quiet: true });
      if (ctx.signal.aborted) return;
    } else {
      flushPending();
    }
    restoreFocus(focusTarget);
  }

  function restoreFocus({ taskId, stageId } = {}) {
    const selector = taskId
      ? `[data-task-id="${CSS.escape(taskId)}"] [data-open-task]`
      : `[data-stage-id="${CSS.escape(stageId ?? '')}"] [data-add]`;
    const target = root.querySelector(selector) ?? root.querySelector('h1');
    target?.focus();
  }

  const findTask = (taskId) => {
    for (const stage of data?.stages ?? []) {
      const task = stage.tasks.find((candidate) => candidate.id === taskId);
      if (task) return { task: { ...task, stageId: stage.id }, stage };
    }
    return null;
  };

  async function save(taskId, values) {
    try {
      if (taskId) await updateTask(taskId, values);
      else await createTask({ projectId: data.project.id, ...values });
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        stale = true;
        throw new Error('This task or stage no longer exists. Close this window to refresh the board.');
      }
      throw error;
    }
    showSuccess(TOAST_MESSAGES.taskSaved);
  }

  const addTask = (stageId) =>
    runDialog(() =>
      openTaskFormModal({
        mode: 'add',
        stages: data.stages,
        stageId,
        onSubmit: (values) => save(null, values),
      }),
    );

  const editTask = (found) =>
    runDialog(() =>
      openTaskFormModal({
        mode: 'edit',
        stages: data.stages,
        task: found.task,
        onSubmit: (values) => save(found.task.id, values),
      }),
    );

  async function removeTask({ task }) {
    return runDialog(() =>
      openConfirmDialog({
        title: 'Delete task?',
        lead: `Are you sure you want to delete “${task.title}”?`,
        detail: 'This task and its attachments will be permanently removed. This cannot be undone.',
        confirmLabel: 'Delete task',
        onConfirm: async () => {
          try {
            await deleteTask(task.id);
          } catch (error) {
            // Already gone: nothing left to delete, so just refresh.
            if (!(error instanceof TaskNotFoundError)) throw error;
            showInfo('That task no longer exists.');
            return;
          }
          showSuccess(TOAST_MESSAGES.taskDeleted);
        },
      }),
    );
  }

  // The server is the only authority on positions. `placement` is { afterTaskId } (null = top of the column)
  // or { toEnd: true }. Afterwards every cursor of the source and destination columns is stale, so the whole
  // board is reloaded from the top to the depth currently shown (the destination gets one extra row for the
  // task that arrived) instead of patching a loaded subset.
  async function performMove(taskId, stageId, placement, { restoreFocusTo } = {}) {
    if (moving || flowActive || !data) {
      await load({ quiet: true });
      return;
    }
    moving = true;
    boardEpoch += 1; // discards any load-more page still in flight
    setSaving(true);
    try {
      let boost;
      try {
        await moveTask({ taskId, stageId, ...placement });
        boost = new Map([[stageId, 1]]);
      } catch (error) {
        if (ctx.signal.aborted) return;
        showError(
          error instanceof TaskNotFoundError
            ? 'That task or stage no longer exists. The board was refreshed.'
            : error instanceof StalePlacementError
              ? 'That column changed while you were moving the task. The board was refreshed.'
              : 'Could not move the task. The board was restored.',
        );
      }
      await load({ quiet: true, boost });
    } finally {
      moving = false;
      if (!ctx.signal.aborted) setSaving(false);
    }
    if (restoreFocusTo && !ctx.signal.aborted) restoreFocus({ taskId });
    flushPending();
  }

  async function moveViaDialog(taskId) {
    if (flowActive || moving || !data) return;
    const found = findTask(taskId);
    if (!found) return;
    flowActive = true;
    let choice = null;
    try {
      choice = await runDialog(() => openMoveTaskModal({ task: found.task, stages: data.stages }));
    } finally {
      flowActive = false;
    }
    if (ctx.signal.aborted) return;
    if (choice) {
      let placement = { toEnd: true };
      if (!choice.toEnd) {
        const stage = data.stages.find((candidate) => candidate.id === choice.stageId);
        const others = (stage?.tasks ?? []).filter((task) => task.id !== taskId);
        placement = { afterTaskId: choice.index > 0 ? others[choice.index - 1]?.id ?? null : null };
      }
      await performMove(taskId, choice.stageId, placement, { restoreFocusTo: true });
    }
    else {
      flushPending();
      restoreFocus({ taskId });
    }
  }

  async function viewTask(taskId) {
    const found = findTask(taskId);
    if (!found) return false;
    const action = await runDialog(() => openTaskViewModal({ ...found, projectId: data.project.id }));
    if (ctx.signal.aborted) return false;
    if (action === 'edit') return editTask(found);
    if (action === 'delete') return removeTask(found);
    return true; // Assignment changes in details must also refresh the cards.
  }

  // Scrolling near the bottom of a column loads its next page; scroll events do not bubble, so capture them.
  ctx.cleanup.listen(board, 'scroll', (event) => {
    const list = event.target;
    if (!(list instanceof HTMLElement) || !list.matches('[data-cards]')) return;
    if (list.scrollTop + list.clientHeight < list.scrollHeight - LOAD_MORE_THRESHOLD_PX) return;
    loadMore(list.closest('.board-column').dataset.stageId);
  }, true);

  ctx.cleanup.listen(board, 'click', (event) => {
    const more = event.target.closest('[data-load-more]');
    if (more) {
      loadMore(more.closest('.board-column').dataset.stageId);
      return;
    }
    const add = event.target.closest('[data-add]');
    if (add) {
      const stageId = add.closest('.board-column').dataset.stageId;
      runFlow(() => addTask(stageId), { stageId });
      return;
    }
    const action = event.target.closest('[data-task-action]');
    if (action) {
      const taskId = action.closest('.task-card').dataset.taskId;
      const kind = action.dataset.taskAction;
      if (kind === 'move') {
        moveViaDialog(taskId);
        return;
      }
      runFlow(async () => {
        if (kind === 'view') return viewTask(taskId);
        const found = findTask(taskId);
        if (!found) return false;
        return kind === 'edit' ? editTask(found) : removeTask(found);
      }, { taskId });
      return;
    }
    const open = event.target.closest('[data-open-task]');
    if (open) {
      const taskId = open.closest('.task-card').dataset.taskId;
      runFlow(() => viewTask(taskId), { taskId });
    }
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  ctx.cleanup.add(() => activeDialog?.destroy());
  ctx.cleanup.add(destroySortables);
  ctx.cleanup.add(() => clearTimeout(refreshTimer));

  // Subscribe only while this page is mounted. After every (re)join a fresh load closes any gap.
  realtime = subscribeToBoard(params.id, {
    onNotify: (kind) => {
      if (ctx.signal.aborted) return;
      boardEpoch += 1; // invalidate in-flight pages immediately, even if the reload itself is deferred
      if (kind === 'access') checkAccess();
      scheduleRefresh();
    },
    onSubscribed: () => {
      boardEpoch += 1;
      setLive(true);
      scheduleRefresh();
    },
    onOffline: () => setLive(false),
  });
  ctx.cleanup.add(() => realtime?.unsubscribe());
  ctx.cleanup.add(
    onAuthChange(({ session, userChanged }) => {
      if (!session || userChanged) realtime?.unsubscribe();
    }),
  );

  drainAttachmentCleanup(); // finishes file removals an earlier session could not complete
  load();
}
