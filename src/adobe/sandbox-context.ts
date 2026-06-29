// Per-call sandbox override for cross-sandbox operations (content promotion).
//
// The Adobe content client and the Unified Tags/Folders client normally key every
// request's x-sandbox-name header off the single configured sandbox. Cross-sandbox
// promotion needs to READ from a source sandbox and WRITE to a target sandbox within
// one tool call, so we need a way to redirect "this subtree of async work" at a
// different sandbox WITHOUT mutating the global config (which would be racy across
// concurrent requests and would desync the per-sandbox write-confirmation set).
//
// AsyncLocalStorage scopes the override to the async call tree created by
// withSandbox(): every client request issued inside the callback (and anything it
// awaits) sees the override; requests outside it keep using the configured sandbox.
// The two HTTP clients read getActiveSandboxOverride() and fall back to the
// configured sandbox when it returns undefined — see client.ts and
// unified-tags-client.ts.

import { AsyncLocalStorage } from 'node:async_hooks';

const sandboxStore = new AsyncLocalStorage<string>();

// Run `fn` with every Adobe API request inside it pinned to `sandbox`.
export function withSandbox<T>(sandbox: string, fn: () => Promise<T>): Promise<T> {
  return sandboxStore.run(sandbox, fn);
}

// The sandbox the current async context is pinned to, or undefined if none —
// in which case callers fall back to the configured sandbox.
export function getActiveSandboxOverride(): string | undefined {
  return sandboxStore.getStore();
}
