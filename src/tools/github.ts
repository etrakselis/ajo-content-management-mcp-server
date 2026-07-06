import { isClientConfigured, getConfiguredGitHubIntegration, getConfiguredSandboxName, getConfiguredAuthorEmail, findContentIdByName, getFragment, getTemplate } from '../adobe/client.js';
import { checkPRStatus, readMergedPRContent } from '../github/sync.js';
import { notConfiguredError, withTelemetry, buildOutputSchema } from './utils.js';

// Handlers for all write tools — called during deploy to apply merged PR content to AJO.
import { handleCreateContentTemplate, handleUpdateContentTemplate, handlePatchContentTemplate, handleDeleteContentTemplate } from './templates.js';
import { handleCreateContentFragment, handleUpdateContentFragment, handlePatchContentFragment, handlePublishContentFragment, handleArchiveContentFragment } from './fragments.js';
import { handleCreateFolder, handleUpdateFolder, handleDeleteFolder } from './folders.js';
import { handleCreateTag, handleUpdateTag, handleDeleteTag } from './tags.js';

const GITHUB_NOT_CONFIGURED = {
  success: false,
  error: {
    code: 'GITHUB_NOT_CONFIGURED',
    message: 'GitHub integration is not enabled. Enable it on the setup page (GitHub Integration step), enter your PAT, owner, and repository, then re-activate the server.'
  }
};

// Dispatch map used by deploy_merged_changes to call the right AJO handler for
// each operation read from a merged PR file. Mirrors TOOL_HANDLERS in server.ts
// but only covers write tools (reads are never in a PR).
const DEPLOY_HANDLERS: Record<string, (args: unknown) => Promise<unknown>> = {
  create_content_template: handleCreateContentTemplate,
  update_content_template: handleUpdateContentTemplate,
  patch_content_template: handlePatchContentTemplate,
  delete_content_template: handleDeleteContentTemplate,
  create_content_fragment: handleCreateContentFragment,
  update_content_fragment: handleUpdateContentFragment,
  patch_content_fragment: handlePatchContentFragment,
  publish_content_fragment: handlePublishContentFragment,
  archive_content_fragment: handleArchiveContentFragment,
  create_folder: handleCreateFolder,
  update_folder: handleUpdateFolder,
  delete_folder: handleDeleteFolder,
  create_tag: handleCreateTag,
  update_tag: handleUpdateTag,
  delete_tag: handleDeleteTag
};

// Apply one operation read from a merged PR to AJO. UPDATE ops are the subtle case:
// the etag was captured when the PR was PROPOSED, but a full-replace update requires the
// CURRENT etag, and by the time a human reviews+merges the PR that baked-in etag is very
// likely stale — replaying it verbatim fails with CONFLICT. So for update_* ops, re-fetch
// the live object's etag immediately before applying and retry once if AJO still reports a
// conflict (a concurrent edit landed between fetch and write). Mirrors the promotion
// engine's deployOp, which already does this. All other ops apply their args unchanged
// (create dedup is handled by the caller; patch/delete carry no etag).
async function applyDeployOp(
  op: { toolName: string; args: Record<string, unknown> },
  handler: (args: unknown) => Promise<unknown>
): Promise<unknown> {
  const idKey = op.toolName === 'update_content_template' ? 'templateId'
    : op.toolName === 'update_content_fragment' ? 'fragmentId'
    : undefined;
  if (!idKey) return handler(op.args);
  const id = op.args[idKey];
  if (typeof id !== 'string') return handler(op.args); // let the handler's own validation surface it
  let result: { success?: boolean; error?: { code?: string } } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = op.toolName === 'update_content_template'
      ? await getTemplate(id)
      : await getFragment(id);
    result = await handler({ ...op.args, etag: current.etag }) as { success?: boolean; error?: { code?: string } };
    if (result?.success !== false || result.error?.code !== 'CONFLICT' || attempt === 1) break;
  }
  return result;
}

// ─── check_pr_status ──────────────────────────────────────────────────────────

export const checkPRStatusDefinition = {
  name: 'check_pr_status',
  title: 'Check GitHub PR Status',
  outputSchema: buildOutputSchema({
    data: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'PR number.' },
        state: { type: 'string', description: '"open", "closed", or the PR was merged (check merged field).' },
        merged: { type: 'boolean', description: 'true if the PR has been merged.' },
        title: { type: 'string', description: 'PR title.' },
        url: { type: 'string', description: 'PR URL.' },
        readyToDeploy: { type: 'boolean', description: 'true when merged — safe to call deploy_merged_changes.' }
      }
    }
  }),
  description: `Check the status of a GitHub pull request created by this server in PR Approval Gate mode.

Returns whether the PR is open, merged (and thus ready to deploy to AJO), or closed without merging. Call this after creating a PR with a write tool in approval-gate mode to determine whether it is safe to call deploy_merged_changes.

Example usage: { "prUrl": "https://github.com/owner/repo/pull/42" }

Returns: { success: true, data: { number, state, merged, title, url, readyToDeploy } }`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['prUrl'],
    properties: {
      prUrl: {
        type: 'string',
        description: 'Full GitHub PR URL, e.g. "https://github.com/owner/repo/pull/42".'
      }
    }
  }
};

export async function handleCheckPRStatus(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  const config = getConfiguredGitHubIntegration();
  if (!config) return GITHUB_NOT_CONFIGURED;

  return withTelemetry('check_pr_status', async () => {
    const { prUrl } = args as { prUrl: string };
    if (!prUrl?.trim()) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'prUrl is required.' }
      };
    }
    const status = await checkPRStatus(config, prUrl.trim());
    return {
      success: true,
      data: { ...status, readyToDeploy: status.merged }
    };
  }, args);
}

// ─── deploy_merged_changes ────────────────────────────────────────────────────

export const deployMergedChangesDefinition = {
  name: 'deploy_merged_changes',
  title: 'Deploy Merged GitHub PR to AJO',
  outputSchema: buildOutputSchema({
    data: {
      type: 'object',
      properties: {
        prUrl: { type: 'string', description: 'The PR that was deployed.' },
        operations: {
          type: 'array',
          description: 'Results of each AJO write executed from the merged PR.',
          items: {
            type: 'object',
            properties: {
              toolName: { type: 'string' },
              filePath: { type: 'string' },
              success: { type: 'boolean' },
              result: { description: 'The result returned by the AJO tool handler.' }
            }
          }
        }
      }
    }
  }),
  description: `Deploy the content changes from a merged GitHub PR to AJO. Only usable when GitHub integration is in PR Approval Gate mode.

When a write tool is called in approval-gate mode, this server creates a GitHub PR instead of writing to AJO. After a human reviews and merges the PR on GitHub, call this tool with the PR URL to apply the approved changes to AJO.

Call check_pr_status first to confirm the PR is merged before deploying.

Content creates are idempotent: deploying a PR whose content fragment/template already exists in the sandbox (by name) reuses it (result.reused: true) instead of creating a duplicate — so re-deploying the same merged PR is a no-op.

NOTE: for cross-sandbox PROMOTION PRs (opened by promote_assets, branch prefix "ajo-promote-"), do NOT use this tool — re-invoke promote_assets after merging and it deploys + advances the phased flow. (Deploying one here is still safe thanks to the dedup above, but it bypasses the phase orchestration.)

[Write operation] This tool writes to AJO — it requires write access to be enabled. It bypasses the PR approval gate (it IS the deployment step, not a new change).

Example usage: { "prUrl": "https://github.com/owner/repo/pull/42" }

Returns: { success: true, data: { prUrl, operations: [{ toolName, filePath, success, result }] } }`,
  annotations: { readOnlyHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['prUrl'],
    properties: {
      prUrl: {
        type: 'string',
        description: 'Full GitHub PR URL for a merged PR, e.g. "https://github.com/owner/repo/pull/42".'
      }
    }
  }
};

export async function handleDeployMergedChanges(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  const config = getConfiguredGitHubIntegration();
  if (!config) return GITHUB_NOT_CONFIGURED;

  return withTelemetry('deploy_merged_changes', async () => {
    const { prUrl } = args as { prUrl: string };
    if (!prUrl?.trim()) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'prUrl is required.' }
      };
    }

    const sandbox = getConfiguredSandboxName();
    const author = getConfiguredAuthorEmail();

    const operations = await readMergedPRContent(config, prUrl.trim());

    // Wrong-sandbox guard: the deploy handlers write to whatever sandbox is ACTIVE now
    // (the Adobe client reads it live), but this PR was proposed for a specific sandbox.
    // If the active sandbox was switched since the PR was proposed, applying it here would
    // land the reviewed changes in the wrong sandbox. Refuse the whole deploy — before any
    // write — rather than silently mis-target it.
    if (sandbox) {
      const mismatched = [...new Set(
        operations.map(op => op.sandbox).filter((s): s is string => !!s && s !== sandbox)
      )];
      if (mismatched.length > 0) {
        return {
          success: false,
          error: {
            code: 'SANDBOX_MISMATCH',
            message: `This PR proposes changes for sandbox "${mismatched.join('", "')}", but the server is currently pointed at "${sandbox}". ` +
              `Switch the active sandbox to "${mismatched[0]}" (setup page) and retry, so the merged changes are deployed to the sandbox they were reviewed for. ` +
              `Refusing to deploy to avoid a wrong-sandbox write.`
          }
        };
      }
    }

    const results: Array<{ toolName: string; filePath: string; success: boolean; result: unknown }> = [];

    for (const op of operations) {
      const handler = DEPLOY_HANDLERS[op.toolName];
      if (!handler) {
        results.push({
          toolName: op.toolName,
          filePath: op.filePath,
          success: false,
          result: { error: `Unknown operation "${op.toolName}" — no handler registered for it.` }
        });
        continue;
      }
      // Idempotent deploy: re-applying a content CREATE whose asset already exists
      // (same PR deployed twice) reuses it instead of duplicating — AJO does not
      // enforce name uniqueness, so a blind create would produce a duplicate.
      if (op.toolName === 'create_content_fragment' || op.toolName === 'create_content_template') {
        const name = typeof op.args.name === 'string' ? op.args.name : undefined;
        const type = op.toolName === 'create_content_template' ? 'template' : 'fragment';
        const existing = name ? await findContentIdByName(type, name) : undefined;
        if (existing) {
          results.push({
            toolName: op.toolName, filePath: op.filePath, success: true,
            result: { success: true, id: existing, reused: true, message: `Reused existing ${type} "${name}" (${existing}) — skipped a duplicate create.` }
          });
          continue;
        }
      }
      try {
        const result = await applyDeployOp(op, handler);
        const ok = (result as { success?: boolean }).success !== false;
        results.push({ toolName: op.toolName, filePath: op.filePath, success: ok, result });
      } catch (err) {
        results.push({
          toolName: op.toolName,
          filePath: op.filePath,
          success: false,
          result: { error: err instanceof Error ? err.message : String(err) }
        });
      }
    }

    const allSucceeded = results.every(r => r.success);
    return {
      success: allSucceeded,
      data: {
        prUrl: prUrl.trim(),
        sandbox,
        deployedBy: author,
        operations: results
      },
      ...(allSucceeded ? {} : {
        error: {
          code: 'PARTIAL_DEPLOY_FAILURE',
          message: `${results.filter(r => !r.success).length} of ${results.length} operation(s) failed. See data.operations for per-operation results.`
        }
      })
    };
  }, args);
}
