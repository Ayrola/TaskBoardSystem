import { createTaskCard, renderCardDeadline } from '../../components/task-card/task-card.js';
import { readBoardDisplay, saveBoardDisplay, BOARD_DISPLAY_KEY } from '../../services/board-display-service.js';
import { EMPTY_BOARD_FILTERS, boardFiltersFromQuery, hasBoardFilters, matchesBoardTask } from '../../utils/board-filters.js';
import Sortable from 'sortablejs';
import html from './tasks.html?raw';
import './tasks.css';
import { renderFragment, setText, htmlToExcerpt } from '../../utils/render.js';
import { getBoard, fetchColumnTasks, BOARD_PAGE_SIZE } from '../../services/board-service.js';
import { ProjectNotFoundError, getProject } from '../../services/projects-service.js';
import { getTask, saveTaskForm, deleteTask, moveTask, TaskNotFoundError, StalePlacementError } from '../../services/tasks-service.js';
import { drainAttachmentCleanup } from '../../services/attachments-service.js';
import { subscribeToBoard } from '../../services/board-realtime.js';
import { onAuthChange } from '../../services/auth-service.js';
import { openTaskFormModal } from '../../components/task-form-modal/task-form-modal.js';
import { openTaskViewModal } from '../../components/task-view-modal/task-view-modal.js';
import { openAddStageModal } from '../../components/add-stage-modal/add-stage-modal.js';
import { createStage } from '../../services/stages-service.js';
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
  const actions = root.querySelector('[data-actions]');
  const filters = boardFiltersFromQuery(ctx.query);
  let filterTimer = 0;
  let filterLoading = false;
  let loadController = null;
  const searchInput = root.querySelector('[data-search]');
  const filterStatus = root.querySelector('[data-filter-status]');
  searchInput.value = filters.search;
  for (const select of root.querySelectorAll('[data-filter]')) if (filters[select.dataset.filter]) select.value = filters[select.dataset.filter];
  const descriptionCache = new WeakMap();
  const filtered = () => hasBoardFilters(filters);
  const plainDescription = (task) => {
    if (!descriptionCache.has(task)) descriptionCache.set(task, htmlToExcerpt(task.description, Infinity));
    return descriptionCache.get(task);
  };
  const visibleTasks = (stage) => stage.tasks.filter(task => matchesBoardTask(task, stage.id, filters, plainDescription(task)));
  let requestId = 0;
  let linkedTaskOpened = false;
  // Bumped whenever cursors may have become invalid (a reload starts, a move, a realtime change). A page
  // request that finishes under an older epoch is discarded, so stale pages are never mixed into the board.
  let boardEpoch = 0;
  let activeLoads = 0;
  let data = null; // { project, stages } as last loaded; each stage carries tasks, taskCount, hasMore, nextCursor
  ctx.setLeaveGuard(() => !moving && (activeDialog?.canLeave?.() ?? true));
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
    for (const sortable of sortables) sortable.option('disabled', active || filtered() || activeLoads > 0);
  }

  function destroySortables() {
    for (const sortable of sortables) sortable.destroy();
    sortables = [];
  }

  const dragExcluded = 'button,a,input,select,textarea,label,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="slider"],[role="combobox"],[role="menu"],[role="menuitem"],[role="radio"],[role="textbox"],[role="tab"],[role="spinbutton"],summary,[tabindex],[data-card-menu],[data-no-drag],.project-label';
  let dragClickPending = false;
  let pointerStartedOnControl = false;
  let dragClickTimer;
  // A new gesture is an intentional click, not the click generated by the previous drag release.
  const clearDragClick = () => { dragClickPending = false; clearTimeout(dragClickTimer); };
  const startGesture = (event) => {
    clearDragClick();
    const card = event.target.closest('.task-card');
    const control = event.target.closest(dragExcluded);
    pointerStartedOnControl = Boolean(card && control && card.contains(control));
  };
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) ctx.cleanup.listen(board, type, startGesture, { capture: true, passive: true });
  ctx.cleanup.listen(board, 'click', (event) => {
    if (!dragClickPending || event.detail === 0) return;
    clearDragClick(); event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  ctx.cleanup.add(clearDragClick);
  // Drag from non-interactive card areas; touch scrolling cancels the hold delay.
  function initSortables() {
    destroySortables();
    sortables = [...board.querySelectorAll('[data-cards]')].map((list) =>
      Sortable.create(list, {
        group: 'board-tasks',
        draggable: '.task-card',
        filter: dragExcluded,
        preventOnFilter: false,
        fallbackTolerance: 4,
        animation: reduceMotion.matches ? 0 : 150,
        ghostClass: 'task-ghost',
        chosenClass: 'task-chosen',
        emptyInsertThreshold: 24,
        // One Sortable fallback path gives mouse/touch the same movement threshold and
        // binds pointercancel, so a touch scroll cannot leave a pending drag behind.
        forceFallback: true,
        disabled: moving || filtered() || activeLoads > 0,
        dragClass: 'task-dragging',
        fallbackClass: 'task-drag-preview',
        delayOnTouchOnly: true,
        delay: 160,
        touchStartThreshold: 5,
        onMove: (event) => {
          board.querySelectorAll('.is-drop-target').forEach(column => column.classList.remove('is-drop-target'));
          event.to.closest('.board-column')?.classList.add('is-drop-target');
          return !filtered() && !moving && activeLoads === 0;
        },
        onStart: () => {
          dragging = true;
          boardEpoch += 1;
          pendingRefresh = pendingRefresh || Boolean(data?.stages.some(stage => stage.loadingMore));
          board.classList.add('is-dragging');
          list.closest('.board-column')?.classList.add('is-drop-target');
        },
        onEnd: (event) => {
          dragClickPending = true;
          clearTimeout(dragClickTimer);
          dragClickTimer = setTimeout(clearDragClick, 500);
          dragging = false;
          board.classList.remove('is-dragging');
          board.querySelectorAll('.is-drop-target').forEach(column => column.classList.remove('is-drop-target'));
          if (event.from === event.to && event.oldIndex === event.newIndex) {
            flushPending();
            return;
          }
          if (filtered()) { load({ quiet: true }); return; }
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

  function fillFilterOptions(select, rows, placeholder, label, selected = select.value) {
    const options = placeholder === null ? [] : [new Option(placeholder, '')];
    options.push(...rows.map(row => new Option(label(row), row.id)));
    if (selected && !rows.some(row => row.id === selected)) options.push(new Option('No longer available', selected));
    select.replaceChildren(...options);
    if (selected) select.value = selected;
  }

  function sizeBoard() {
    if (ctx.signal.aborted) return;
    const description = root.querySelector('[data-project-description]');
    const expanded = description.classList.contains('is-expanded');
    root.querySelector('[data-description-toggle]').hidden = !expanded && description.scrollHeight <= description.clientHeight + 1;
    const height = Math.max(320, Math.min(840, window.innerHeight - Math.max(0, board.getBoundingClientRect().top) - 30));
    root.style.setProperty('--board-column-height', `${height}px`);
  }

  function closeMenus() {
    for (const menu of root.querySelectorAll('[data-action-menu]')) {
      if (menu.matches(':popover-open')) menu.hidePopover();
    }
  }

  function updateToolbar() {
    const active = filtered(); root.classList.toggle('is-filtered', active);
    root.querySelector('[data-drag-notice]').hidden = !active;
    const chips = root.querySelector('[data-filter-chips]'); chips.replaceChildren();
    for (const [key, value] of Object.entries(filters)) {
      if (!value.trim()) continue;
      const chip = document.createElement('span'); chip.className = 'board-filter-chip';
      const select = root.querySelector(`[data-filter="${key}"]`);
      const label = key === 'search' ? `Search: ${value}` : `${key[0].toUpperCase()+key.slice(1)}: ${select?.selectedOptions[0]?.textContent ?? value}`;
      chip.append(document.createTextNode(label));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
      remove.dataset.clearFilter = key; remove.setAttribute('aria-label', `Remove ${label}`); chip.append(remove); chips.append(chip);
    }
    root.querySelector('[data-active-filters]').hidden = !active;
    const count = Object.values(filters).filter(value => value.trim()).length;
    const badge = root.querySelector('[data-filter-count]'); badge.textContent = count; badge.hidden = !count;
    const total = data?.stages.reduce((sum, stage) => sum + stage.taskCount, 0) ?? 0;
    const shown = data?.stages.reduce((sum, stage) => sum + visibleTasks(stage).length, 0) ?? 0;
    setText(root, '[data-result-count]', filterLoading ? 'Searching all tasks…' : active ? `${shown} of ${total} tasks` : `${total} tasks`);
    filterStatus.textContent = filterLoading ? 'Searching all tasks…' : '';
    root.querySelector('[data-no-results]').hidden = !active || shown > 0 || total === 0 || filterLoading;
    for (const sortable of sortables) sortable.option('disabled', moving || active || activeLoads > 0);
  }

  function applyFilters() {
    if (!data || ctx.signal.aborted) return;
    if (isBusy()) { pendingRefresh = true; return; }
    filterLoading = filtered() && data.stages.some(stage => stage.hasMore);
    render(data);
    if (filterLoading || activeLoads > 0) load({ quiet: true });
  }

  function applyDisplay(preferences) {
    root.dataset.density=preferences.density;
    root.dataset.descriptions=preferences.descriptions?'show':'hide';
    root.querySelector('[data-card-density]').value=preferences.density;
    root.querySelector('[data-card-descriptions]').checked=preferences.descriptions;
  }
  applyDisplay(readBoardDisplay());
  ctx.cleanup.listen(root.querySelector('[data-card-density]'),'change',saveDisplay);
  ctx.cleanup.listen(root.querySelector('[data-card-descriptions]'),'change',saveDisplay);
  function saveDisplay() {
    const preferences={density:root.querySelector('[data-card-density]').value,descriptions:root.querySelector('[data-card-descriptions]').checked};
    applyDisplay(preferences);saveBoardDisplay(preferences);
  }
  ctx.cleanup.listen(window,'storage',event=>{if(event.key===BOARD_DISPLAY_KEY||event.key===null)applyDisplay(readBoardDisplay());});

  function setupToolbar() {
    ctx.cleanup.listen(searchInput, 'input', () => {
      filters.search = searchInput.value.trim();
      clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 220);
      // Lock ordering immediately, before the debounced render.
      for (const sortable of sortables) sortable.option('disabled', moving || filtered() || activeLoads > 0);
    });
    ctx.cleanup.listen(root.querySelector('[data-filter-controls]'), 'change', event => {
      if (!event.target.dataset.filter) return;
      filters[event.target.dataset.filter] = event.target.value;
      clearTimeout(filterTimer); applyFilters();
    });
    ctx.cleanup.listen(root, 'click', event => {
      const clear = event.target.closest('[data-clear-filters]');
      const chip = event.target.closest('[data-clear-filter]');
      if (clear || chip) {
        clearTimeout(filterTimer);
        if (clear) Object.assign(filters, EMPTY_BOARD_FILTERS); else filters[chip.dataset.clearFilter] = '';
        searchInput.value = filters.search;
        for (const select of root.querySelectorAll('[data-filter]')) select.value = filters[select.dataset.filter];
        applyFilters(); searchInput.focus();
      }
    });
    ctx.cleanup.listen(root.querySelector('[data-toggle-filters]'), 'click', event => {
      const button = event.currentTarget; const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open)); root.querySelector('[data-filter-controls]').classList.toggle('is-open', open); sizeBoard();
    });
    ctx.cleanup.listen(root.querySelector('[data-description-toggle]'), 'click', event => {
      const button = event.currentTarget; const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded)); button.textContent = expanded ? 'Show less' : 'Read more';
      root.querySelector('[data-project-description]').classList.toggle('is-expanded', expanded); sizeBoard();
    });
    const primaryAdd = () => {
      if (!data?.stages.length) return;
      const stage = data.stages.find(stage => stage.id === filters.stage) ?? data.stages.find(stage => !stage.isDone) ?? data.stages[0];
      runFlow(() => addTask(stage.id), { stageId: stage.id });
    };
    ctx.cleanup.listen(root.querySelector('[data-add-primary]'), 'click', primaryAdd);
    ctx.cleanup.listen(root.querySelector('[data-add-empty]'), 'click', primaryAdd);
    ctx.cleanup.listen(root.querySelector('[data-stage-jump]'), 'change', event => {
      const column = columnFor(event.target.value);
      if (column) board.scrollTo({ left: column.offsetLeft - board.offsetLeft, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
    ctx.cleanup.listen(root, 'beforetoggle', event => {
      const menu = event.target;
      if (!menu.matches('[data-action-menu]') || event.newState !== 'open') return;
      const trigger = root.querySelector(`[popovertarget="${CSS.escape(menu.id)}"]`);
      const rect = trigger.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 208, rect.right - 200))}px`;
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - (menu.id === 'board-project-menu' ? 246 : 190)))}px`;
    }, true);
    ctx.cleanup.listen(root, 'toggle', event => {
      const menu = event.target;
      if (!menu.matches('[data-action-menu]')) return;
      root.querySelector(`[popovertarget="${CSS.escape(menu.id)}"]`)?.setAttribute('aria-expanded', String(event.newState === 'open'));
      if (event.newState === 'open') menu.querySelector('button, a')?.focus();
    }, true);
    ctx.cleanup.listen(root, 'keydown', event => {
      const menu = event.target.closest('[data-action-menu]');
      if (!menu || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const items = [...menu.querySelectorAll('button, a')].filter(item => !item.hidden && !item.disabled);
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next]?.focus();
    });
    ctx.cleanup.listen(window, 'resize', () => { closeMenus(); sizeBoard(); });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(sizeBoard);
      observer.observe(root.querySelector('.board-header')); observer.observe(root.querySelector('.board-toolbar'));
      ctx.cleanup.add(() => observer.disconnect());
    }
  }

  const buildCard = createTaskCard;

  function buildColumn(stage) {
    const column = columnTemplate.content.firstElementChild.cloneNode(true);
    column.dataset.stageId = stage.id;
    const heading = setText(column, '[data-stage-name]', stage.name);
    heading.id = `stage-${stage.id}`;
    column.setAttribute('aria-labelledby', heading.id);

    const visible = visibleTasks(stage);
    const count = setText(column, '[data-stage-count]', filtered() ? `${visible.length} / ${stage.taskCount}` : stage.taskCount.toLocaleString());
    count.setAttribute('aria-label', `${stage.taskCount} ${stage.taskCount === 1 ? 'task' : 'tasks'}`);
    if (stage.isDone) {
      column.classList.add('is-done');
    }

    column.querySelector('[data-cards]').append(...visible.map(buildCard));
    column.querySelector('[data-stage-empty]').hidden = visible.length > 0;
    setText(column, '[data-column-empty-text]', filtered() ? 'No matching tasks' : 'No tasks yet');
    column.querySelector('[data-stage-empty] small').textContent = filtered() ? 'Try adjusting your filters.' : 'Add a task or drop one here.';
    updateColumnFooter(column, stage);

    for (const add of column.querySelectorAll('[data-add]')) {
      add.setAttribute('aria-label', `Add task to ${stage.name}`);
      add.title = `Add task to ${stage.name}`;
    }
    return column;
  }

  // Loading, "load more" and end-of-list indicators of one column.
  function updateColumnFooter(column, stage) {
    const more = column.querySelector('[data-more]');
    const end = column.querySelector('[data-more-end]');
    more.hidden = !stage.hasMore || filtered();
    end.hidden = filtered() || stage.hasMore || stage.tasks.length <= BOARD_PAGE_SIZE;
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
    if (filtered() || !stage || !stage.hasMore || stage.loadingMore || activeLoads > 0 || isBusy() || ctx.signal.aborted) return;

    const epoch = boardEpoch;
    stage.loadingMore = true;
    stage.loadError = false;
    updateColumnFooter(columnFor(stageId), stage);
    let result = null;
    try {
      result = await fetchColumnTasks(stageId, { projectId: params.id, cursor: stage.nextCursor, signal: ctx.signal });
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
    updateToolbar();
    // Overlap means the column moved under us; settle on a fresh snapshot.
    if (fresh.length !== result.tasks.length) scheduleRefresh();
  }

  function render({ project, stages, labels }) {
    const id = encodeURIComponent(project.id);
    setText(root, '[data-heading]', project.title);
    const description = setText(root, '[data-project-description]', project.description);
    root.querySelector('[data-description-wrap]').hidden = !project.description;
    root.querySelector('[data-description-toggle]').hidden = project.description.length < 150 && !project.description.includes('\n');
    root.querySelector('[data-manager-divider]').hidden = !project.canManage;
    root.querySelector('[data-link="labels"]').lastChild.textContent = project.canManage ? ' Manage labels' : ' Labels';
    root.querySelector('[data-add-primary]').disabled = stages.length === 0;
    root.querySelector('[data-add-empty]').disabled = stages.length === 0;
    const taskTotal = stages.reduce((sum, stage) => sum + stage.taskCount, 0);
    const completedTotal = stages.filter(stage => stage.isDone).reduce((sum, stage) => sum + stage.taskCount, 0);
    setText(root, '[data-project-stats]', `${taskTotal} tasks · ${completedTotal} completed · ${stages.length} stages`);
    fillFilterOptions(root.querySelector('[data-filter="stage"]'), stages, 'All stages', stage => stage.name, filters.stage);
    fillFilterOptions(root.querySelector('[data-filter="label"]'), labels ?? [], 'All labels', label => label.name, filters.label);
    const assignees = new Map(stages.flatMap(stage => stage.tasks.flatMap(task => (task.assignees ?? []).map(person => [person.user_id, { id: person.user_id, name: person.label ?? `User ${person.user_id.slice(0,8)}` }]))));
    fillFilterOptions(root.querySelector('[data-filter="assignee"]'), [...assignees.values()].sort((a,b) => a.name.localeCompare(b.name)), 'All people', person => person.name, filters.assignee);
    fillFilterOptions(root.querySelector('[data-stage-jump]'), stages, null, stage => stage.name);

    root.querySelector('[data-link="edit"]').hidden = !project.canManage;
    root.querySelector('[data-link="users"]').hidden = !project.canManage;
    root.querySelector('[data-link="activity"]').href = `/projects/${id}/activity`;
    root.querySelector('[data-link="deadlines"]').href = `/projects/${id}/deadlines`;
    root.querySelector('[data-link="labels"]').href = `/projects/${id}/labels`;
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
    board.hidden = stages.length === 0 && !project.canManage;
    destroySortables();
    const scrollLeft = board.scrollLeft;
    board.replaceChildren(...stages.map(buildColumn));
    if (project.canManage) {
      const addStage = document.createElement('button');
      addStage.type = 'button';
      addStage.className = 'board-add-stage';
      addStage.dataset.addStage = '';
      addStage.textContent = '+ Add Stage';
      board.append(addStage);
    }
    board.scrollLeft = scrollLeft;
    initSortables();
    updateToolbar();
    requestAnimationFrame(sizeBoard);

    for (const column of board.querySelectorAll('.board-column')) {
      const top = scrollTops.get(column.dataset.stageId);
      if (top) column.querySelector('[data-cards]').scrollTop = top;
    }
  }

  ctx.cleanup.listen(board, 'click', event => {
    if (!event.target.closest('[data-add-stage]') || !data?.project.canManage) return;
    runFlow(() => runDialog(() => openAddStageModal({
      stages: data.stages,
      onSave: values => createStage(data.project.id, values),
    })), { addStage: true });
  });

  // `quiet` refreshes in place (after a change) without replacing the board with the loading state.
  // A reload re-reads every column from the top down to the depth currently shown (plus `boost` rows for a column
  // that just received a task), so every cursor is replaced by one taken from the same fresh snapshot.
  async function load({ quiet = false, boost } = {}) {
    loadController?.abort();
    const controller = new AbortController(); loadController = controller;
    const abortLoad = () => controller.abort();
    ctx.signal.addEventListener('abort', abortLoad, { once: true });
    const current = ++requestId;
    closeMenus();
    boardEpoch += 1;
    pendingRefresh = false; // this load already reads the newest state
    if (!quiet) show('loading');
    else { root.setAttribute('aria-busy', 'true'); if (!moving) filterStatus.textContent = filtered() ? 'Searching all tasks…' : 'Updating board…'; }
    const depths = data
      ? new Map(data.stages.map((stage) => [stage.id, stage.tasks.length + (boost?.get(stage.id) ?? 0)]))
      : undefined;
    activeLoads += 1;
    try {
      const loaded = await getBoard(params.id, { signal: controller.signal, depths, complete: filtered(), onProgress: (count) => {
        if (current === requestId && filtered() && !ctx.signal.aborted) filterStatus.textContent = `Searching all tasks… ${count} checked`;
      } });
      // Ignore answers that belong to an older request or to a previously opened project.
      if (current !== requestId || ctx.signal.aborted || controller.signal.aborted || loaded.project.id !== params.id) return;
      data = loaded;
      filterLoading = false;
      render(loaded);
      show('board');
      if (ctx.query.add === '1' && !linkedTaskOpened && loaded.stages.length) {
        linkedTaskOpened = true;
        const stage = loaded.stages.find(stage => !stage.isDone) ?? loaded.stages[0];
        runFlow(() => addTask(stage.id), { stageId: stage.id });
      }
      if (ctx.query.task && !linkedTaskOpened) {
        linkedTaskOpened = true;
        openLinkedTask(ctx.query.task);
      }
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted || controller.signal.aborted) return;
      filterLoading = false;
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
      if (current === requestId && !ctx.signal.aborted) root.setAttribute('aria-busy', 'false');
      ctx.signal.removeEventListener('abort', abortLoad);
      if (!ctx.signal.aborted) for (const sortable of sortables) sortable.option('disabled', moving || filtered() || activeLoads > 0);
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
    const status = root.querySelector('[data-live-status]');
    status.textContent = online ? 'Live updates connected' : 'Live updates paused · reconnecting';
    status.classList.toggle('is-offline', !online);
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
    } catch (error) {
      if (!ctx.signal.aborted) showError(error.message || 'Could not complete this action.');
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

  function restoreFocus({ taskId, stageId, addStage } = {}) {
    const selector = addStage ? '[data-add-stage]' : taskId
      ? `[data-task-id="${CSS.escape(taskId)}"] [data-open-task]`
      : `[data-stage-id="${CSS.escape(stageId ?? '')}"] [data-add]`;
    const target = root.querySelector(selector) ?? root.querySelector('[data-add-primary]') ?? root.querySelector('h1');
    target?.focus({ preventScroll: Boolean(addStage) });
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
      await saveTaskForm({ projectId: data.project.id, taskId, ...values });
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
        projectId: data.project.id,
        stages: data.stages,
        stageId,
        onSubmit: (values) => save(null, values),
      }),
    );

  const editTask = (found) =>
    runDialog(() =>
      openTaskFormModal({
        mode: 'edit',
        projectId: data.project.id,
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

  async function openLinkedTask(taskId) {
    try {
      const task = await getTask(taskId, { projectId: params.id, signal: ctx.signal });
      if (ctx.signal.aborted) return;
      if (task.projectId !== data?.project.id) throw new TaskNotFoundError();
      const stage = data.stages.find((candidate) => candidate.id === task.stageId);
      if (!stage) throw new TaskNotFoundError();
      await runFlow(async () => {
        const found = { task, stage };
        const action = await runDialog(() => openTaskViewModal({ ...found, projectId: task.projectId, stages: data.stages, onSave: values => save(task.id, values) }));
        if (ctx.signal.aborted) return false;
        if (action === 'delete') return removeTask(found);
        return true;
      }, { taskId });
    } catch (error) {
      if (!ctx.signal.aborted) showError(error.message);
    }
  }

  async function viewTask(taskId) {
    const found = findTask(taskId);
    if (!found) return false;
    const action = await runDialog(() => openTaskViewModal({ ...found, projectId: data.project.id, stages: data.stages, onSave: values => save(taskId, values) }));
    if (ctx.signal.aborted) return false;
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
      closeMenus();
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
    const card = event.target.closest('.task-card');
    const open = event.target.closest('[data-open-task]');
    const control = event.target.closest(dragExcluded);
    if (!open && event.detail > 0 && pointerStartedOnControl) return;
    if (card && (open || !control || !card.contains(control))) {
      closeMenus();
      const taskId = card.dataset.taskId;
      runFlow(() => viewTask(taskId), { taskId });
    }
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  setupToolbar();
  ctx.cleanup.add(() => activeDialog?.destroy());
  ctx.cleanup.add(destroySortables);
  ctx.cleanup.add(() => loadController?.abort());
  ctx.cleanup.add(() => clearTimeout(filterTimer));
  ctx.cleanup.add(closeMenus);
  ctx.cleanup.add(() => clearTimeout(refreshTimer));

  // Subscribe only while this page is mounted. After every (re)join a fresh load closes any gap.
  realtime = subscribeToBoard(params.id, {
    onNotify: (kind) => {
      if (ctx.signal.aborted) return;
      boardEpoch += 1; // invalidate in-flight pages immediately, even if the reload itself is deferred
      if (activeLoads > 0) loadController?.abort();
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
  const deadlineTimer = setInterval(() => {
    const tasks = new Map((data?.stages ?? []).flatMap((stage) => stage.tasks.map((task) => [task.id, task])));
    for (const card of board.querySelectorAll('[data-task-id]')) {
      const task = tasks.get(card.dataset.taskId);
      if (task) renderCardDeadline(card.querySelector('[data-deadline]'), task);
    }
  }, 30000);
  ctx.cleanup.add(() => clearInterval(deadlineTimer));
  load();
}
