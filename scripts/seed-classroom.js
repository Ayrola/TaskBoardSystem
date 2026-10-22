// Server-side classroom seed. Run with: npm run seed:dry  |  npm run seed
// Privileged configuration is read only from process.env / a local .env.seed file.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SEED_NAMESPACE = '6f1d3c52-8a4b-4e0e-9d7a-2b5c1f0a7e34';
const SEED_MARKER = 'taskboard-classroom-seed';

const DEMO_USERS = [
  { key: 'steve', email: 'steve@gmail.com', password: 'pass123' },
  { key: 'maria', email: 'maria@gmail.com', password: 'pass123' },
  { key: 'peter', email: 'peter@gmail.com', password: 'pass123' },
];

const STAGES = [
  { name: 'Not Started', is_done: false },
  { name: 'In Progress', is_done: false },
  { name: 'Done', is_done: true },
];

// `split` is how many tasks go to Not Started / In Progress / Done (12 in total).
const PROJECTS = [
  {
    slug: 'website-redesign',
    owner: 'steve',
    title: 'Website Redesign',
    description: 'Refresh the fictional Northwind Bakery website.',
    split: [5, 4, 3],
    tasks: [
      'Audit current pages', 'Collect customer feedback', 'Draft sitemap', 'Choose colour palette',
      'Write homepage copy', 'Design homepage mockup', 'Build navigation component',
      'Optimise product images', 'Set up contact form', 'Review accessibility',
      'Publish staging site', 'Archive old assets',
    ],
  },
  {
    slug: 'mobile-app-launch',
    owner: 'steve',
    title: 'Mobile App Launch',
    description: 'Ship the first version of the fictional Pocket Planner app.',
    split: [4, 4, 4],
    tasks: [
      'Finalise feature list', 'Plan beta programme', 'Prepare store listing', 'Draft privacy notice',
      'Implement onboarding flow', 'Add offline mode', 'Fix login crash', 'Translate app strings',
      'Create app icon', 'Set up crash reporting', 'Record demo video', 'Submit to review',
    ],
  },
  {
    slug: 'marketing-campaign',
    owner: 'maria',
    title: 'Spring Marketing Campaign',
    description: 'Plan and run a fictional spring promotion for Juniper Tea Co.',
    split: [6, 3, 3],
    tasks: [
      'Define campaign goals', 'Research target audience', 'Set budget', 'Plan content calendar',
      'Brief the designer', 'Shortlist influencers', 'Write email series', 'Produce social posts',
      'Build landing page', 'Create discount codes', 'Book newsletter slot', 'Prepare launch report',
    ],
  },
  {
    slug: 'office-relocation',
    owner: 'peter',
    title: 'Office Relocation',
    description: 'Move the fictional Harbor Studio team to a new office.',
    split: [3, 5, 4],
    tasks: [
      'Confirm moving date', 'Collect quotes from movers', 'Assign desk layout', 'Order new furniture',
      'Notify clients of address', 'Update company records', 'Pack archive room', 'Label equipment',
      'Arrange internet install', 'Return old keys', 'Book cleaning service', 'Plan welcome lunch',
    ],
  },
];

// Deterministic UUID v5 so reruns resolve to the same records without a marker column.
function uuidV5(name) {
  const ns = Buffer.from(SEED_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Builds rows without owner ids; owners are resolved from Auth at run time.
export function buildPlan() {
  const projects = [];
  const stages = [];
  const tasks = [];

  for (const def of PROJECTS) {
    const projectId = uuidV5(`project:${def.slug}`);
    projects.push({ id: projectId, owner: def.owner, title: def.title, description: def.description });

    const stageIds = STAGES.map((stage, index) => {
      const id = uuidV5(`stage:${def.slug}:${index}`);
      stages.push({ id, project_id: projectId, name: stage.name, position: index, is_done: stage.is_done });
      return id;
    });

    let cursor = 0;
    def.split.forEach((count, stageIndex) => {
      for (let position = 0; position < count; position++, cursor++) {
        const title = def.tasks[cursor];
        tasks.push({
          id: uuidV5(`task:${def.slug}:${cursor}`),
          project_id: projectId,
          stage_id: stageIds[stageIndex],
          title,
          description: `<p>${title}. Demo task for the classroom seed.</p>`,
          position,
          done: STAGES[stageIndex].is_done,
        });
      }
    });
  }
  return { projects, stages, tasks };
}

function fail(message) {
  console.error(`Seed aborted: ${message}`);
  process.exit(1);
}

function readConfig() {
  if (existsSync('.env.seed')) process.loadEnvFile('.env.seed');

  const url = process.env.SEED_SUPABASE_URL?.trim();
  const serviceKey = process.env.SEED_SERVICE_ROLE_KEY?.trim();
  const expectedRef = process.env.SEED_PROJECT_REF?.trim();

  const missing = [
    !url && 'SEED_SUPABASE_URL',
    !serviceKey && 'SEED_SERVICE_ROLE_KEY',
    !expectedRef && 'SEED_PROJECT_REF',
  ].filter(Boolean);
  if (missing.length) {
    fail(`missing ${missing.join(', ')}. Copy .env.seed.example to .env.seed and fill it in.`);
  }

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    fail('SEED_SUPABASE_URL is not a valid URL.');
  }
  const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (!match) fail('SEED_SUPABASE_URL must look like https://<project-ref>.supabase.co.');
  if (match[1] !== expectedRef) {
    fail(`URL project reference "${match[1]}" does not match SEED_PROJECT_REF "${expectedRef}".`);
  }

  // Legacy JWT keys carry the project ref; new-style secret keys are opaque and skipped.
  if (serviceKey.split('.').length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url').toString());
      if (claims.ref && claims.ref !== expectedRef) fail('the service key belongs to a different project.');
      if (claims.role && claims.role !== 'service_role') fail('SEED_SERVICE_ROLE_KEY is not a service role key.');
    } catch {
      /* not a decodable JWT; rely on the URL check */
    }
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('VITE_') && value === serviceKey) {
      fail(`a VITE_ variable (${name}) contains the privileged key; it would be exposed to the browser.`);
    }
  }

  return { url, serviceKey, ref: expectedRef };
}

async function findUsersByEmail(admin) {
  const found = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing users failed: ${error.message}`);
    for (const user of data.users) found.set(user.email?.toLowerCase(), user.id);
    if (data.users.length < 1000) return found;
  }
}

async function existingIds(admin, table, ids) {
  const { data, error } = await admin.from(table).select('id').in('id', ids);
  if (error) throw new Error(`reading ${table} failed: ${error.message}`);
  return new Set(data.map((row) => row.id));
}

async function insertMissing(admin, table, rows, dryRun) {
  const present = await existingIds(admin, table, rows.map((row) => row.id));
  const missing = rows.filter((row) => !present.has(row.id));
  if (!dryRun && missing.length) {
    const { error } = await admin.from(table).upsert(missing, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`inserting into ${table} failed: ${error.message}`);
  }
  return { created: missing.length, skipped: rows.length - missing.length };
}

async function verify(admin, plan) {
  const ids = plan.projects.map((p) => p.id);
  const { data: stages, error: stageError } = await admin.from('project_stages').select('id,is_done').in('project_id', ids);
  const { data: tasks, error: taskError } = await admin
    .from('tasks')
    .select('stage_id,position,done')
    .in('project_id', ids);
  if (stageError || taskError) throw new Error('verification query failed');

  const stageDone = new Map(stages.map((s) => [s.id, s.is_done]));
  const inconsistentDone = tasks.filter((t) => t.done !== stageDone.get(t.stage_id)).length;
  const positionsByStage = new Map();
  for (const t of tasks) positionsByStage.set(t.stage_id, [...(positionsByStage.get(t.stage_id) ?? []), t.position]);
  const badPositions = [...positionsByStage.values()].filter(
    (list) => list.sort((a, b) => a - b).some((value, index) => value !== index),
  ).length;
  return { inconsistentDone, badPositions };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = readConfig();
  const plan = buildPlan();

  console.log(`${dryRun ? 'DRY RUN' : 'EXECUTE'} against project ref ${config.ref}`);

  const admin = createClient(config.url, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const counts = { users: { created: 0, skipped: 0 } };
  const usersByEmail = await findUsersByEmail(admin);
  const ownerIds = new Map();

  for (const demo of DEMO_USERS) {
    const existing = usersByEmail.get(demo.email);
    if (existing) {
      ownerIds.set(demo.key, existing);
      counts.users.skipped++;
      continue;
    }
    counts.users.created++;
    if (dryRun) continue;
    // email_confirm marks the address confirmed, so no confirmation email is sent.
    const { data, error } = await admin.auth.admin.createUser({
      email: demo.email,
      password: demo.password,
      email_confirm: true,
      user_metadata: { seed: SEED_MARKER },
    });
    if (error) throw new Error(`creating ${demo.email} failed: ${error.message}`);
    ownerIds.set(demo.key, data.user.id);
  }

  const projectRows = plan.projects.map(({ owner, ...rest }) => ({ ...rest, owner_id: ownerIds.get(owner) }));
  if (dryRun) {
    // Owners that do not exist yet have no id, so their projects cannot already exist.
    const known = projectRows.filter((row) => row.owner_id);
    const present = known.length ? await existingIds(admin, 'projects', known.map((r) => r.id)) : new Set();
    counts.projects = { created: projectRows.length - present.size, skipped: present.size };
  } else {
    counts.projects = await insertMissing(admin, 'projects', projectRows, false);
  }
  counts.project_stages = await insertMissing(admin, 'project_stages', plan.stages, dryRun);
  counts.tasks = await insertMissing(admin, 'tasks', plan.tasks, dryRun);

  const verb = dryRun ? 'would create' : 'created';
  for (const [name, { created, skipped }] of Object.entries(counts)) {
    console.log(`${name.padEnd(15)} ${verb}: ${created}  skipped: ${skipped}`);
  }

  if (!dryRun) {
    const { inconsistentDone, badPositions } = await verify(admin, plan);
    console.log(`verification    done mismatches: ${inconsistentDone}  stages with non-contiguous positions: ${badPositions}`);
    if (inconsistentDone || badPositions) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error.message));
}
