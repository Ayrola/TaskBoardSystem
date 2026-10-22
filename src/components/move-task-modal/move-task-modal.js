import html from './move-task-modal.html?raw';
import { mountModal } from '../../utils/modal-host.js';
import { setText } from '../../utils/render.js';

const LABEL_MAX = 40;

const shorten = (text) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text);

// Keyboard- and screen-reader-friendly alternative to dragging.
// `result` resolves { stageId, index } (index within the LOADED tasks of the destination without this task, so the
// caller can turn it into "after task X"), { stageId, toEnd: true } (after every task of the column, loaded or
// not), or null when cancelled or nothing would change. A column that is only partly loaded offers both
// "after the last loaded task" and "end of the stage".
export function openMoveTaskModal({ task, stages }) {
  const modal = mountModal(html, { dismissedValue: null });
  const { element, signal } = modal;
  const stageSelect = element.querySelector('[data-stage]');
  const positionSelect = element.querySelector('[data-position]');
  const form = element.querySelector('form');

  setText(element, '[data-task-title]', task.title);

  for (const stage of stages) stageSelect.add(new Option(stage.name, stage.id));
  stageSelect.value = task.stageId;

  const stageOf = (stageId) => stages.find((stage) => stage.id === stageId);
  const othersOf = (stageId) => (stageOf(stageId)?.tasks ?? []).filter((candidate) => candidate.id !== task.id);

  function fillPositions(preferredIndex) {
    const others = othersOf(stageSelect.value);
    const partial = Boolean(stageOf(stageSelect.value)?.hasMore);
    positionSelect.replaceChildren();
    for (let index = 0; index <= others.length; index += 1) {
      let label;
      if (others.length === 0) label = '1 (only task)';
      else if (index === 0) label = '1 (top of the stage)';
      else label = `${index + 1} (after “${shorten(others[index - 1].title)}”)`;
      if (partial && index === others.length && index > 0) label += ' – last loaded task';
      positionSelect.add(new Option(label, String(index)));
    }
    if (partial) positionSelect.add(new Option('End of the stage (after all tasks, including unloaded)', 'end'));
    positionSelect.value = preferredIndex === 'end' || (preferredIndex === undefined && partial)
      ? 'end'
      : String(preferredIndex ?? others.length);
  }

  const originalStage = stageOf(task.stageId);
  const originalIndex = Math.max(0, originalStage?.tasks.findIndex((candidate) => candidate.id === task.id) ?? 0);
  fillPositions(originalIndex);

  stageSelect.addEventListener('change', () => {
    fillPositions(stageSelect.value === task.stageId ? originalIndex : undefined);
  }, { signal });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const stageId = stageSelect.value;
    if (positionSelect.value === 'end') {
      modal.close({ stageId, toEnd: true });
      return;
    }
    const index = Number(positionSelect.value);
    const unchanged = stageId === task.stageId && index === originalIndex;
    modal.close(unchanged ? null : { stageId, index });
  }, { signal });

  element.addEventListener('shown.bs.modal', () => stageSelect.focus(), { signal });

  modal.show();
  return { result: modal.result, destroy: modal.destroy };
}
