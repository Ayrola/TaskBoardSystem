const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// Plain-text excerpt of stored (sanitized) rich HTML. The markup is parsed in an inert document
// (no scripts run, no resources load) and only its text is used, so nothing is ever injected as HTML.
export function htmlToExcerpt(value, maxLength = 140) {
  const source = String(value ?? '');
  if (!source) return '';
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('script, style, template').forEach((node) => node.remove());
  // Keep words in adjacent blocks apart ("<p>a</p><p>b</p>" -> "a b").
  doc.querySelectorAll('br, p, div, li, h1, h2, h3, h4, h5, h6, tr').forEach((node) => node.append(' '));
  const text = doc.body.textContent.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
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
