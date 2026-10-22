const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// Only for trusted, static HTML fragments imported with ?raw. Never pass user data.
export function renderFragment(container, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  container.replaceChildren(template.content);
}

// Safe way to place dynamic values into a rendered fragment.
export function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = String(value ?? '');
  return element;
}
