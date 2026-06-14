// Runtime access policy for the MCP server: whether write (create/update/delete/
// publish/archive) tools are permitted. Read live on every CallTool, so flipping
// it takes effect immediately for already-connected clients.
//
// Default: writes DISABLED (read-only) — the safe default. Write access must be
// explicitly enabled via the landing page toggle, and can be flipped live afterward.
//
// Note: the full tool set is always advertised regardless of this setting (some
// clients cache the tool list at connect and ignore `tools/list_changed`). The
// read-only restriction is therefore enforced at execution time, not by hiding
// tools — see the CallTool handler in server.ts.

let writesAllowed = false;
const listeners: Array<() => void> = [];

export function getWritesAllowed(): boolean {
  return writesAllowed;
}

export function setWritesAllowed(value: boolean): void {
  if (writesAllowed !== value) {
    writesAllowed = value;
    listeners.forEach(fn => fn());
  }
}

export function onWriteAccessChanged(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
