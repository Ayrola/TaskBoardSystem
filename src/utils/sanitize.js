import DOMPurify from 'dompurify';

// Rich-text policy for task descriptions (the only place this is defined).
//
// Allowed tags:       p, br, strong, em, u, s, blockquote, ul, ol, li, a
// Allowed attributes: href (on <a> only); target and rel are forced on every link.
// Allowed link URLs:  http:, https:, mailto:
//
// Everything else is removed: scripts, styles, iframes/embeds/objects, images and other media,
// forms, SVG/MathML, inline styles, classes, ids, event handlers, data-* and aria-* attributes,
// and links with javascript:, data:, vbscript:, relative or malformed URLs. The text of a removed
// formatting tag is kept; the content of script-like and embedded elements is dropped.
// The same policy is applied before saving and again before rendering.
export const RICH_TEXT_ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'a'];
export const RICH_TEXT_MAX_LENGTH = 100000; // matches tasks_description_length in the database

const PURIFY_CONFIG = {
  ALLOWED_TAGS: RICH_TEXT_ALLOWED_TAGS,
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

// Isolated instance so the hook never affects other DOMPurify users.
const purify = DOMPurify(window);
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

// Returns sanitized HTML as a string, for storage. Empty content (e.g. Quill's "<p><br></p>") becomes ''.
export function sanitizeRichText(value) {
  const source = String(value ?? '');
  if (!source.trim()) return '';
  const clean = purify.sanitize(source, PURIFY_CONFIG);
  return hasContent(clean) ? clean : '';
}

// Returns a DocumentFragment of sanitized nodes, for display. Append it with append()/replaceChildren();
// stored HTML is never assigned to innerHTML.
export function richTextToFragment(value) {
  return purify.sanitize(String(value ?? ''), { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
}

function hasContent(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent.trim() !== '';
}
