import { themeService } from '../../services/theme-service.js';
export function mountThemeSelector(host) {
  host.classList.add('theme-selector'); host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Colour theme');
  for (const [value, label, icon] of [['light','Light','sun'],['dark','Dark','moon-stars'],['system','System','display']]) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.themePreference = value;
    button.setAttribute('aria-label', `${label} theme`); button.title = `${label} theme`;
    const glyph = document.createElement('i'); glyph.className = `bi bi-${icon}`; glyph.setAttribute('aria-hidden','true');
    const text = document.createElement('span'); text.className = 'theme-label'; text.textContent = label;
    button.append(glyph, text); host.append(button);
  }
  const stop = themeService.subscribe(({ preference }) => host.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themePreference === preference))));
  const click = (event) => { const button = event.target.closest('[data-theme-preference]'); if (button) themeService.set(button.dataset.themePreference); };
  host.addEventListener('click',click);
  return () => { stop(); host.removeEventListener('click',click); host.replaceChildren(); };
}
