// Admin user management: list, view, edit, delete. Browser code never sees privileged credentials.
//
// Every request: (1) the bearer token is validated with Auth (auth.getUser(jwt)), (2) the caller's CURRENT
// role is read from public.user_roles, (3) only then is the action run with the service-role client.
// Nothing about the caller's role is read from the request.
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase; ALLOWED_ORIGINS is set by you
// (comma-separated list of exact app origins). With no ALLOWED_ORIGINS, browser calls are refused.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);

const BUCKET = "task-attachments";
const MAX_PER_PAGE = 50;
const DISPLAY_NAME_MAX = 100;
const EMAIL_MAX = 254;
const CLEANUP_BATCH = 100;
const DEADLINE_MS = 90_000;
const BAN_FOREVER = "876000h";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EDITABLE_FIELDS = ["display_name", "email"];

class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function corsHeaders(origin: string | null): Record<string, string> | null {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

const respond = (status: number, body: unknown, cors: Record<string, string> | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(cors ?? { Vary: "Origin" }) },
  });

async function requireAdmin(req: Request): Promise<string> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
  if (!match) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) throw new HttpError(401, "unauthenticated", "Your session is not valid. Sign in again.");
  const { data: role, error: roleError } = await admin
    .from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle();
  if (roleError) throw new HttpError(500, "internal", "Could not verify permissions.");
  if (role?.role !== "admin") throw new HttpError(403, "forbidden", "Admin access is required.");
  return data.user.id;
}

function userId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, "invalid_request", "A valid user id is required.");
  return value.toLowerCase();
}

// Only these fields ever leave the function. No tokens, hashes, identities or raw metadata.
// deno-lint-ignore no-explicit-any
function publicUser(u: any, role: string | undefined) {
  const meta = u.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((v) => typeof v === "string" && v.trim());
  return {
    id: u.id,
    email: u.email ?? null,
    display_name: name ? String(name).trim().slice(0, DISPLAY_NAME_MAX) : null,
    role: role === "admin" ? "admin" : "user",
    email_confirmed: Boolean(u.email_confirmed_at),
    banned: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
    created_at: u.created_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
  };
}

async function getTarget(id: string) {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data.user) {
    if (error && (error.status ?? 0) >= 500) throw new HttpError(502, "upstream", "Could not load the user.");
    throw new HttpError(404, "not_found", "User not found.");
  }
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", id).maybeSingle();
  return { user: data.user, role: role?.role as string | undefined };
}

async function list(body: Record<string, unknown>) {
  const page = Number.isInteger(body.page) && (body.page as number) > 0 ? (body.page as number) : 1;
  const perPageRaw = Number.isInteger(body.per_page) ? (body.per_page as number) : 20;
  const perPage = Math.min(Math.max(perPageRaw, 1), MAX_PER_PAGE);
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
  if (error) throw new HttpError(502, "upstream", "Could not load users.");
  const ids = data.users.map((u) => u.id);
  const roles = new Map<string, string>();
  if (ids.length) {
    const { data: rows, error: rolesError } = await admin.from("user_roles").select("user_id, role").in("user_id", ids);
    if (rolesError) throw new HttpError(500, "internal", "Could not load roles.");
    for (const row of rows ?? []) roles.set(row.user_id, row.role);
  }
  // deno-lint-ignore no-explicit-any
  const total = Number((data as any).total ?? data.users.length);
  return { users: data.users.map((u) => publicUser(u, roles.get(u.id))), page, per_page: perPage, total };
}

async function view(body: Record<string, unknown>) {
  const { user, role } = await getTarget(userId(body.user_id));
  return { user: publicUser(user, role) };
}

// Allowed edits: display_name (stored as user_metadata.full_name) and email. Anything else is rejected,
// in particular role, password, metadata, ban state and id.
async function update(body: Record<string, unknown>) {
  const id = userId(body.user_id);
  const { user_id: _id, action: _action, ...fields } = body;
  const unknown = Object.keys(fields).filter((k) => !EDITABLE_FIELDS.includes(k));
  if (unknown.length) throw new HttpError(400, "invalid_request", `These fields cannot be edited: ${unknown.join(", ")}.`);
  if (!Object.keys(fields).length) throw new HttpError(400, "invalid_request", "Nothing to change.");

  const { user, role } = await getTarget(id);
  const attrs: Record<string, unknown> = {};

  if ("display_name" in fields) {
    const name = typeof fields.display_name === "string" ? fields.display_name.trim() : null;
    // deno-lint-ignore no-control-regex
    if (!name || name.length > DISPLAY_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new HttpError(400, "invalid_request", `Display name must be 1–${DISPLAY_NAME_MAX} characters without control characters.`);
    }
    if (name !== publicUser(user, role).display_name) {
      // Merge so unrelated metadata is preserved.
      attrs.user_metadata = { ...(user.user_metadata ?? {}), full_name: name };
    }
  }

  if ("email" in fields) {
    const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
    if (!email || email.length > EMAIL_MAX || !EMAIL.test(email)) {
      throw new HttpError(400, "invalid_request", "Enter a valid email address.");
    }
    if (email !== (user.email ?? "").toLowerCase()) {
      // Applied immediately by the Admin API; marked confirmed because an admin vouches for it.
      attrs.email = email;
      attrs.email_confirm = true;
    }
  }

  if (!Object.keys(attrs).length) return { user: publicUser(user, role), changed: false };

  const { data, error } = await admin.auth.admin.updateUserById(id, attrs);
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.status === 422) {
      throw new HttpError(409, "email_taken", "Another account already uses that email address.");
    }
    throw new HttpError(502, "upstream", "Could not save the changes.");
  }
  return { user: publicUser(data.user, role), changed: true };
}

async function summary(id: string) {
  const { data, error } = await admin.rpc("admin_user_deletion_summary", { p_user_id: id });
  if (error || !data) throw new HttpError(500, "internal", "Could not count the user's data.");
  return data as Record<string, number>;
}

async function blockers(callerId: string, id: string, role: string | undefined): Promise<string[]> {
  const reasons: string[] = [];
  if (id === callerId) reasons.push("You cannot delete your own account.");
  if (role === "admin") {
    const { count, error } = await admin.from("user_roles").select("user_id", { count: "exact", head: true })
      .eq("role", "admin").neq("user_id", id);
    if (error) throw new HttpError(500, "internal", "Could not verify admins.");
    if (!count) reasons.push("This is the last admin. Another admin must exist first.");
  }
  return reasons;
}

const phraseFor = (user: { id: string; email?: string | null }) => user.email ?? user.id;

async function deletionPreview(callerId: string, body: Record<string, unknown>) {
  const id = userId(body.user_id);
  const { user, role } = await getTarget(id);
  const reasons = await blockers(callerId, id, role);
  return {
    user: publicUser(user, role),
    counts: await summary(id),
    blockers: reasons,
    can_delete: reasons.length === 0,
    confirmation_phrase: phraseFor(user),
  };
}

// Deletion sequence. Every step is idempotent, and the user is only removed from Auth in the last step,
// so a failure anywhere can simply be retried from the browser.
//   1. Ban the account (stops sign-in and token refresh, so no new data appears during cleanup).
//   2. In one DB transaction: delete owned projects (cascading stages, tasks, attachment rows, members),
//      the user's memberships and uploads; queue every affected Storage path under the user's id.
//   3. Remove queued Storage objects in batches and clear their queue rows (repeats until none are left).
//   4. Delete the Auth user (cascades user_roles). Ownership is never transferred.
async function deleteUser(callerId: string, body: Record<string, unknown>) {
  const started = Date.now();
  const id = userId(body.user_id);
  const { user, role } = await getTarget(id);

  const reasons = await blockers(callerId, id, role);
  if (reasons.length) throw new HttpError(409, "blocked", reasons[0], { blockers: reasons });

  if (body.confirmation !== phraseFor(user)) {
    throw new HttpError(400, "confirmation_mismatch", "The confirmation text does not match.");
  }
  const counts = await summary(id);
  const expected = (body.expected ?? {}) as Record<string, unknown>;
  const stale = ["owned_projects", "tasks", "attachments"].some((k) => Number(expected[k]) !== Number(counts[k]));
  if (stale) {
    throw new HttpError(409, "counts_changed", "This user's data changed since you reviewed it. Review the new counts and confirm again.", { counts });
  }

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`admin-users delete step "${name}" failed for ${id}:`, e instanceof Error ? e.message : "error");
      throw new HttpError(500, "delete_incomplete", `Deletion stopped at the “${name}” step. Nothing was transferred; run delete again to continue.`, { step: name, retryable: true });
    }
  };

  await step("disable sign-in", async () => {
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
    if (error) throw error;
  });

  await step("delete dependent records", async () => {
    const { error } = await admin.rpc("admin_delete_user_data", { p_user_id: id });
    if (error) throw error;
  });

  let removedObjects = 0;
  await step("remove stored files", async () => {
    while (true) {
      if (Date.now() - started > DEADLINE_MS) throw new Error("time budget reached");
      const { data, error } = await admin.from("attachment_cleanup_queue").select("storage_path")
        .eq("owner_id", id).order("storage_path").limit(CLEANUP_BATCH);
      if (error) throw error;
      if (!data?.length) return;
      const paths = data.map((r) => r.storage_path as string);
      // Removing an already-missing object is not an error, so retries are safe.
      const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
      if (removeError) throw removeError;
      const { error: clearError } = await admin.from("attachment_cleanup_queue").delete().in("storage_path", paths);
      if (clearError) throw clearError;
      removedObjects += paths.length;
    }
  });

  await step("delete account", async () => {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && error.status !== 404) throw error;
  });

  console.log(`admin-users: admin ${callerId} deleted user ${id}`);
  return { deleted: true, removed_files: removedObjects };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  if (origin && !cors) return respond(403, { error: { code: "origin_not_allowed", message: "Origin not allowed." } }, null);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors ?? {} });
  if (req.method !== "POST") return respond(405, { error: { code: "method_not_allowed", message: "Use POST." } }, cors);

  try {
    const callerId = await requireAdmin(req);
    const text = await req.text();
    if (text.length > 10_000) throw new HttpError(413, "invalid_request", "Request is too large.");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "invalid_request", "Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "Invalid request.");

    switch (body.action) {
      case "list": return respond(200, await list(body), cors);
      case "get": return respond(200, await view(body), cors);
      case "update": return respond(200, await update(body), cors);
      case "deletion_preview": return respond(200, await deletionPreview(callerId, body), cors);
      case "delete": return respond(200, await deleteUser(callerId, body), cors);
      default: throw new HttpError(400, "invalid_request", "Unknown action.");
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return respond(e.status, { error: { code: e.code, message: e.message, ...e.extra } }, cors);
    }
    console.error("admin-users unexpected error:", e instanceof Error ? e.message : "error");
    return respond(500, { error: { code: "internal", message: "Something went wrong." } }, cors);
  }
});
