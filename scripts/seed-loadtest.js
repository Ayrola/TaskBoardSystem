// DEVELOPMENT-ONLY load-test seed. Never run against production.
//   npm run seed:loadtest:dry      plan only, writes nothing
//   npm run seed:loadtest          create fixtures (needs --confirm-dev, supplied by the npm script)
//   npm run seed:loadtest:cleanup  delete exactly the fixtures this script created
//
// Needs the same SEED_* variables as the classroom seed plus LOADTEST_OWNER_EMAIL: an EXISTING user that will
// own the fixtures (this script never creates users). Existing demo projects are never read for update or
// deleted: every fixture has a deterministic id from its own UUID namespace and the title prefix "[LOADTEST]".
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { readConfig, findUsersByEmail } from './seed-classroom.js';

const NAMESPACE = 'b3a7c1e4-52d9-4f60-8e1b-7c9d0a4f2e68';
export const TITLE_PREFIX = '[LOADTEST]';
const FILLER_PROJECTS = 124; // plus the large board = 125 projects
const CHUNK = 500;

// Backlog is far beyond one page, Blocked is empty and Review is tiny, on purpose.
const LARGE_BOARD = [
  { name: 'Backlog', is_done: false, tasks: 260 },
  { name: 'In Progress', is_done: false, tasks: 17 },
  { name: 'Review', is_done: false, tasks: 3 },
  { name: 'Blocked', is_done: false, tasks: 0 },
  { name: 'Done', is_done: true, tasks: 120 },
];
const FILLER_STAGES = [
  { name: 'Not Started', is_done: false },
  { name: 'In Progress', is_done: false },
  { name: 'Done', is_done: true },
];

function uuidV5(name) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const pad = (n, width = 3) => String(n).padStart(width, '0');

// Owner id is added at run time. Deterministic: the same plan every run.
export function buildPlan() {
  const projects = [];
  const stages = [];
  const tasks = [];

  const addTasks = (projectId, stageId, slug, stageIndex, count, done) => {
    for (let position = 0; position < count; position++) {
      tasks.push({
        id: uuidV5(`task:${slug}:${stageIndex}:${position}`),
        project_id: projectId,
        stage_id: stageId,
        title: `${TITLE_PREFIX} Task ${pad(stageIndex + 1, 1)}-${pad(position + 1, 4)}`,
        description: '<p>Generated load-test task.</p>',
        position,
        done,
      });
    }
  };

  const large = uuidV5('project:large');
  projects.push({
    id: large,
    title: `${TITLE_PREFIX} Large board`,
    description: 'Generated load-test board with an uneven task distribution.',
  });
  LARGE_BOARD.forEach((stage, index) => {
    const id = uuidV5(`stage:large:${index}`);
    stages.push({ id, project_id: large, name: stage.name, position: index, is_done: stage.is_done });
    addTasks(large, id, 'large', index, stage.tasks, stage.is_done);
  });

  for (let i = 1; i <= FILLER_PROJECTS; i++) {
    const slug = `filler:${pad(i)}`;
    const id = uuidV5(`project:${slug}`);
    projects.push({
      id,
      title: `${TITLE_PREFIX} Project ${pad(i)}`,
      description: 'Generated load-test project.',
    });
    // Uneven: some projects are empty, some hold up to ~30 tasks, skewed to the first stage.
    const total = (i * 7) % 31;
    const split = [Math.ceil(total * 0.6), Math.floor(total * 0.25)];
    split.push(total - split[0] - split[1]);
    FILLER_STAGES.forEach((stage, index) => {
      const stageId = uuidV5(`stage:${slug}:${index}`);
      stages.push({ id: stageId, project_id: id, name: stage.name, position: index, is_done: stage.is_done });
      addTasks(id, stageId, slug, index, split[index], stage.is_done);
    });
  }
  return { projects, stages, tasks };
}

function fail(message) {
  console.error(`Load-test seed aborted: ${message}`);
  process.exit(1);
}

async function insertChunks(admin, table, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin
      .from(table)
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`inserting into ${table} failed: ${error.message}`);
  }
}

async function ownerIdFor(admin) {
  const email = process.env.LOADTEST_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) fail('set LOADTEST_OWNER_EMAIL to an existing user (e.g. in .env.seed).');
  const id = (await findUsersByEmail(admin)).get(email);
  if (!id) fail(`no existing user with email ${email}. Create it first; this script never creates users.`);
  return id;
}

async function cleanup(admin, plan, owner) {
  // Planned ids, plus leftovers with the title prefix that belong to the same owner. Stages and tasks cascade.
  const { data, error } = await admin
    .from('projects')
    .select('id')
    .eq('owner_id', owner)
    .like('title', `${TITLE_PREFIX}%`);
  if (error) throw new Error(`listing fixtures failed: ${error.message}`);
  const ids = [...new Set([...data.map((row) => row.id), ...plan.projects.map((project) => project.id)])];
  for (let i = 0; i < ids.length; i += 100) {
    const { error: deleteError } = await admin
      .from('projects')
      .delete()
      .in('id', ids.slice(i, i + 100))
      .eq('owner_id', owner);
    if (deleteError) throw new Error(`deleting fixtures failed: ${deleteError.message}`);
  }
  console.log(`Removed load-test projects (and their stages/tasks): up to ${ids.length}.`);
}

async function verify(admin, plan) {
  const { count: projectCount } = await admin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .in('id', plan.projects.map((project) => project.id));
  const largeId = plan.projects[0].id;
  const { count: largeTasks } = await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', largeId);
  console.log(`Verified: ${projectCount}/${plan.projects.length} projects, ${largeTasks} tasks on the large board.`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const isCleanup = args.has('--cleanup');

  if (process.env.NODE_ENV === 'production') fail('NODE_ENV is production.');
  if (!dryRun && !args.has('--confirm-dev')) fail('pass --confirm-dev to confirm this is a development project.');

  const config = dryRun ? null : readConfig();
  const plan = buildPlan();
  const perStage = new Map();
  for (const task of plan.tasks) perStage.set(task.stage_id, (perStage.get(task.stage_id) ?? 0) + 1);
  console.log(
    `${dryRun ? 'DRY RUN (no database access)' : isCleanup ? 'CLEANUP' : 'EXECUTE'}` +
      `${config ? ` against ${config.ref}` : ''}: ` +
      `${plan.projects.length} projects, ${plan.stages.length} stages, ${plan.tasks.length} tasks, ` +
      `largest column ${Math.max(...perStage.values())} tasks.`,
  );
  if (dryRun) return;

  const admin = createClient(config.url, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const owner = await ownerIdFor(admin);

  if (isCleanup) {
    await cleanup(admin, plan, owner);
    return;
  }

  await insertChunks(admin, 'projects', plan.projects.map((project) => ({ ...project, owner_id: owner })));
  await insertChunks(admin, 'project_stages', plan.stages);
  await insertChunks(admin, 'tasks', plan.tasks);
  await verify(admin, plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error.message));
}
