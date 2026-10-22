// Trusted, manual, one-time bootstrap of an admin. Run from a trusted machine only:
//   npm run bootstrap-admin -- <user-uuid>
// The user must be given explicitly (no "first account" guessing). Uses the privileged key from
// .env.seed / the environment, which must never be exposed to the browser. There is no public
// "become admin" operation: this script and direct SQL by a project owner are the only paths.
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`Bootstrap aborted: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const demote = process.argv.includes('--demote');
if (args.length !== 1 || !UUID.test(args[0])) {
  fail('pass exactly one user UUID: npm run bootstrap-admin -- <user-uuid> [--demote]');
}
const userId = args[0].toLowerCase();

if (existsSync('.env.seed')) process.loadEnvFile('.env.seed');
const url = process.env.SEED_SUPABASE_URL?.trim();
const serviceKey = process.env.SEED_SERVICE_ROLE_KEY?.trim();
const expectedRef = process.env.SEED_PROJECT_REF?.trim();
const missing = [
  !url && 'SEED_SUPABASE_URL',
  !serviceKey && 'SEED_SERVICE_ROLE_KEY',
  !expectedRef && 'SEED_PROJECT_REF',
].filter(Boolean);
if (missing.length) fail(`missing ${missing.join(', ')} (see .env.seed).`);

let host;
try {
  host = new URL(url).hostname;
} catch {
  fail('SEED_SUPABASE_URL is not a valid URL.');
}
const ref = /^([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1];
if (!ref || ref !== expectedRef) fail('SEED_SUPABASE_URL does not match SEED_PROJECT_REF.');
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('VITE_') && value === serviceKey) fail(`${name} contains the privileged key.`);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: found, error: lookupError } = await admin.auth.admin.getUserById(userId);
if (lookupError || !found?.user) fail('no user with that UUID exists in this project.');

const role = demote ? 'user' : 'admin';
const { error } = await admin
  .from('user_roles')
  .upsert({ user_id: userId, role }, { onConflict: 'user_id' });
if (error) fail(`could not set the role: ${error.message}`);

console.log(`User ${userId} (${found.user.email ?? 'no email'}) now has role "${role}" on project ${ref}.`);
