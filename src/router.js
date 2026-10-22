// Single client-side router (History API). Routes are added as pages are implemented.
const routes = [];

let outlet = null;

export function navigate(path) {
  history.pushState({}, '', path);
  render();
}

function render() {
  if (!outlet) return;
  const match = routes.find((r) => r.path === location.pathname);
  outlet.textContent = match ? '' : 'Page not found';
}

export function startRouter(container) {
  outlet = container;
  window.addEventListener('popstate', render);
  render();
}
