import { openTaskForm } from '../task-form/task-form.js';
export const openTaskViewModal = options => openTaskForm({ ...options, mode: 'edit' });
