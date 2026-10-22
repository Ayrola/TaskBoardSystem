import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';
import { cleanFilename, validateAttachmentFile } from '../utils/files.js';

const BUCKET = 'task-attachments';
const SIGNED_URL_SECONDS = 60;

export class AttachmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AttachmentError';
  }
}

const toAttachment = (row) => ({
  id: row.id,
  taskId: row.task_id,
  projectId: row.project_id,
  filename: row.original_filename,
  mimeType: row.mime_type,
  size: Number(row.size_bytes),
  createdAt: row.created_at,
  storagePath: row.storage_path,
});

export async function listAttachments(taskId, { signal } = {}) {
  if (!isUuid(taskId)) return [];
  let query = supabaseClient
    .from('task_attachments')
    .select('id, task_id, project_id, storage_path, original_filename, mime_type, size_bytes, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new AttachmentError('Could not load attachments.');
  return (data ?? []).map(toAttachment);
}

// Two steps that cannot be one transaction (Storage, then the database), so each failure is handled:
// - upload fails: nothing was written.
// - metadata fails: the new object is removed through the Storage API so no unreferenced file is left.
//   If that removal also fails, the file is invisible and unreachable from the app (no row points to it).
// The object path is generated here from validated IDs and a fresh UUID; the filename is metadata only.
export async function uploadAttachment({ projectId, taskId, file }) {
  if (!isUuid(projectId) || !isUuid(taskId)) throw new AttachmentError('This task is no longer available.');
  const problem = validateAttachmentFile(file);
  if (problem) throw new AttachmentError(problem);

  const id = crypto.randomUUID();
  const storagePath = `${projectId}/${taskId}/${id}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
  if (uploadError) throw new AttachmentError('Could not upload the file. Please try again.');

  const { data, error } = await supabaseClient
    .from('task_attachments')
    .insert({
      id,
      task_id: taskId,
      project_id: projectId,
      storage_path: storagePath,
      original_filename: cleanFilename(file.name),
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select('id, task_id, project_id, storage_path, original_filename, mime_type, size_bytes, created_at')
    .single();

  if (error || !data) {
    await supabaseClient.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    throw new AttachmentError('The file was uploaded but could not be saved to the task. Please try again.');
  }
  return toAttachment(data);
}

// A short-lived link that downloads the file under its original name.
export async function getAttachmentDownloadUrl(attachment) {
  const { data, error } = await supabaseClient.storage
    .from(BUCKET)
    .createSignedUrl(attachment.storagePath, SIGNED_URL_SECONDS, { download: attachment.filename });
  if (error || !data?.signedUrl) throw new AttachmentError('Could not create a download link. Please try again.');
  return data.signedUrl;
}

// Deleting the row queues its file (database trigger); the file is then removed through the Storage API.
// If the file removal fails, the queue entry remains and a later drain finishes the job.
export async function removeAttachment(attachmentId) {
  if (!isUuid(attachmentId)) throw new AttachmentError('This attachment no longer exists.');

  const { data, error } = await supabaseClient.from('task_attachments').delete().eq('id', attachmentId).select('id');
  if (error) throw new AttachmentError('Could not remove the attachment. Please try again.');
  if (!data?.length) throw new AttachmentError('This attachment no longer exists.');
  await drainAttachmentCleanup();
}

// Removes the files of attachments that were deleted (directly or with their task/project)
// and clears the queue entries. Best effort: failures leave the entries for the next call.
export async function drainAttachmentCleanup() {
  try {
    const { data, error } = await supabaseClient
      .from('attachment_cleanup_queue')
      .select('storage_path')
      .order('queued_at', { ascending: true })
      .limit(100);
    if (error || !data?.length) return;

    const paths = data.map((row) => row.storage_path);
    const { error: removeError } = await supabaseClient.storage.from(BUCKET).remove(paths);
    if (removeError) return;

    // Paths missing from Storage are already gone, so every requested entry can be cleared.
    await supabaseClient.from('attachment_cleanup_queue').delete().in('storage_path', paths);
  } catch {
    // Cleanup is retried on the next call; it must never break the action that triggered it.
  }
}
