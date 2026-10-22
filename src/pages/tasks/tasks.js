import Sortable from 'sortablejs';
import html from './tasks.html?raw';
import './tasks.css';
import { renderFragment, setText, htmlToExcerpt } from '../../utils/render.js';
import { getBoard } from '../../services/board-service.js';
import { ProjectNotFoundError, getProject } from '../../services/projects-service.js';
import { createTask, updateTask, deleteTask, moveTask, TaskNotFoundError } from '../../services/tasks-service.js';
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
  let data = null; // { project, stages } as last loaded
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
          performMove(event.item.dataset.taskId, stageId, event.newIndex);
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

    const count = setText(column, '[data-stage-count]', stage.tasks.length);
    count.setAttribute('aria-label', `${stage.tasks.length} ${stage.tasks.length === 1 ? 'task' : 'tasks'}`);
    if (stage.isDone) {
      count.className = 'badge text-bg-success rounded-pill';
      column.classList.add('is-done');
    }

    column.querySelector('[data-cards]').append(...stage.tasks.map(buildCard));
    column.querySelector('[data-stage-empty]').hidden = stage.tasks.length > 0;

    const add = column.querySelector('[data-add]');
    add.setAttribute('aria-label', `Add task to ${stage.name}`);
    add.title = `Add task to ${stage.name}`;
    return column;
  }

  function render({ project, stages }) {
    const id = encodeURIComponent(project.id);
    setText(root, '[data-heading]', project.title);
    const description = setText(root, '[data-project-description]', project.description);
    description.hidden = !project.description;
    root.querySelector('[data-link="edit"]').hidden = !project.isOwner;
    root.querySelector('[data-link="users"]').hidden = !project.isOwner;
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

    const totalTasks = stages.reduce((sum, stage) => sum + stage.tasks.length, 0);
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
  async function load({ quiet = false } = {}) {
    const current = ++requestId;
    pendingRefresh = false; // this load already reads the newest state
    if (!quiet) show('loading');
    try {
      const loaded = await getBoard(params.id, { signal: ctx.signal });
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

  // Merges the server's answer for the two affected columns into the local board model.
  function applyMoveResult(result) {
    const known = new Map(data.stages.flatMap((stage) => stage.tasks).map((task) => [task.id, task]));
    for (const stage of data.stages) {
      if (stage.id !== result.stageId && stage.id !== result.sourceStageId) continue;
      stage.tasks = result.tasks
        .filter((task) => task.stageId === stage.id && known.has(task.id))
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((task) => ({ ...known.get(task.id), position: task.position, done: task.done }));
    }
  }

  // Server is the source of truth: show its answer at once, then reload everything.
  // On any failure the reload restores the real order that the drag had visually changed.
  async function performMove(taskId, stageId, index, { restoreFocusTo } = {}) {
    if (moving || flowActive || !data) {
      await load({ quiet: true });
      return;
    }
    moving = true;
    setSaving(true);
    try {
      try {
        const result = await moveTask(taskId, stageId, index);
        if (ctx.signal.aborted) return;
        applyMoveResult(result);
        render(data);
      } catch (error) {
        if (ctx.signal.aborted) return;
        showError(
          error instanceof TaskNotFoundError
            ? 'That task or stage no longer exists. The board was refreshed.'
            : 'Could not move the task. The board was restored.',
        );
      }
      await load({ quiet: true });
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
    if (choice) await performMove(taskId, choice.stageId, choice.index, { restoreFocusTo: true });
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
    return false;
  }

  ctx.cleanup.listen(board, 'click', (event) => {
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
      if (kind === 'access') checkAccess();
      scheduleRefresh();
    },
    onSubscribed: () => {
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
