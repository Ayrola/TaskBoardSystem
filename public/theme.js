// Blocking head script: also the single theme service used by the application.
(() => {
  const key = 'taskboard:theme';
  const valid = (value) => ['light', 'dark', 'system'].includes(value);
  const media = matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  let preference = 'system';
  try { const stored = localStorage.getItem(key); if (valid(stored)) preference = stored; } catch { /* Storage is optional. */ }
  const snapshot = () => ({ preference, resolved: preference === 'system' ? (media.matches ? 'dark' : 'light') : preference });
  function apply() {
    const state = snapshot();
    document.documentElement.dataset.bsTheme = state.resolved;
    document.documentElement.style.colorScheme = state.resolved;
    document.documentElement.style.backgroundColor = state.resolved === 'dark' ? '#111923' : '#ffffff';
    listeners.forEach((listener) => listener(state));
  }
  window.TaskboardTheme = Object.freeze({
    get: snapshot,
    set(value) {
      if (!valid(value)) return;
      preference = value;
      try { value === 'system' ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* Keep the in-memory choice. */ }
      apply();
    },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : 'system'; apply();
  });
  apply();
})();
