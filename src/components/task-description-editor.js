import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { sanitizeRichText } from '../utils/sanitize.js';

export function createTaskDescriptionEditor(host, { value = '', labelId, errorId }) {
  const editor = new Quill(host, {
    theme: 'snow',
    formats: ['bold', 'italic', 'underline', 'strike', 'link', 'list', 'blockquote'],
    modules: { toolbar: [
      ['bold', 'italic', 'underline', 'strike'], ['link'],
      [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote'], ['clean'],
    ] },
    placeholder: 'Add details…',
  });
  editor.root.setAttribute('aria-labelledby', labelId);
  editor.root.setAttribute('aria-describedby', errorId);
  editor.root.setAttribute('role', 'textbox');
  editor.root.setAttribute('aria-multiline', 'true');
  if (value) editor.setContents(editor.clipboard.convert({ html: sanitizeRichText(value) }), 'silent');
  return editor;
}
