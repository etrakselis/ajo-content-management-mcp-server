// Append-only audit trail for content write operations.
//
// Every create/update/patch/publish/archive that reaches a tool handler is
// recorded here with the self-declared author email captured at server setup,
// so changes can be attributed to a person. The author identity is NOT verified
// (see the landing-page email field) — it is whatever the operator typed in.
//
// Records are written two ways:
//   1. To the main stderr logger (visible via `docker logs`).
//   2. As one JSON object per line to an audit file (JSONL), so the trail can be
//      exported/committed elsewhere (e.g. a private GitHub repo). The file path
//      defaults to ./audit-log.jsonl and is overridable with AUDIT_LOG_PATH.
//      For the file to survive container restarts, mount it on a Docker volume.

import fs from 'fs';
import path from 'path';
import { logger } from './index.js';

const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || path.resolve(process.cwd(), 'audit-log.jsonl');

export interface AuditEntry {
  action: string;                 // the tool name, e.g. "create_content_fragment"
  authorEmail: string;            // self-declared, set at server setup (unverified)
  resourceType: 'fragment' | 'template' | 'folder' | 'tag' | 'unknown';
  resourceId?: string;            // fragment/template/folder/tag ID (from args or create result)
  resourceName?: string;          // human-readable name when the call supplies one
  sandbox?: string | null;
  tenantNamespace?: string | null;
  success: boolean;               // false for attempts the handler rejected
}

// Records the entry and returns a promise that resolves once the JSONL append has
// settled. Callers fire-and-forget it (the content operation must not wait on the
// audit write); tests can await the returned promise to assert the write happened.
// The returned promise NEVER rejects — a file-write failure is logged and swallowed,
// so an un-awaited call can't surface as an unhandledRejection.
export function recordAudit(entry: AuditEntry): Promise<void> {
  const record = { timestamp: new Date().toISOString(), ...entry };

  // Mirror to the structured logger so it shows up alongside everything else.
  logger.info('AUDIT', record);

  // Append to the JSONL file asynchronously so a slow disk never blocks the event
  // loop on the content-write path. Failures are non-fatal — auditing must never
  // break the content operation it is recording.
  return fs.promises.appendFile(AUDIT_LOG_PATH, JSON.stringify(record) + '\n').catch((err) => {
    logger.warn('Failed to write audit log file', {
      error: err instanceof Error ? err.message : String(err),
      path: AUDIT_LOG_PATH
    });
  });
}
