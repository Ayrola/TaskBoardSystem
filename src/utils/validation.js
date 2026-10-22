const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Each validator returns an error message, or null when the value is valid.
export function validateEmail(value) {
  const email = String(value ?? '').trim();
  if (!email) return 'Enter your email address.';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validateLoginPassword(value) {
  return value ? null : 'Enter your password.';
}

export function validateNewPassword(value) {
  if (!value) return 'Choose a password.';
  if (value.length < 6) return 'Password must be at least 6 characters.';
  if (value.length > 72) return 'Password must be at most 72 characters.';
  return null;
}

export const PROJECT_TITLE_MAX = 200;
export const PROJECT_DESCRIPTION_MAX = 2000;

export function validateProjectTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) return 'Enter a project title.';
  if (title.length > PROJECT_TITLE_MAX) return `Title must be at most ${PROJECT_TITLE_MAX} characters.`;
  return null;
}

export function validateProjectDescription(value) {
  const length = String(value ?? '').trim().length;
  return length > PROJECT_DESCRIPTION_MAX
    ? `Description must be at most ${PROJECT_DESCRIPTION_MAX} characters.`
    : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ''));
}

export const TASK_TITLE_MAX = 200;

export function validateTaskTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) return 'Enter a task title.';
  if (title.length > TASK_TITLE_MAX) return `Title must be at most ${TASK_TITLE_MAX} characters.`;
  return null;
}

export function validateTaskStage(value) {
  return isUuid(value) ? null : 'Choose a stage.';
}

export function validatePasswordConfirmation(password, confirmation) {
  return password === confirmation ? null : 'Passwords do not match.';
}
