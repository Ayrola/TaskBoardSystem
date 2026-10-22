// Shared auth service. The single place that talks to Supabase Auth.
// Passwords only pass through function arguments; nothing is stored by this app.
let clientPromise = null;
let configError = null;
let initPromise = null;
let ready = false;

const state = { session: null, userId: null, epoch: 0 };
const listeners = new Set();

// Loaded lazily so a missing configuration degrades to "signed out" instead of breaking the shell.
function loadClient() {
  clientPromise ??= import('./supabase-client.js')
    .then((module) => module.supabaseClient)
    .catch((error) => {
      configError = error.message;
      console.warn(error.message);
      return null;
    });
  return clientPromise;
}

// Returns true when the signed-in user changed (sign-in, sign-out or account switch).
function applySession(session) {
  const nextUserId = session?.user?.id ?? null;
  const userChanged = nextUserId !== state.userId;
  state.session = session ?? null;
  if (userChanged) {
    state.userId = nextUserId;
    state.epoch += 1;
  }
  return userChanged;
}

// Restores the stored session once and subscribes to later changes. Safe to call repeatedly.
export function initAuth() {
  initPromise ??= (async () => {
    try {
      const client = await loadClient();
      if (!client) return;
      const { data, error } = await client.auth.getSession();
      if (error) console.error('Could not restore session', error.message);
      applySession(data?.session);

      client.auth.onAuthStateChange((event, session) => {
        const userChanged = applySession(session);
        // Deferred: Supabase advises against calling its APIs inside this callback.
        setTimeout(() => {
          for (const listener of [...listeners]) listener({ event, session: state.session, userChanged });
        }, 0);
      });
    } finally {
      ready = true;
    }
  })();
  return initPromise;
}

export const isAuthReady = () => ready;
export const getCurrentSession = () => state.session;
export const getCurrentUser = () => state.session?.user ?? null;
// Changes whenever the signed-in user changes; capture it before a request to detect stale results.
export const getAuthEpoch = () => state.epoch;
export const getAuthConfigError = () => configError;

export async function getSession() {
  await initAuth();
  return state.session;
}

// listener({ event, session, userChanged }). Returns an unsubscribe function.
export function onAuthChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onSessionChange(listener) {
  return onAuthChange(({ session }) => listener(session));
}

async function requireClient() {
  const client = await loadClient();
  if (!client) return { client: null, error: new Error(configError ?? 'Supabase is not configured.') };
  return { client, error: null };
}

export async function signIn(email, password) {
  const { client, error: configProblem } = await requireClient();
  if (!client) return { error: configProblem };
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { session: data?.session ?? null, error };
}

// With email confirmation enabled Supabase returns a user but no session.
export async function signUp(email, password) {
  const { client, error: configProblem } = await requireClient();
  if (!client) return { error: configProblem };
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${location.origin}/login` },
  });
  if (error) return { error };
  const session = data.session ?? null;
  return { session, needsConfirmation: !session };
}

export async function signOut() {
  const { client } = await requireClient();
  if (!client) return { error: null };
  // 'local' ends this browser's session without revoking the user's other devices.
  return client.auth.signOut({ scope: 'local' });
}

// Maps Supabase errors to messages that are safe and useful to show.
export function describeAuthError(error) {
  const code = error?.code;
  const messages = {
    invalid_credentials: 'Incorrect email or password.',
    email_not_confirmed: 'Please confirm your email address first. Check your inbox for the link.',
    user_already_exists: 'An account with this email already exists. Try logging in instead.',
    weak_password: 'That password is too weak. Use at least 6 characters.',
    signup_disabled: 'New registrations are currently disabled.',
    over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
    over_email_send_rate_limit: 'Too many emails were sent. Please wait a while and try again.',
    validation_failed: 'Please check the email and password you entered.',
  };
  if (messages[code]) return messages[code];
  if (error?.message === 'Invalid login credentials') return messages.invalid_credentials;
  if (error?.message === 'User already registered') return messages.user_already_exists;
  if (error?.message?.startsWith('Supabase is not configured')) return error.message;
  if (error?.name === 'AuthRetryableFetchError' || error instanceof TypeError) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
