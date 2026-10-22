import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { getUserDeletionPreview, deleteAdminUser } from '../../services/admin-users-service.js';
import { showError, showSuccess } from '../../services/toast-service.js';
import { describeLoadError } from './admin-common.js';

export const userLabel = (user) => user.displayName || user.email || user.id;

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeDeletionCounts(c) {
  const parts = [
    `${plural(c.owned_projects, 'owned project')} (${plural(c.stages, 'stage')}, ${plural(c.tasks, 'task')}, ${plural(c.attachments, 'attachment')} totalling ${formatBytes(Number(c.attachment_bytes))}, ${plural(c.members_in_owned_projects, 'other member')})`,
    `${plural(c.memberships_in_other_projects, 'membership')} in other users’ projects`,
    `${plural(c.uploads_in_other_projects, 'attachment')} uploaded to other users’ projects`,
  ];
  return `This permanently deletes: ${parts.join('; ')}. Stored files are removed too. Nothing is transferred to anyone else. This cannot be undone.`;
}

// Loads the live counts, then asks for the account email (or id) to be typed before deleting.
// Resolves true when the user was deleted, false if cancelled or not possible.
export async function runUserDeletion(user, { signal, onDialog } = {}) {
  let preview;
  try {
    preview = await getUserDeletionPreview(user.id);
  } catch (error) {
    if (!signal?.aborted) showError(describeLoadError(error));
    return false;
  }
  if (signal?.aborted) return false;
  if (!preview.canDelete) {
    showError(preview.blockers[0] ?? 'This user cannot be deleted.');
    return false;
  }

  const dialog = openConfirmDialog({
    title: 'Delete user?',
    lead: `Delete the account “${userLabel(preview.user)}”?`,
    detail: describeDeletionCounts(preview.counts),
    confirmLabel: 'Delete user and data',
    requireText: { label: `Type ${preview.confirmationPhrase} to confirm`, value: preview.confirmationPhrase },
    onConfirm: async () => {
      try {
        await deleteAdminUser(user.id, { confirmation: preview.confirmationPhrase, counts: preview.counts });
      } catch (error) {
        // Partial failures are safe to retry: the same button continues from where it stopped.
        if (error.code === 'counts_changed') {
          error.message = `${error.message} Close this dialog and open it again.`;
        } else if (error.code === 'delete_incomplete') {
          error.message = `${error.message} You can press the button again to retry.`;
        }
        throw error;
      }
      showSuccess('User deleted.');
    },
  });
  onDialog?.(dialog);
  return dialog.result;
}
