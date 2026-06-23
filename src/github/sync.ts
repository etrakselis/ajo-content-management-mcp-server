import type { GitHubConfig } from './types.js';
import {
  getFileSha, getBranchSha, createBranch, commitFile,
  createPullRequest, getPullRequest, getPRFiles, getFileContent, parsePRUrl
} from './client.js';
import { logger } from '../telemetry/index.js';

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
  return value.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120);
}

function assetFilePath(sandboxName: string, toolName: string, id?: string, name?: string): string {
  const dir = assetTypeDir(toolName);
  const identifier = id ? safeFilename(id) : name ? safeFilename(name) : 'unknown';
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
  authorEmail: string
): Promise<boolean> {
  const { token, owner, repo, defaultBranch } = config;

  try {
    const argId = extractId(args);
    const resultId = (result as { id?: string }).id ?? argId;
    const argName = typeof args.name === 'string' ? args.name : undefined;
    const filePath = assetFilePath(sandboxName, toolName, resultId ?? argId, argName);

    const isDelete = toolName.startsWith('delete_') || toolName === 'archive_content_fragment';

    if (isDelete) {
      // For deletes/archives, overwrite the file with a tombstone record so the
      // history shows WHAT was removed and WHEN, rather than having the file disappear.
      const existingSha = await getFileSha(token, owner, repo, filePath, defaultBranch);
      const tombstone = {
        _meta: {
          operation: toolName,
          deletedAt: new Date().toISOString(),
          deletedBy: authorEmail,
          sandbox: sandboxName,
          ajoId: resultId ?? argId
        }
      };
      if (existingSha) {
        await commitFile(
          token, owner, repo, filePath,
          JSON.stringify(tombstone, null, 2),
          `${toolName}: ${argName ?? resultId ?? argId ?? 'unknown'} [${authorEmail}]`,
          defaultBranch,
          existingSha
        );
      }
    } else {
      const payload = {
        _meta: {
          operation: toolName,
          ajoId: resultId,
          updatedAt: new Date().toISOString(),
          updatedBy: authorEmail,
          sandbox: sandboxName
        },
        ...args
      };
      const existingSha = await getFileSha(token, owner, repo, filePath, defaultBranch);
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
  authorEmail: string
): Promise<{ prNumber: number; prUrl: string; filePath: string }> {
  const { token, owner, repo, defaultBranch } = config;

  const argId = extractId(args);
  const argName = typeof args.name === 'string' ? args.name : argId ?? 'unknown';
  const filePath = assetFilePath(sandboxName, toolName, argId, argName);
  const branch = makeBranchName(toolName);

  const baseSha = await getBranchSha(token, owner, repo, defaultBranch);
  await createBranch(token, owner, repo, branch, baseSha);

  const payload = {
    _meta: {
      operation: toolName,
      requestedBy: authorEmail,
      requestedAt: new Date().toISOString(),
      sandbox: sandboxName
    },
    ...args
  };

  await commitFile(
    token, owner, repo, filePath,
    JSON.stringify(payload, null, 2),
    `Proposed: ${toolName} — ${argName} [${authorEmail}]`,
    branch
  );

  const operationLabel = toolName.replace(/_/g, ' ');
  const pr = await createPullRequest(
    token, owner, repo,
    `[AJO] ${operationLabel}: ${argName}`,
    `## AJO Content Change Request\n\n` +
    `**Operation:** \`${toolName}\`\n` +
    `**Asset:** \`${argName}\`\n` +
    `**Sandbox:** \`${sandboxName}\`\n` +
    `**Requested by:** ${authorEmail}\n` +
    `**Requested at:** ${new Date().toISOString()}\n\n` +
    `## Changed File\n\n\`${filePath}\`\n\n` +
    `---\n\n` +
    `_After merging, call \`deploy_merged_changes\` with this PR URL to apply the change to AJO._`,
    branch,
    defaultBranch
  );

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
