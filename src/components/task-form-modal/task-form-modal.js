import { openTaskForm } from '../task-form/task-form.js';
export const openTaskFormModal = ({ mode, onSubmit, ...options }) => openTaskForm({ ...options, allowDelete: false, mode: mode === 'edit' ? 'edit' : 'create', onSave: onSubmit });
