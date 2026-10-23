import { notifyProjectsChanged } from './project-events.js';
import { supabaseClient } from './supabase-client.js';
import { isUuid } from '../utils/validation.js';

// Private Broadcast channel `project:<id>:board`. Joining is authorised by an RLS policy on realtime.messages
// (owner or current member). Messages carry only the project id: they say "something changed", never what,
// so clients always reload authoritative data through the normal RLS-protected queries.
//
// Authorization is evaluated when the channel is joined and again when the connection's JWT is refreshed;
// it is NOT re-checked per message. A user whose membership was revoked can therefore keep receiving these
// bare pings on an already-joined channel until the token refreshes or they reconnect. The pings reveal no
// data, and every reload goes through RLS, so the board page treats a denied reload as "access lost".

export const BOARD_EVENTS = { changed: 'project_changed', access: 'access_changed' };

// Calls handlers.onNotify('changed' | 'access'), handlers.onSubscribed(isReconnect) after each (re)join, and
// handlers.onOffline() when the connection drops (supabase-js rejoins on its own). Returns { unsubscribe }.
export function subscribeToBoard(projectId, handlers) {
  if (!isUuid(projectId)) return { unsubscribe() {} };

  let channel = null;
  let closed = false;
  let joinedBefore = false;

  const ready = (async () => {
    // Make sure the socket carries the current user's JWT before the private join is authorised.
    await supabaseClient.realtime.setAuth();
    if (closed) return;

    channel = supabaseClient.channel(`project:${projectId}:board`, { config: { private: true } });
    for (const [kind, event] of Object.entries(BOARD_EVENTS)) {
      channel.on('broadcast', { event }, (message) => {
        if (closed || message?.payload?.project_id !== projectId) return;
        if (kind === 'access') notifyProjectsChanged();
        handlers.onNotify?.(kind);
      });
    }
    channel.subscribe((status) => {
      if (closed) return;
      if (status === 'SUBSCRIBED') {
        const reconnect = joinedBefore;
        joinedBefore = true;
        handlers.onSubscribed?.(reconnect);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        handlers.onOffline?.(status);
      }
    });
  })().catch((error) => {
    if (!closed) handlers.onOffline?.('ERROR', error);
  });

  return {
    // Idempotent; also safe while the join is still in progress.
    async unsubscribe() {
      if (closed) return;
      closed = true;
      await ready;
      if (channel) {
        const toRemove = channel;
        channel = null;
        await supabaseClient.removeChannel(toRemove);
      }
    },
  };
}
