// Change notifier for live sandbox switches. The active sandbox is switched at
// runtime from the landing page (see /api/sandbox in server/app.ts) without
// tearing down the server, exactly like the read-only access toggle. The sandbox
// name itself lives in the Adobe client config (read live on every API call) —
// this module only carries the "it changed" event so each connected MCP session
// can be nudged to refresh.
//
// Mirrors the observer in access-policy.ts. Kept separate from that file because
// the two concerns are independent (write access vs. which sandbox is targeted),
// and separate from client.ts so the Adobe HTTP client stays free of MCP plumbing.
//
// Note: as with write access, the tool and resource *lists* don't actually change
// when the sandbox switches — only the content behind them does. We still emit the
// list_changed notifications as a refresh nudge, since many clients cache results
// at connect and that is the established convention here.

const listeners: Array<() => void> = [];

export function notifySandboxChanged(): void {
  listeners.forEach(fn => fn());
}

export function onSandboxChanged(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
