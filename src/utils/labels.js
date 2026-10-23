// WCAG relative luminance: choose the higher-contrast black/white foreground.
// One of these always exceeds 4.5:1 on an opaque sRGB background.
export function labelTextColour(colour) {
  const hex = /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#2563eb';
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

export function labelBadge(label) {
  const badge = document.createElement('span');
  badge.className = 'badge rounded-pill text-wrap text-break project-label';
  badge.textContent = label.name;
  badge.style.backgroundColor = label.colour;
  badge.style.color = labelTextColour(label.colour);
  return badge;
}
