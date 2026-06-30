import type { GitHubConfig } from './types.js';
import {
  getFileSha, getBranchSha, createBranch, commitFile,
  createPullRequest, updatePullRequest, listPullRequests, getPullRequest, getPRFiles, getFileContent, parsePRUrl
} from './client.js';
import { getTag } from '../adobe/unified-tags-client.js';
import { withSandbox } from '../adobe/sandbox-context.js';
import { logger } from '../telemetry/index.js';

// Resolve an asset's tagIds (UUIDs) to tag NAMES so the committed file is
// self-describing — cross-sandbox promotion reads names from _meta.tagNames since
// UUIDs are environment-local. Best-effort: a tag that can't be resolved is dropped
// (never blocks the commit). Resolved against the sandbox the write targeted.
async function resolveTagNames(sandboxName: string, args: Record<string, unknown>): Promise<string[]> {
  const ids = Array.isArray(args.tagIds) ? args.tagIds.filter((t): t is string => typeof t === 'string') : [];
  if (ids.length === 0) return [];
  try {
    return await withSandbox(sandboxName, async () => {
      const names: string[] = [];
      for (const id of ids) {
        try {
          const tag = await getTag(id) as { name?: string };
          if (typeof tag?.name === 'string' && tag.name) names.push(tag.name);
        } catch { /* skip this tag */ }
      }
      return names;
    });
  } catch {
    return [];
  }
}

// ─── Path helpers ──────────────────────────────────────────────────────────────

function assetTypeDir(toolName: string): string {
  if (toolName.includes('template')) return 'content-templates';
  if (toolName.includes('fragment')) return 'content-fragments';
  if (toolName.includes('folder')) return 'folders';
  if (toolName.includes('tag')) return 'tags';
  return 'misc';
}

// Sanitize a name/id so it's safe as a filename. UUIDs and typical AJO names
// are already safe; this guards against edge cases with special chars.
function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function assetFilePath(sandboxName: string, toolName: string, id?: string, name?: string, ajoFolderPath?: string): string {
  const typeDir = assetTypeDir(toolName);
  const dir = ajoFolderPath ? `${typeDir}/${ajoFolderPath}` : typeDir;
  // Prefer name over id — names match what the user sees in AJO and make the
  // repo readable without UUID lookups. safeFilename guards against path separators.
  const identifier = name ? safeFilename(name) : id ? safeFilename(id) : 'unknown';
  return `${sandboxName}/${dir}/${identifier}.json`;
}

// Generate a unique branch name from the tool name and current timestamp.
function makeBranchName(toolName: string): string {
  return `ajo-${toolName.replace(/_/g, '-')}-${Date.now()}`;
}

// Extract the primary resource identifier from tool args (varies by resource family).
function extractId(args: Record<string, unknown>): string | undefined {
  const idKeys = ['fragmentId', 'templateId', 'folderId', 'tagId'];
  return idKeys.map(k => args[k]).find((v): v is string => typeof v === 'string');
}

// ─── Content-mirror helpers ───────────────────────────────────────────────────
// The repo is a content MIRROR of the sandbox. create/update keep the canonical
// <name>.json holding full content; a patch applies its metadata change onto that
// content so the file stays accurate; a delete/archive PRESERVES the content body and
// only flags _meta.deleted — a sandbox delete NEVER removes content from the repo, so
// the asset can always be recreated from the committed file. In approval-gate mode the
// committed file also carries the operation's real args (id/etag/patches) so
// deploy_merged_changes can still replay it — the deploy handlers' Zod schemas strip the
// extra content fields, so the preserved content never disturbs the AJO call.

const isDeleteOp = (toolName: string): boolean =>
  toolName.startsWith('delete_') || toolName === 'archive_content_fragment';
const isPatchOp = (toolName: string): boolean => toolName.startsWith('patch_');

// The content-metadata JSON-Patch paths that patch_content_* supports.
const PATCHABLE_FIELDS = new Set(['name', 'description', 'parentFolderId', 'tagIds', 'labels']);

// Drop the _meta envelope, returning just the asset's content fields.
function contentOf(payload: Record<string, unknown> | null): Record<string, unknown> {
  if (!payload) return {};
  const { _meta: _omit, ...content } = payload;
  return content;
}

// Read the prior committed file (full payload incl _meta) from a ref, or null if absent.
async function readCommittedPayload(
  token: string, owner: string, repo: string, filePath: string, ref: string
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await getFileContent(token, owner, repo, filePath, ref)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Apply a content-metadata JSON-Patch (only the paths patch_content_* supports) to a
// content object so the mirrored file reflects the change. add/replace set the field;
// remove deletes it. Anything else (or a content field outside the supported set) is
// ignored — the content body is otherwise carried through verbatim.
function applyMetadataPatch(content: Record<string, unknown>, patches: unknown): Record<string, unknown> {
  if (!Array.isArray(patches)) return content;
  const out = { ...content };
  for (const op of patches as Array<{ op?: string; path?: string; value?: unknown }>) {
    const field = typeof op?.path === 'string' ? op.path.replace(/^\//, '') : '';
    if (!PATCHABLE_FIELDS.has(field)) continue;
    if (op.op === 'remove') delete out[field];
    else out[field] = op.value;
  }
  return out;
}

// ─── Audit Trail (non-blocking) ──────────────────────────────────────────────

/**
 * Commit the args + result metadata to GitHub after a successful AJO write.
 * Called fire-and-forget from the MCP CallTool handler.
 * Returns true on success, false on any error (errors logged but never thrown).
 */
export async function commitAuditTrail(
  config: GitHubConfig,
  sandboxName: string,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  authorEmail: string,
  ajoFolderPath?: string,
  tenant?: string,
  // The asset's canonical name, resolved by the caller for metadata ops (patch_/
  // archive_/delete_) whose args carry only an id. Used ONLY to build the file path so
  // the commit lands on the canonical <name>.json instead of an orphan id-named file;
  // it is never added to the committed payload.
  canonicalName?: string
): Promise<boolean> {
  const { token, owner, repo, defaultBranch } = config;

  try {
    const argId = extractId(args);
    const resultId = (result as { id?: string }).id ?? argId;
    const argName = canonicalName ?? (typeof args.name === 'string' ? args.name : undefined);
    const filePath = assetFilePath(sandboxName, toolName, resultId ?? argId, argName, ajoFolderPath);

    const existingSha = await getFileSha(token, owner, repo, filePath, defaultBranch);

    if (isDeleteOp(toolName)) {
      // Content-PRESERVING delete: keep the committed content body and only flag it
      // deleted — a sandbox delete never removes content from the repo. Nothing to do
      // if there is no prior file (no content to preserve, and we won't fabricate one).
      // (Audit-trail mode has no deploy step, so the file is a pure record/mirror.)
      if (!existingSha) {
        logger.info('GitHub audit trail: no prior file to flag deleted (skipped)', { tool: toolName, filePath, sandbox: sandboxName });
        return true;
      }
      const prior = contentOf(await readCommittedPayload(token, owner, repo, filePath, defaultBranch));
      const payload = {
        _meta: {
          operation: toolName,
          deleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: authorEmail,
          sandbox: sandboxName,
          ...(tenant ? { tenant } : {}),
          ajoId: resultId ?? argId
        },
        ...prior
      };
      await commitFile(
        token, owner, repo, filePath,
        JSON.stringify(payload, null, 2),
        `${toolName}: ${argName ?? resultId ?? argId ?? 'unknown'} [${authorEmail}]`,
        defaultBranch,
        existingSha
      );
    } else {
      // create/update carry full content in args; a patch mirrors its metadata change
      // onto the prior content so the file stays an accurate snapshot (content preserved).
      const tagNames = await resolveTagNames(sandboxName, args);
      const content = isPatchOp(toolName)
        ? applyMetadataPatch(contentOf(await readCommittedPayload(token, owner, repo, filePath, defaultBranch)), (args as { patches?: unknown }).patches)
        : { ...args };
      const payload = {
        _meta: {
          operation: toolName,
          ajoId: resultId,
          updatedAt: new Date().toISOString(),
          updatedBy: authorEmail,
          sandbox: sandboxName,
          ...(tenant ? { tenant } : {}),
          ...(tagNames.length ? { tagNames } : {})
        },
        ...content
      };
      await commitFile(
        token, owner, repo, filePath,
        JSON.stringify(payload, null, 2),
        `${toolName}: ${argName ?? resultId ?? 'unknown'} [${authorEmail}]`,
        defaultBranch,
        existingSha
      );
    }

    logger.info('GitHub audit trail committed', { tool: toolName, filePath, sandbox: sandboxName });
    return true;
  } catch (err) {
    logger.warn('GitHub audit trail commit failed (non-fatal)', {
      tool: toolName,
      sandbox: sandboxName,
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}

// ─── Approval Gate (PR flow) ──────────────────────────────────────────────────

/**
 * Instead of writing to AJO, create a GitHub branch + PR with the proposed
 * content. The AJO write is deferred until the PR is merged and the human
 * calls deploy_merged_changes. Returns the PR number and URL.
 */
export async function createApprovalPR(
  config: GitHubConfig,
  sandboxName: string,
  toolName: string,
  args: Record<string, unknown>,
  authorEmail: string,
  ajoFolderPath?: string,
  tenant?: string,
  // Optional explicit head-branch name. Cross-sandbox promotion supplies a
  // deterministic, asset-encoding branch (ajo-promote-<type>-<name>-<ts>) so it can
  // rediscover its own PRs across phases without storing state. Defaults to the
  // timestamped per-tool branch used by ordinary approval-gate writes.
  branchName?: string,
  // Optional extra fields merged into the committed file's _meta (cross-sandbox
  // promotion records sourceContentHash here for source-changed detection on re-run).
  extraMeta?: Record<string, unknown>,
  // The asset's canonical name, resolved by the caller for metadata ops (patch_/
  // archive_/delete_) whose args carry only an id. Used ONLY to build the file path so
  // the PR commit lands on the canonical <name>.json (overwriting it with the tombstone)
  // instead of an orphan id-named file; it is never added to the committed payload.
  canonicalName?: string
): Promise<{ prNumber: number; prUrl: string; filePath: string }> {
  const { token, owner, repo, defaultBranch } = config;

  const argId = extractId(args);
  const argName = canonicalName ?? (typeof args.name === 'string' ? args.name : argId ?? 'unknown');
  const filePath = assetFilePath(sandboxName, toolName, argId, argName, ajoFolderPath);
  // ── Dedup genuine double-calls ──────────────────────────────────────────────
  // If an OPEN approval-gate PR already proposes a change to THIS asset (same canonical
  // file), reuse it: commit the new payload onto its branch and return it, instead of
  // opening a second PR for the same asset. Matched by the file the PR changed (reliable,
  // independent of branch naming), bounded to this server's regular approval PRs (branch
  // prefix "ajo-", excluding promotion's "ajo-promote-"). Promotion passes its own
  // branchName and manages its own PRs across phases, so it is exempt from the dedup.
  let reusePr: { number: number; html_url: string } | undefined;
  let reuseBranch: string | undefined;
  if (!branchName) {
    const openPrs = await listPullRequests(token, owner, repo, { state: 'open' }).catch(() => []);
    for (const p of openPrs) {
      const ref = p.head?.ref;
      if (!ref || !ref.startsWith('ajo-') || ref.startsWith('ajo-promote-')) continue;
      const files = await getPRFiles(token, owner, repo, p.number).catch(() => []);
      if (files.some(f => f.filename === filePath)) {
        reusePr = { number: p.number, html_url: p.html_url };
        reuseBranch = ref;
        break;
      }
    }
  }

  const branch = reuseBranch ?? branchName ?? makeBranchName(toolName);
  if (!reuseBranch) {
    const baseSha = await getBranchSha(token, owner, repo, defaultBranch);
    await createBranch(token, owner, repo, branch, baseSha);
  }

  const tagNames = await resolveTagNames(sandboxName, args);
  const requestedAt = new Date().toISOString();
  const meta: Record<string, unknown> = {
    operation: toolName,
    requestedBy: authorEmail,
    requestedAt,
    sandbox: sandboxName,
    ...(tenant ? { tenant } : {}),
    ...(tagNames.length ? { tagNames } : {}),
    ...(extraMeta ?? {})
  };

  // The committed file MIRRORS the asset's content (so a sandbox change/delete never
  // loses content from the repo) AND carries the operation's args so deploy_merged_changes
  // can still replay it — the deploy handler's Zod schema strips the extra content fields.
  //   • create/update → args ARE the full content
  //   • patch         → apply the metadata change to the prior committed content (preserved)
  //   • delete/archive→ keep the prior content body, only flag _meta.deleted (never removed)
  // The prior content is read from the branch (== the default branch at creation time).
  // getFileSha returns null for a brand-new file; a PUT then creates it.
  const existingSha = await getFileSha(token, owner, repo, filePath, branch);
  let payload: Record<string, unknown>;
  if (isDeleteOp(toolName)) {
    const prior = existingSha ? contentOf(await readCommittedPayload(token, owner, repo, filePath, branch)) : {};
    payload = { _meta: { ...meta, deleted: true, deletedAt: requestedAt, ajoId: argId }, ...prior, ...args };
  } else if (isPatchOp(toolName)) {
    const prior = existingSha ? contentOf(await readCommittedPayload(token, owner, repo, filePath, branch)) : {};
    payload = { _meta: meta, ...applyMetadataPatch(prior, (args as { patches?: unknown }).patches), ...args };
  } else {
    payload = { _meta: meta, ...args };
  }

  await commitFile(
    token, owner, repo, filePath,
    JSON.stringify(payload, null, 2),
    `Proposed: ${toolName} — ${argName} [${authorEmail}]`,
    branch,
    existingSha
  );

  const operationLabel = toolName.replace(/_/g, ' ');
  const prTitle = `[AJO] ${operationLabel}: ${argName}`;
  const prBody =
    `## AJO Content Change Request\n\n` +
    `**Operation:** \`${toolName}\`\n` +
    `**Asset:** \`${argName}\`\n` +
    `**Sandbox:** \`${sandboxName}\`\n` +
    `**Requested by:** ${authorEmail}\n` +
    `**Requested at:** ${new Date().toISOString()}\n\n` +
    `## Changed File\n\n\`${filePath}\`\n\n` +
    `---\n\n` +
    `_After merging, call \`deploy_merged_changes\` with this PR URL to apply the change to AJO._`;

  // Reusing an existing open PR for this asset: the commit above updated its branch, so the
  // PR now reflects the latest proposed content. Refresh the PR's title/body so they describe
  // the LATEST operation too (otherwise a "create" PR reused by a later "update" would keep
  // its stale "create" title). Best-effort — a failed refresh never fails the reuse. Then
  // return the existing PR instead of opening a duplicate.
  if (reusePr) {
    const reused = reusePr;
    await updatePullRequest(token, owner, repo, reused.number, { title: prTitle, body: prBody })
      .catch(err => logger.warn('PR title/body refresh on reuse failed (non-fatal)', {
        prNumber: reused.number, error: err instanceof Error ? err.message : String(err)
      }));
    logger.info('Reused existing open PR for asset (deduped a double-call)', {
      tool: toolName, prNumber: reused.number, filePath, sandbox: sandboxName
    });
    return { prNumber: reused.number, prUrl: reused.html_url, filePath };
  }

  // Open the PR. POST /pulls is NOT idempotent: a transient GitHub error AFTER the PR is
  // actually created — a token/permission blip that surfaces as 404 "Not Found", a gateway
  // hiccup, a dropped response — would otherwise make this throw, the tool report failure,
  // and the caller RETRY, opening a DUPLICATE PR. Guard against it: on error, look for a PR
  // already open on this head branch (unique per call — it was just created above). If one
  // exists, the create DID go through, so recover it instead of failing; only re-throw when
  // no PR was actually created (a genuine failure the caller can safely retry).
  let pr: { number: number; html_url: string };
  try {
    pr = await createPullRequest(token, owner, repo, prTitle, prBody, branch, defaultBranch);
  } catch (err) {
    const existing = (await listPullRequests(token, owner, repo, { state: 'open' }).catch(() => []))
      .find(p => p.head?.ref === branch);
    if (!existing) throw err;
    logger.warn('createPullRequest errored but a PR already exists for the head branch — recovering (prevents a duplicate PR on retry)', {
      tool: toolName, branch, prNumber: existing.number,
      error: err instanceof Error ? err.message : String(err)
    });
    pr = { number: existing.number, html_url: existing.html_url };
  }

  logger.info('GitHub approval PR created', {
    tool: toolName, prNumber: pr.number, prUrl: pr.html_url, sandbox: sandboxName
  });

  return { prNumber: pr.number, prUrl: pr.html_url, filePath };
}

// ─── PR status check ──────────────────────────────────────────────────────────

export interface PRStatus {
  number: number;
  state: string;
  merged: boolean;
  title: string;
  url: string;
  mergeCommitSha: string | null;
}

export async function checkPRStatus(config: GitHubConfig, prUrl: string): Promise<PRStatus> {
  const parsed = parsePRUrl(prUrl);
  if (!parsed) throw new Error(`Invalid GitHub PR URL: "${prUrl}". Expected format: https://github.com/owner/repo/pull/123`);

  const pr = await getPullRequest(config.token, parsed.owner, parsed.repo, parsed.prNumber);
  return {
    number: pr.number,
    state: pr.state,
    merged: pr.merged,
    title: pr.title,
    url: pr.html_url,
    mergeCommitSha: pr.merge_commit_sha
  };
}

// ─── Deploy from merged PR ────────────────────────────────────────────────────

export interface PendingOperation {
  toolName: string;
  args: Record<string, unknown>;
  filePath: string;
}

/**
 * Read the payload from a merged PR and return a list of pending operations to
 * execute against AJO. Each file in the PR that has a valid `_meta.operation`
 * yields one operation. The actual AJO writes happen in the caller (so they go
 * through the normal tool-handler path, including audit logging).
 */
export async function readMergedPRContent(
  config: GitHubConfig,
  prUrl: string
): Promise<PendingOperation[]> {
  const parsed = parsePRUrl(prUrl);
  if (!parsed) throw new Error(`Invalid GitHub PR URL: "${prUrl}". Expected format: https://github.com/owner/repo/pull/123`);

  const { owner, repo, prNumber } = parsed;
  const pr = await getPullRequest(config.token, owner, repo, prNumber);

  if (!pr.merged || !pr.merge_commit_sha) {
    const detail = pr.state === 'closed'
      ? 'This PR was closed without merging.'
      : 'This PR is still open and has not been merged yet.';
    throw new Error(
      `PR #${prNumber} has not been merged. ${detail} ` +
      `Merge the PR on GitHub first, then call deploy_merged_changes again.`
    );
  }

  const files = await getPRFiles(config.token, owner, repo, prNumber);
  const results: PendingOperation[] = [];

  for (const file of files) {
    if (!file.filename.endsWith('.json')) continue;
    if (file.status === 'removed') continue;

    try {
      const rawContent = await getFileContent(config.token, owner, repo, file.filename, pr.merge_commit_sha);
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;
      const meta = parsed._meta as Record<string, unknown> | undefined;

      if (!meta?.operation || typeof meta.operation !== 'string') {
        logger.warn('Skipping PR file without _meta.operation', { filename: file.filename });
        continue;
      }

      // Strip _meta so what remains is the clean args for the tool handler.
      const { _meta: _omit, ...args } = parsed;
      results.push({ toolName: meta.operation, args, filePath: file.filename });
    } catch (err) {
      logger.warn('Failed to parse PR file', {
        filename: file.filename,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  if (results.length === 0) {
    throw new Error(
      `PR #${prNumber} was merged but contained no deployable AJO operations. ` +
      `Files must be JSON with a "_meta.operation" field (set automatically when the PR was created via this server).`
    );
  }

  return results;
}

// ─── Cross-sandbox promotion: prior-state lookup ─────────────────────────────────

// Read the _meta block of the last-promoted file for an asset from the repo's
// default branch (the deterministic path created by createApprovalPR). Promotion
// uses _meta.sourceContentHash to detect whether the SOURCE changed since the asset
// was last promoted (source-vs-source comparison, immune to target re-serialization).
// Returns null if no prior file exists (never promoted, or moved folder).
export async function readPriorPromotionMeta(
  config: GitHubConfig,
  sandboxName: string,
  toolName: string,
  name: string,
  ajoFolderPath?: string
): Promise<Record<string, unknown> | null> {
  const { token, owner, repo, defaultBranch } = config;
  const filePath = assetFilePath(sandboxName, toolName, undefined, name, ajoFolderPath);
  try {
    const raw = await getFileContent(token, owner, repo, filePath, defaultBranch);
    const parsed = JSON.parse(raw) as { _meta?: Record<string, unknown> };
    return parsed._meta ?? null;
  } catch {
    return null; // not found / unreadable → treat as "no prior promotion"
  }
}
