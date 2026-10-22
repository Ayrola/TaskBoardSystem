// Limits mirror the bucket configuration and table constraints in the task_attachments migration.
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_FILENAME_MAX = 255;

export const ATTACHMENT_TYPES = {
  'image/png': 'Image',
  'image/jpeg': 'Image',
  'image/gif': 'Image',
  'image/webp': 'Image',
  'application/pdf': 'PDF',
  'text/plain': 'Text',
  'text/csv': 'CSV',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
};

// Value for <input type="file" accept>.
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).join(',');

export const ATTACHMENT_HELP =
  'Screenshots (PNG, JPEG, GIF, WebP) and documents (PDF, Word, Excel, TXT, CSV), up to 10 MB each.';

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatFileSize(bytes) {
  let value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}

// The name is stored as display metadata only (never in a storage path). Still, strip path
// separators and control characters so it is harmless wherever it is shown or used as a download name.
export function cleanFilename(name) {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= ATTACHMENT_FILENAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, ATTACHMENT_FILENAME_MAX - extension.length) + extension;
}

// Returns an error message, or null when the file may be uploaded.
export function validateAttachmentFile(file) {
  if (!file) return 'Choose a file to upload.';
  if (!cleanFilename(file.name)) return 'This file has no usable name.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > ATTACHMENT_MAX_BYTES) return `This file is larger than ${formatFileSize(ATTACHMENT_MAX_BYTES)}.`;
  if (!Object.hasOwn(ATTACHMENT_TYPES, file.type)) {
    return 'This file type is not supported. Upload an image, PDF, Word, Excel, text or CSV file.';
  }
  return null;
}
