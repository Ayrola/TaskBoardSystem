import html from './project-form.html?raw';
import './project-form.css';
import { renderFragment, setText } from '../../utils/render.js';

// Serves both /projects/add and /projects/:id/edit.
export const title = ({ params }) => (params.id ? 'Edit project' : 'Add project');

export function mount(container, { params }) {
  renderFragment(container, html);
  setText(container, '[data-heading]', params.id ? 'Edit project' : 'Add project');
  if (params.id) {
    setText(container, '[data-project-id]', params.id);
    container.querySelector('[data-id-note]').hidden = false;
  }
}
