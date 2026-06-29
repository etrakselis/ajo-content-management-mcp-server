// Cross-sandbox content promotion tools: plan_promotion (read-only) and
// promote_assets (resumable, phased executor). Content is sourced from the GitHub
// repo (the committed JSON files), not from a live source AJO sandbox — so promotion
// touches only the TARGET sandbox at runtime. The heavy lifting lives in
// ../promotion/engine.ts; this layer is the MCP tool surface — input validation, the
// GitHub/approval-gate preconditions, the read-only gate, and a TARGET-aware write
// confirmation.
//
// These are deliberately NOT registered in WRITE_TOOLS: the server's dispatch-layer
// approval gate and write-confirmation gate are single-sandbox (keyed on the
// configured sandbox), but promotion writes to a DIFFERENT target sandbox per call.
// So this tool enforces read-only access and confirms the target itself, and lets the
// per-asset PRs it opens carry the approval gate.

import {
  isClientConfigured, getConfiguredSandboxName, getConfiguredGitHubIntegration,
  getConfiguredOrgName, getConfiguredTenantId, listFragments
} from '../adobe/client.js';
import { getWritesAllowed } from '../mcp/access-policy.js';
import { withSandbox } from '../adobe/sandbox-context.js';
import { planPromotion, executePromotion, PromotionError, type PromotionSelector } from '../promotion/engine.js';
import { notConfiguredError, withTelemetry, buildOutputSchema } from './utils.js';

const UI_BASE_URL = process.env.UI_BASE_URL ?? 'http://localhost:3000';

// Map an engine failure to a self-describing error envelope. PromotionError carries
// the failing domain (repo read vs target) + upstream detail; anything else is an
// unexpected internal error (still surfaced with its message, never an empty object).
function promotionError(err: unknown): { success: false; error: { code: string; message: string; details: Record<string, unknown> } } {
  if (err instanceof PromotionError) {
    return { success: false, error: { code: err.code, message: err.message, details: err.details } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INTERNAL_ERROR', message, details: {} } };
}

// ── Shared input shape (no oneOf/anyOf — Anthropic drops schemas that use them; the
//    "exactly one selector" rule is enforced in the handler instead). ──
const ENTRY_SELECTOR_PROPS = {
  templateName: { type: 'string' as const, description: 'Promote this content template and its full fragment-dependency closure.' },
  fragmentName: { type: 'string' as const, description: 'Promote this content fragment and any fragments it embeds.' },
  names: { type: 'array' as const, items: { type: 'string' as const }, description: 'Promote this explicit set of asset names (each resolved as a template and/or fragment in the repo source subtree).' },
  sourceSandbox: { type: 'string' as const, description: 'Which repo SUBTREE to read content from (e.g. "etrakselis-sandbox"), NOT a live AJO sandbox call. Defaults to the server\'s configured sandbox name.' },
  targetSandbox: { type: 'string' as const, description: 'AJO sandbox to promote TO (required). The configured credential must have write access to it. This is the only AJO sandbox promotion contacts.' },
  sourceRef: { type: 'string' as const, description: 'Optional git ref (branch, tag, or commit sha) to read source content from. Defaults to the repo\'s default branch, so only merged/approved content is promoted.' }
};

interface PromotionInput {
  templateName?: string;
  fragmentName?: string;
  names?: string[];
  sourceSandbox?: string;
  targetSandbox?: string;
  sourceRef?: string;
  confirmWrite?: boolean;
  dryRun?: boolean;
}

// Validate inputs into a selector + sandboxes. Entry resolution against the repo
// happens in the engine; this only checks shape.
function resolveInputs(
  input: PromotionInput
):
  | { ok: true; selector: PromotionSelector; sourceSandbox: string; targetSandbox: string; sourceRef?: string }
  | { ok: false; error: { code: string; message: string } } {
  const targetSandbox = input.targetSandbox?.trim();
  if (!targetSandbox) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'targetSandbox is required.' } };
  }
  const sourceSandbox = input.sourceSandbox?.trim() || getConfiguredSandboxName() || '';
  if (!sourceSandbox) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'sourceSandbox could not be determined (no configured sandbox and none supplied).' } };
  }
  if (sourceSandbox === targetSandbox) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: `sourceSandbox and targetSandbox are both "${targetSandbox}". sourceSandbox names the repo subtree to read FROM; it must differ from the AJO sandbox you promote TO. If the server is configured to the target, pass sourceSandbox explicitly (e.g. the dev sandbox's repo subtree).` } };
  }

  const selectors = [input.templateName, input.fragmentName, input.names].filter(v => v !== undefined && (!Array.isArray(v) || v.length > 0));
  if (selectors.length === 0) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Provide exactly one of templateName, fragmentName, or names.' } };
  }
  if (selectors.length > 1) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Provide only one of templateName, fragmentName, or names — not several.' } };
  }

  const selector: PromotionSelector = {};
  if (input.templateName) selector.templateName = input.templateName.trim();
  else if (input.fragmentName) selector.fragmentName = input.fragmentName.trim();
  else if (input.names?.length) selector.names = input.names.map(n => n.trim());

  return { ok: true, selector, sourceSandbox, targetSandbox, sourceRef: input.sourceRef?.trim() || undefined };
}

// Confirm the configured credential can actually reach the target sandbox, failing
// fast with a clear permissions error instead of a confusing mid-run 403.
async function preflightTarget(targetSandbox: string): Promise<{ code: string; message: string } | null> {
  try {
    await withSandbox(targetSandbox, async () => listFragments({ limit: 1 }));
    return null;
  } catch (err) {
    return {
      code: 'TARGET_ACCESS_DENIED',
      message: `The configured credential cannot read target sandbox "${targetSandbox}": ${err instanceof Error ? err.message : String(err)}. ` +
        `Confirm the sandbox name is correct and that this credential's product profile grants access to it.`
    };
  }
}

// ─── plan_promotion ──────────────────────────────────────────────────────────────

export const planPromotionDefinition = {
  name: 'plan_promotion',
  title: 'Plan Cross-Sandbox Promotion',
  outputSchema: buildOutputSchema({
    plan: {
      type: 'object',
      description: 'The promotion plan: phases (dependency-ordered), per-asset target status, and resolved folder/embed info — all derived from repo content + a target lookup.',
      properties: {
        sourceSandbox: { type: 'string' },
        targetSandbox: { type: 'string' },
        sourceRef: { type: 'string' },
        phases: { type: 'array', items: { type: 'object' } },
        assets: { type: 'array', items: { type: 'object' } },
        warnings: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } }
      }
    }
  }),
  description: `Build and return a read-only PLAN for promoting content fragments/templates into a TARGET AJO sandbox, WITHOUT writing anything.

Content is read from the GitHub repo (the committed JSON under the source sandbox's subtree), NOT from a live source AJO sandbox — so this needs read access to the repo and the target sandbox only. Resolves the full dependency closure (templates → embedded fragments → nested fragments, matched by embed name), computes the phase order (leaf fragments first), and for each asset reports its repo path, target folder path, embeds (by name), and whether it already exists in the target (targetStatus: absent | present). Surfaces blockers before any write — a missing repo file (SOURCE_FILE_NOT_FOUND), an embed whose name has no repo file, or a malformed helper tag.

Call this first to preview a promotion. Then use promote_assets to execute it.

Example usage: { "templateName": "NV_BIS_RestockAlert", "sourceSandbox": "etrakselis-sandbox", "targetSandbox": "prod" }

Returns: { success: true, plan: { sourceSandbox, targetSandbox, sourceRef, phases, assets, warnings, blockers } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['targetSandbox'],
    properties: { ...ENTRY_SELECTOR_PROPS }
  }
};

export async function handlePlanPromotion(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('plan_promotion', async () => {
    const input = (args ?? {}) as PromotionInput;
    const resolved = resolveInputs(input);
    if (!resolved.ok) return { success: false, error: resolved.error };

    // Promotion reads content from the repo, so GitHub must be configured.
    if (!getConfiguredGitHubIntegration()) {
      return { success: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: `plan_promotion reads source content from the GitHub repo, so GitHub integration must be configured. Enable it on the setup page (${UI_BASE_URL}).` } };
    }

    const denied = await preflightTarget(resolved.targetSandbox);
    if (denied) return { success: false, error: denied };

    try {
      const plan = await planPromotion(resolved.selector, resolved.sourceSandbox, resolved.targetSandbox, resolved.sourceRef);
      return { success: true, plan };
    } catch (err) {
      return promotionError(err);
    }
  });
}

// ─── promote_assets ──────────────────────────────────────────────────────────────

export const promoteAssetsDefinition = {
  name: 'promote_assets',
  title: 'Promote Assets Across Sandboxes',
  outputSchema: buildOutputSchema({
    status: { type: 'string', description: 'awaiting_merge | complete | blocked.' },
    sourceSandbox: { type: 'string' },
    targetSandbox: { type: 'string' },
    dryRun: { type: 'boolean', description: 'true if this was a validate-only run (nothing written).' },
    openPrs: { type: 'array', items: { type: 'object' }, description: 'PRs opened/awaiting merge this phase: [{ name, type, prUrl }].' },
    deployed: { type: 'array', items: { type: 'object' }, description: 'Assets applied to the target this call: [{ name, type, targetId, action: "created" | "updated" | "reused" }]. "reused" = a same-named asset already existed and was reused instead of duplicated (idempotent deploy).' },
    unchanged: { type: 'array', items: { type: 'object' }, description: 'Assets already live in the target (skipped).' },
    validated: { type: 'array', items: { type: 'object' }, description: 'Dry-run only: per-asset validateOnly results [{ name, type, warnings }].' },
    idMap: { type: 'object', description: 'Accumulated "type:name" → target id for everything already live.' },
    nextAction: { type: 'string', description: 'What the human/LLM should do next.' },
    targetSandboxNote: { type: 'string', description: 'Reminder that promotion writes to the target directly (no server sandbox switch needed). Relay to the user if relevant.' },
    warnings: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } }
  }),
  description: `Promote content fragments/templates into a TARGET AJO sandbox, re-resolving every environment-local UUID (embeds, folders, tags, self-references) by name/path in the target. Existing target assets are reused (updated when their source changed, else left unchanged) — never duplicated; re-running a finished promotion is a no-op.

REPO IS THE SOURCE OF TRUTH: content is read from the GitHub repo (the committed JSON under sourceSandbox's subtree, on the default branch unless sourceRef is given), NOT from a live source AJO sandbox. So promotion contacts only the TARGET sandbox at runtime — the credential needs target write access + repo read, NOT access to the source sandbox. If a referenced asset isn't in the repo, it fails with SOURCE_FILE_NOT_FOUND (no live fallback).

PHASED + RESUMABLE: this requires GitHub integration in PR Approval Gate mode. Each asset is proposed as its own PR for human review. Because a template's embed cannot be wired until the fragment it embeds is LIVE in the target, promotion runs in phases — leaf fragments first (embeds are matched by name, then rewritten to the target fragment's new UUID). Each call: deploys any of its PRs that were merged since last time, then opens PRs for the next assets whose dependencies are now satisfied. Call it again after merging the returned PRs until status is "complete". It is stateless across calls (it re-derives progress from the target + its own PRs), so it is always safe to re-invoke.

DO NOT call deploy_merged_changes yourself on promotion PRs — after merging, re-invoke promote_assets and it deploys them and advances. Deploys are idempotent (they dedup by name: a create whose asset already exists is reused, not duplicated, reported as action "reused"), so re-invoking — or even an accidental manual deploy — will not create duplicate target assets.

[Cross-sandbox write] Promotion writes to the TARGET sandbox. The first non-dry-run call (and each subsequent phase) is held with WRITE_CONFIRMATION_REQUIRED until you confirm the target with the user and re-invoke with confirmWrite: true. Promoting to production should be confirmed deliberately every time.

TARGET SANDBOX: promotion writes to "targetSandbox" directly via a per-call override — it does NOT use, and you do NOT need to switch, the MCP server's currently-configured sandbox (it stays on the source). If the user is unsure or thinks they must switch the server to the target first, reassure them they do not. Switching the server's active sandbox to the target (at the setup page) is only useful afterward, to browse or verify the promoted assets via other tools. Always confirm the target sandbox name with the user before writing — see the returned targetSandboxNote.

Use dryRun: true first (or plan_promotion) to validate without writing.

Example usage: { "templateName": "NV_BIS_RestockAlert", "targetSandbox": "prod", "confirmWrite": true }

Returns: { success: true, status, openPrs, deployed, unchanged, idMap, nextAction, warnings, blockers }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['targetSandbox'],
    properties: {
      ...ENTRY_SELECTOR_PROPS,
      dryRun: { type: 'boolean' as const, description: 'If true, runs validateOnly creates against the target and persists nothing (no PRs, no folder/tag writes). Use to preview before committing.' },
      confirmWrite: { type: 'boolean' as const, description: 'Required for a real (non-dry-run) promotion. Leave unset and the server returns WRITE_CONFIRMATION_REQUIRED naming the target sandbox; after the user confirms, re-invoke with confirmWrite: true. Never set without the user’s explicit confirmation.' }
    }
  }
};

export async function handlePromoteAssets(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('promote_assets', async () => {
    const input = (args ?? {}) as PromotionInput;
    const dryRun = input.dryRun === true;

    // Read-only gate (self-enforced — promote_assets is not a standard write tool).
    if (!dryRun && !getWritesAllowed()) {
      return { success: false, error: { code: 'READ_ONLY_MODE', message: `Write operations are disabled (read-only mode), so promote_assets cannot write to the target. Enable write access at ${UI_BASE_URL} and retry.` } };
    }

    // GitHub is required for ALL runs — content is read from the repo (even dry runs).
    const github = getConfiguredGitHubIntegration();
    if (!github) {
      return { success: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: `promote_assets reads source content from the GitHub repo, so GitHub integration must be configured. Enable it on the setup page (${UI_BASE_URL}).` } };
    }
    // The phased flow needs PR Approval Gate mode for real (non-dry-run) writes.
    if (!dryRun && !github.requireApproval) {
      return { success: false, error: { code: 'APPROVAL_GATE_REQUIRED', message: 'promote_assets requires GitHub integration in PR Approval Gate mode (it is currently in Audit Trail mode). Switch the mode on the setup page so each promoted asset goes through a reviewable PR. (dryRun: true works in any mode.)' } };
    }

    const resolved = resolveInputs(input);
    if (!resolved.ok) return { success: false, error: resolved.error };

    const denied = await preflightTarget(resolved.targetSandbox);
    if (denied) return { success: false, error: denied };

    // Target-aware write confirmation (the generic gate is blind to the override).
    if (!dryRun && input.confirmWrite !== true) {
      const org = getConfiguredOrgName();
      const tenantId = getConfiguredTenantId();
      const targetParts = [
        org ? `org "${org}"` : null,
        tenantId ? `tenant "_${tenantId}"` : null,
        `TARGET sandbox "${resolved.targetSandbox}"`
      ].filter(Boolean).join(', ');
      return {
        success: false,
        error: {
          code: 'WRITE_CONFIRMATION_REQUIRED',
          message: `Confirm promotion from repo subtree "${resolved.sourceSandbox}" to ${targetParts}. ` +
            `This opens GitHub PRs proposing the content for the target and (once merged) writes to it. ` +
            `Confirm with the user that "${resolved.targetSandbox}" is the intended target, then re-invoke promote_assets with the same arguments plus "confirmWrite": true. ` +
            `Do not set confirmWrite without the user's explicit confirmation. ` +
            targetSandboxNote(resolved.targetSandbox)
        }
      };
    }

    try {
      const result = await executePromotion(resolved.selector, resolved.sourceSandbox, resolved.targetSandbox, dryRun, resolved.sourceRef);
      return { success: result.status !== 'blocked', ...result, targetSandboxNote: targetSandboxNote(resolved.targetSandbox) };
    } catch (err) {
      return promotionError(err);
    }
  });
}

// Reminder surfaced on every promote_assets response: promotion writes to the target
// via a per-call override, so the user does NOT switch the server's active sandbox to
// promote — a common point of confusion. Switching is only useful afterward, to
// browse/verify the promoted assets in subsequent tool calls.
function targetSandboxNote(targetSandbox: string): string {
  return `Note on the target sandbox: promotion writes directly to "${targetSandbox}" — you do NOT need to switch the MCP server's active sandbox to promote (the server stays on the source sandbox). Tell the user this if they ask about switching. Only switch the server's active sandbox to "${targetSandbox}" at ${UI_BASE_URL} when you later want to browse or verify the promoted assets via other tools.`;
}
