// Pure text summaries: descriptions are represented only by a changed flag.
export function activitySummary(entry) {
  const changes = entry.changes ?? {};
  if (entry.event_type === 'created') return 'Task created.';
  if (entry.event_type === 'deleted') return 'Task deleted.';
  const parts = [];
  if (changes.title) parts.push(`Title changed from “${changes.title.from}” to “${changes.title.to}”.`);
  if (changes.description_changed) parts.push('Description changed.');
  if (changes.stage) parts.push(`Stage changed from ${changes.stage.from_name ?? changes.stage.from_id} to ${changes.stage.to_name ?? changes.stage.to_id}.`);
  if (changes.position) parts.push(`Position changed from ${changes.position.from + 1} to ${changes.position.to + 1}.`);
  if (changes.completed) parts.push(changes.completed.to ? 'Marked complete by its stage.' : 'Reopened by its stage.');
  return parts.join(' ') || 'Task updated.';
}
