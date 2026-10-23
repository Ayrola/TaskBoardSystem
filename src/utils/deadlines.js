export function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
export function validTimezone(value) {
  try { return Boolean(value) && new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone.length > 0; }
  catch { return false; }
}
export function displayTimezone() {
  try {
    const saved = localStorage.getItem('taskboard.deadlineTimezone');
    if (validTimezone(saved)) return saved;
  } catch { /* Storage may be unavailable. */ }
  return browserTimezone();
}
export function saveDisplayTimezone(value) {
  if (!validTimezone(value)) throw new Error('Choose a valid IANA timezone, such as Europe/Sofia.');
  try { localStorage.setItem('taskboard.deadlineTimezone', value); } catch { /* URL retains the selection. */ }
}
export function formatDeadline(value, timeZone = displayTimezone()) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(value));
}
export function isOverdue(task, now = Date.now()) {
  return !task.done && Boolean(task.dueAt) && new Date(task.dueAt).getTime() < now;
}
const pad = (n) => String(n).padStart(2, '0');
export function toLocalDeadlineInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function fromLocalDeadlineInput(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid deadline date and time.');
  const date = new Date(value);
  // Reject nonexistent wall times rather than silently moving them across a DST jump.
  if (!Number.isFinite(date.getTime()) || toLocalDeadlineInput(date) !== value) {
    throw new Error('This local time does not exist. Choose a valid date and time.');
  }
  return date.toISOString();
}
// Preserve the original instant (seconds and DST-fold offset) when only other fields were edited.
export function deadlineFromEditor(value, original) {
  return original && value === toLocalDeadlineInput(original) ? original : fromLocalDeadlineInput(value);
}
export function renderTaskDeadline(element, task) {
  const overdue = isOverdue(task);
  element.hidden = !task.dueAt;
  element.textContent = task.dueAt ? `${overdue ? 'Overdue · ' : 'Due '}${formatDeadline(task.dueAt)}` : '';
  element.classList.toggle('text-danger', overdue);
  element.classList.toggle('fw-semibold', overdue);
}
