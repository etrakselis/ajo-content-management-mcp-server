// Last GitHub audit-trail commit outcome (audit-trail mode only).
//
// Why this exists: in audit-trail mode the commit to GitHub is fire-and-forget —
// it runs AFTER the tool result has already been returned, so its outcome can't be
// part of that result. A failure is emitted as an MCP logging notification, but many
// clients never surface those to the model, so a failed commit (the AJO write
// succeeded but was not recorded in GitHub) could go unnoticed. Recording the last
// outcome here lets get_server_context report it on demand — a reliable, pull-based
// channel the model controls — without coupling the context tool to server internals.
//
// Process-global (shared across sessions) on purpose: it reflects the most recent
// audit-trail commit for the configured repo, which is itself process-wide state.

export interface GitHubAuditStatus {
  at: string;        // ISO-8601 timestamp of the commit attempt
  tool: string;      // the write tool whose change was being recorded
  ok: boolean;       // true if the commit succeeded; false if it failed (see server logs)
  error?: string;    // short reason when ok is false
}

let last: GitHubAuditStatus | null = null;

export function recordGitHubAuditStatus(status: GitHubAuditStatus): void {
  last = status;
}

export function getLastGitHubAuditStatus(): GitHubAuditStatus | null {
  return last;
}

// Test seam: clear the recorded status between unit tests.
export function resetGitHubAuditStatus(): void {
  last = null;
}
