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

export function validatePasswordConfirmation(password, confirmation) {
  return password === confirmation ? null : 'Passwords do not match.';
}
