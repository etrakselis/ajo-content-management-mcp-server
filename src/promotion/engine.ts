// Cross-sandbox content promotion engine — REPO-SOURCED.
//
// Promotes Content Fragments and Content Templates into a TARGET AJO sandbox using
// the GitHub repository as the source of truth for content. It reads the staged/
// merged JSON files committed under the SOURCE sandbox's subtree (written by this
// server's audit-trail / approval-gate commits), strips every environment-local
// UUID, and re-resolves each reference against the TARGET:
//   - embedded fragments  → looked up by NAME, rewritten to the target fragment id
//   - fragment self-ref   → ajo:SELF sentinel (target assigns a fresh id on create)
//   - parentFolderId      → target folder from the repo file PATH (ensure_folder_path)
//   - tagIds              → target tags resolved by NAME (from _meta.tagNames)
//
// Net effect: promotion contacts ONE AJO sandbox (the target) at runtime — it never
// reads the source sandbox. It still runs under the GitHub PR approval gate (one PR
// per asset), is phased (leaf fragments first — a template's embed can't be wired
// until that fragment is live in the target), and is stateless/resumable across
// calls (progress is re-derived from the target + the promotion PRs, which are
// marked with a deployed label once applied).

import { createHash } from 'node:crypto';
import {
  getFragment, getTemplate, findContentIdByName,
  getConfiguredGitHubIntegration, getConfiguredAuthorEmail,
  getConfiguredTenantId
} from '../adobe/client.js';
import { withSandbox } from '../adobe/sandbox-context.js';
import { listTags, createTag } from '../adobe/unified-tags-client.js';
import { handleEnsureFolderPath } from '../tools/folders.js';
import { handleCreateContentFragment, handleUpdateContentFragment } from '../tools/fragments.js';
import { handleCreateContentTemplate, handleUpdateContentTemplate } from '../tools/templates.js';
import {
  scanFragmentEmbedsWithNames, scanFragmentEmbeds, scanSelfFragmentIds,
  rewriteFragmentEmbedIds, resetSelfFragmentId, stripAcrContentStatus
} from '../tools/utils.js';
import { createApprovalPR, readMergedPRContent, readPriorPromotionMeta } from '../github/sync.js';
import {
  listPullRequests, getPullRequest, ensureLabelExists, addLabelsToPr,
  listRepoTree, getFileContent, getBranchSha
} from '../github/client.js';
import type { GitHubConfig } from '../github/types.js';

export type AssetType = 'fragment' | 'template';

// A promotion failure tagged with the domain that failed (repo read vs target), so
// the tool surface can report a self-describing error instead of an opaque 400. The
// upstream message/path is carried in `details`.
export class PromotionError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PromotionError';
    this.code = code;
    this.details = details;
  }
}

// Label stamped on a promotion PR once its content has been applied to AJO. It is
// the stateless "deployed" marker: target liveness alone can't tell whether a merged
// UPDATE was applied (the asset is already live), so we record deployment in GitHub.
const DEPLOYED_LABEL = 'ajo-promotion-deployed';

// folderType nouns differ by family (the AJO asymmetry): fragments use "fragment",
// templates use "content-template". Repo directory names differ again.
const folderTypeFor = (t: AssetType): string => (t === 'template' ? 'content-template' : 'fragment');
const repoDirFor = (t: AssetType): string => (t === 'template' ? 'content-templates' : 'content-fragments');
const createToolFor = (t: AssetType): string => (t === 'template' ? 'create_content_template' : 'create_content_fragment');
const updateToolFor = (t: AssetType): string => (t === 'template' ? 'update_content_template' : 'update_content_fragment');

const normName = (s: string): string => s.trim().toLowerCase();
const key = (type: AssetType, name: string): string => `${type}:${normName(name)}`;

// Branch-name segment: GitHub branch refs allow a limited charset; collapse anything
// else and cap length so the deterministic prefix stays matchable across phases.
const safeBranch = (s: string): string => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
const PROMOTE_BRANCH_PREFIX = 'ajo-promote-';
const branchPrefixFor = (type: AssetType, name: string): string => `${PROMOTE_BRANCH_PREFIX}${type}-${safeBranch(name)}-`;

// What the caller wants promoted. Exactly one of the three is honored.
export interface PromotionSelector {
  templateName?: string;
  fragmentName?: string;
  names?: string[];
}

interface SourceAsset {
  name: string;                 // authoritative name (from the repo file's args.name)
  type: AssetType;
  repoPath: string;             // path of the JSON file in the repo
  data: Record<string, unknown>; // the create args (repo file minus _meta)
  folderSegments: string[];     // folder path, derived from repoPath
  tagNames: string[];           // from _meta.tagNames (empty if the file predates capture)
  tagIdsPresentWithoutNames: boolean; // file carried tagIds but no _meta.tagNames
  embeds: Array<{ sourceId: string; name: string }>; // ajo embeds in the body
}

interface Graph {
  assets: Map<string, SourceAsset>; // key(type,name) -> asset
  order: string[];                  // keys, dependency order (deepest first)
  levelOf: Map<string, number>;     // key -> phase level (1 = leaf)
  warnings: string[];
  blockers: string[];
}

// ─── Target reads: id lookup by name (target sandbox only) ───────────────────────

// Exact-name id lookup in the active sandbox (see findContentIdByName for why it uses
// `name~^`, not `name==`). Promotion always operates within a withSandbox(target) scope
// when calling this, so it resolves against the target.
const findIdByName = (type: AssetType, name: string): Promise<string | undefined> =>
  findContentIdByName(type, name);

// ─── Repo index: locate asset JSON files by name without knowing their folder ─────

interface RepoIndex {
  byType: Record<AssetType, Map<string, string>>; // normName -> repo path (fragments/templates)
  tags: Map<string, string>;                       // normName -> repo path (the tags/ subtree)
  ambiguous: Set<string>;                          // `${type}:${normName}` with >1 file
  treeSha: string;
  truncated: boolean;
}

// Resolve a ref (branch name, tag, or sha) to a commit sha for a consistent snapshot.
async function resolveTreeSha(config: GitHubConfig, ref: string): Promise<string> {
  try { return await getBranchSha(config.token, config.owner, config.repo, ref); }
  catch { return ref; } // not a branch (tag/sha) — use as-is
}

async function buildRepoIndex(config: GitHubConfig, sourceSandbox: string, ref: string): Promise<RepoIndex> {
  let treeSha: string;
  let tree: Array<{ path: string; type: string; sha: string }>;
  let truncated: boolean;
  try {
    treeSha = await resolveTreeSha(config, ref);
    ({ tree, truncated } = await listRepoTree(config.token, config.owner, config.repo, treeSha));
  } catch (err) {
    throw new PromotionError(
      'SOURCE_REPO_READ_FAILED',
      `Could not read the file tree of ${config.owner}/${config.repo} at ref "${ref}": ${err instanceof Error ? err.message : String(err)}`,
      { repo: `${config.owner}/${config.repo}`, ref }
    );
  }
  const byType: Record<AssetType, Map<string, string>> = { fragment: new Map(), template: new Map() };
  const tags = new Map<string, string>();
  const ambiguous = new Set<string>();
  const types: AssetType[] = ['fragment', 'template'];
  for (const e of tree) {
    if (e.type !== 'blob' || !e.path.endsWith('.json')) continue;
    for (const t of types) {
      if (!e.path.startsWith(`${sourceSandbox}/${repoDirFor(t)}/`)) continue;
      const base = e.path.slice(e.path.lastIndexOf('/') + 1).replace(/\.json$/, '');
      const nk = normName(base);
      if (byType[t].has(nk)) ambiguous.add(`${t}:${nk}`);
      else byType[t].set(nk, e.path);
    }
    // Tags live flat at <sandbox>/tags/<name>.json (they carry no folder path). Indexed
    // separately so promotion (fragment/template only) is untouched; surfaced by
    // list_repo_assets so the LLM can also see committed tags.
    if (e.path.startsWith(`${sourceSandbox}/tags/`)) {
      const base = e.path.slice(e.path.lastIndexOf('/') + 1).replace(/\.json$/, '');
      tags.set(normName(base), e.path);
    }
  }
  return { byType, tags, ambiguous, treeSha, truncated };
}

async function readRepoAsset(
  config: GitHubConfig, treeSha: string, path: string
): Promise<{ args: Record<string, unknown>; meta: Record<string, unknown> }> {
  const raw = await getFileContent(config.token, config.owner, config.repo, path, treeSha);
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const { _meta, ...args } = parsed;
  return { args, meta: (_meta && typeof _meta === 'object' ? _meta : {}) as Record<string, unknown> };
}

// Folder path segments from a repo file path: the parts between the asset-type dir
// and the filename, e.g. ".../content-fragments/NV/BIS/Restock/Name.json" → ["NV","BIS","Restock"].
function folderSegmentsFromPath(path: string, repoDir: string): string[] {
  const parts = path.split('/');
  const i = parts.indexOf(repoDir);
  if (i < 0 || i >= parts.length - 1) return [];
  return parts.slice(i + 1, -1);
}

// ─── Dependency graph (built from REPO content) ──────────────────────────────────

async function buildGraphFromRepo(
  config: GitHubConfig, selector: PromotionSelector, index: RepoIndex
): Promise<Graph> {
  const assets = new Map<string, SourceAsset>();
  const warnings: string[] = [];
  const blockers: string[] = [];
  const onStack = new Set<string>();
  if (index.truncated) {
    warnings.push('The repo file listing was truncated (very large repository) — a referenced asset may not be found; if so, narrow the promotion or reduce the repo size.');
  }

  async function addAsset(type: AssetType, name: string): Promise<string | undefined> {
    const k = key(type, name);
    if (assets.has(k)) return k;
    if (onStack.has(k)) { blockers.push(`Embed cycle detected at ${type} "${name}" — aborting that branch.`); return undefined; }
    if (index.ambiguous.has(`${type}:${normName(name)}`)) {
      blockers.push(`Ambiguous: more than one ${type} file named "${name}" exists in the source subtree — cannot pick one.`);
      return undefined;
    }
    const path = index.byType[type].get(normName(name));
    if (!path) {
      blockers.push(`SOURCE_FILE_NOT_FOUND: no ${type} named "${name}" under the source subtree (expected ${repoDirFor(type)}/.../${name}.json). Promotion reads from the repo, so the asset must have been committed there.`);
      return undefined;
    }
    onStack.add(k);
    try {
      const { args, meta } = await readRepoAsset(config, index.treeSha, path);
      const realName = typeof args.name === 'string' && args.name ? args.name : name;
      const folderSegments = folderSegmentsFromPath(path, repoDirFor(type));
      const tagNames = Array.isArray(meta.tagNames) ? (meta.tagNames.filter(x => typeof x === 'string') as string[]) : [];
      const tagIdsPresent = Array.isArray(args.tagIds) && args.tagIds.length > 0;

      const scanned = scanFragmentEmbedsWithNames(args);
      for (const bad of scanFragmentEmbeds(args).malformed) {
        blockers.push(`${realName}: malformed embed id "${bad}" (missing ajo:/aem:/external: prefix) — fix the source content before promoting.`);
      }
      const embeds: Array<{ sourceId: string; name: string }> = [];
      for (const e of scanned) {
        if (e.source !== 'ajo') {
          warnings.push(`${realName}: embeds a ${e.source}: reference (${e.reference}) that is NOT promoted by this tool — ensure the referenced ${e.source.toUpperCase()} asset exists in the target environment.`);
          continue;
        }
        if (!e.name) {
          blockers.push(`${realName}: an ajo embed (id ${e.id}) has no name= attribute, so it can't be resolved from the repo. Add name="<fragment name>" to the {{ fragment }} helper in the source.`);
          continue;
        }
        embeds.push({ sourceId: e.id, name: e.name });
      }

      assets.set(k, { name: realName, type, repoPath: path, data: args, folderSegments, tagNames, tagIdsPresentWithoutNames: tagIdsPresent && tagNames.length === 0, embeds });
      for (const emb of embeds) await addAsset('fragment', emb.name);
      return k;
    } catch (err) {
      blockers.push(`Failed to read ${type} "${name}" from the repo (${path}): ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    } finally {
      onStack.delete(k);
    }
  }

  // Resolve the entry selector against the repo.
  if (selector.templateName) {
    await addAsset('template', selector.templateName);
  } else if (selector.fragmentName) {
    await addAsset('fragment', selector.fragmentName);
  } else if (selector.names?.length) {
    for (const name of selector.names) {
      const nk = normName(name);
      const inTemplate = index.byType.template.has(nk);
      const inFragment = index.byType.fragment.has(nk);
      if (!inTemplate && !inFragment) { blockers.push(`SOURCE_FILE_NOT_FOUND: "${name}" not found as a template or fragment under the source subtree.`); continue; }
      if (inTemplate) await addAsset('template', name);
      if (inFragment) await addAsset('fragment', name);
    }
  } else {
    // No selector → the WHOLE subtree (every template + fragment under it). Used by
    // deploy_repo_assets to sync an entire subtree. (Dependencies are pulled in by
    // recursion regardless, so this just seeds every top-level asset.)
    for (const nk of index.byType.template.keys()) await addAsset('template', nk);
    for (const nk of index.byType.fragment.keys()) await addAsset('fragment', nk);
  }

  // Phase levels: leaf = 1, else 1 + max(level of embedded fragments). Edges resolve
  // by embed NAME (the cross-sandbox-stable identifier).
  const levelOf = new Map<string, number>();
  const computing = new Set<string>();
  function level(k: string): number {
    if (levelOf.has(k)) return levelOf.get(k)!;
    if (computing.has(k)) return 1;
    computing.add(k);
    let lvl = 1;
    for (const emb of assets.get(k)?.embeds ?? []) {
      const depKey = key('fragment', emb.name);
      if (assets.has(depKey)) lvl = Math.max(lvl, level(depKey) + 1);
    }
    computing.delete(k);
    levelOf.set(k, lvl);
    return lvl;
  }
  for (const k of assets.keys()) level(k);

  const order = [...assets.keys()].sort((a, b) => levelOf.get(a)! - levelOf.get(b)!);
  return { assets, order, levelOf, warnings, blockers };
}

// ─── Target resolution ───────────────────────────────────────────────────────────

async function resolveLiveIds(graph: Graph, targetSandbox: string): Promise<Map<string, string>> {
  const live = new Map<string, string>();
  try {
    await withSandbox(targetSandbox, async () => {
      for (const [k, asset] of graph.assets) {
        const id = await findIdByName(asset.type, asset.name);
        if (id) live.set(k, id);
      }
    });
  } catch (err) {
    throw new PromotionError(
      'TARGET_READ_FAILED',
      `Could not look up existing assets in target sandbox "${targetSandbox}": ${err instanceof Error ? err.message : String(err)}`,
      { targetSandbox }
    );
  }
  return live;
}

// Ensure the asset's folder path (from the repo) exists in the target; return the
// target leaf folder id. Folder creation is intentional and eager.
async function ensureTargetFolder(
  asset: SourceAsset, targetSandbox: string
): Promise<{ leafFolderId?: string; warning?: string }> {
  if (asset.folderSegments.length === 0) return {};
  const ftype = folderTypeFor(asset.type);
  try {
    const res = await withSandbox(targetSandbox, async () =>
      handleEnsureFolderPath({ folderType: ftype, path: asset.folderSegments })) as { success?: boolean; leafFolderId?: string; error?: { message?: string } };
    if (res.success && res.leafFolderId) return { leafFolderId: res.leafFolderId };
    return { warning: `${asset.name}: could not create target folder path ${asset.folderSegments.join('/')}: ${res.error?.message ?? 'unknown error'} — promoting unfiled.` };
  } catch (err) {
    return { warning: `${asset.name}: target folder creation failed: ${err instanceof Error ? err.message : String(err)} — promoting unfiled.` };
  }
}

// Resolve the asset's tag NAMES (from the repo _meta) to target tag ids, creating
// missing tags. Best-effort. Warns if the repo file carried tag ids but no names.
async function resolveTargetTags(
  asset: SourceAsset, targetSandbox: string
): Promise<{ tagIds: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (asset.tagIdsPresentWithoutNames) {
    warnings.push(`${asset.name}: source tags were NOT promoted — the repo file records tag ids (environment-local), not names. Re-commit the source asset through this server to capture tag names, or tag it in the target manually.`);
  }
  const tagIds: string[] = [];
  for (const name of asset.tagNames) {
    try {
      const id = await withSandbox(targetSandbox, async () => findOrCreateTag(name));
      if (id) tagIds.push(id);
      else warnings.push(`${asset.name}: could not resolve/create tag "${name}" in target — skipped.`);
    } catch (err) {
      warnings.push(`${asset.name}: tag "${name}" failed: ${err instanceof Error ? err.message : String(err)} — skipped.`);
    }
  }
  return { tagIds, warnings };
}

async function findOrCreateTag(name: string): Promise<string | undefined> {
  const target = normName(name);
  const res = await listTags({ limit: 1000 }) as { tags?: Array<Record<string, unknown>> };
  const existing = (res.tags ?? []).find(t => typeof t.name === 'string' && normName(t.name) === target);
  if (existing && typeof existing.id === 'string') return existing.id;
  const created = await createTag({ name }) as { id?: string };
  return typeof created?.id === 'string' ? created.id : undefined;
}

// ─── Payload rebuild ─────────────────────────────────────────────────────────────

// Build the create_* args for the target from the repo content, re-resolving every
// cross-reference: embeds → target fragment ids, self-ref → ajo:SELF, folder → target
// leaf id, tags → target ids, stripping AJO's export-only acr-content-status meta.
// Only specific fields are carried (never a blind spread), so source-only fields like
// id/etag/fragmentId in the repo data are dropped.
function rebuildArgs(
  asset: SourceAsset,
  embedIdMap: Map<string, string>,
  targetFolderId: string | undefined,
  targetTagIds: string[]
): Record<string, unknown> {
  const d = asset.data;
  if (asset.type === 'fragment') {
    let fragment = d.fragment;
    fragment = stripAcrContentStatus(fragment);
    fragment = resetSelfFragmentId(fragment);
    fragment = rewriteFragmentEmbedIds(fragment, embedIdMap);
    const args: Record<string, unknown> = { name: asset.name, type: d.type, channels: d.channels, fragment };
    if (typeof d.subType === 'string') args.subType = d.subType;
    if (Array.isArray(d.labels)) args.labels = d.labels;
    if (targetTagIds.length) args.tagIds = targetTagIds;
    if (targetFolderId) args.parentFolderId = targetFolderId;
    return args;
  }
  let template = d.template;
  template = stripAcrContentStatus(template);
  template = rewriteFragmentEmbedIds(template, embedIdMap);
  const args: Record<string, unknown> = { name: asset.name, templateType: d.templateType, channels: d.channels, template };
  if (typeof d.description === 'string') args.description = d.description;
  if (typeof d.subType === 'string') args.subType = d.subType;
  if (Array.isArray(d.labels)) args.labels = d.labels;
  if (targetTagIds.length) args.tagIds = targetTagIds;
  if (targetFolderId) args.parentFolderId = targetFolderId;
  return args;
}

// Safety net (spec): after rewiring, no source UUID may survive in the staged target
// content. Returns any source ids (embed source ids + the source self-id) still
// present in the rebuilt args — non-empty means a rewiring bug.
function findLeakedSourceUuids(rebuilt: Record<string, unknown>, asset: SourceAsset): string[] {
  const forbidden = new Set<string>();
  for (const e of asset.embeds) forbidden.add(e.sourceId);
  for (const v of scanSelfFragmentIds(asset.data)) {
    const m = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(v);
    if (m) forbidden.add(m[1]);
  }
  if (forbidden.size === 0) return [];
  const serialized = JSON.stringify(rebuilt);
  return [...forbidden].filter(id => serialized.includes(id));
}

// ─── Source-change detection ─────────────────────────────────────────────────────

// Deterministic JSON with sorted keys, so hashing is stable regardless of property
// order. Exported for unit testing (idempotency hinges on order-stability).
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

// Fingerprint of the repo content's promotable fields. Stored in the target PR file's
// _meta.sourceContentHash and recomputed on re-promotion to detect whether the repo
// source changed since the asset was last promoted (source-vs-source — immune to AJO
// re-serializing content on the target). Content body is normalized so export noise
// doesn't change the hash.
function computeSourceContentHash(asset: SourceAsset): string {
  const d = asset.data;
  const norm = (v: unknown) => resetSelfFragmentId(stripAcrContentStatus(v));
  const subject = asset.type === 'fragment'
    ? { name: asset.name, type: d.type, channels: d.channels, subType: d.subType, labels: d.labels, content: norm(d.fragment) }
    : { name: asset.name, templateType: d.templateType, channels: d.channels, subType: d.subType, labels: d.labels, description: d.description, content: norm(d.template) };
  return createHash('sha256').update(stableStringify(subject)).digest('hex');
}

// ─── Deploy merged promotion PR content into the target ──────────────────────────

const DEPLOY_HANDLERS: Record<string, (args: unknown) => Promise<unknown>> = {
  create_content_fragment: handleCreateContentFragment,
  create_content_template: handleCreateContentTemplate,
  update_content_fragment: handleUpdateContentFragment,
  update_content_template: handleUpdateContentTemplate
};

const isUpdateTool = (t: string): boolean => t.startsWith('update_');
const assetTypeOfTool = (t: string): AssetType => (t.includes('template') ? 'template' : 'fragment');

type DeployAction = 'created' | 'updated' | 'reused';

// Apply one merged PR operation to the target. For CREATE ops it first dedups by name:
// AJO does not enforce name uniqueness, so re-applying a create (same PR twice, or a
// manual deploy_merged_changes followed by promote_assets) would otherwise produce a
// duplicate — instead we reuse the existing asset's id. For UPDATE ops the etag is
// fetched fresh here (never baked into the PR — it could be stale by merge time) with
// one retry on a stale-etag conflict. Must run inside a withSandbox(target) scope.
async function deployOp(op: { toolName: string; args: Record<string, unknown> }): Promise<{ id: string; action: DeployAction } | undefined> {
  const handler = DEPLOY_HANDLERS[op.toolName];
  if (!handler) return undefined;
  const type = assetTypeOfTool(op.toolName);

  if (!isUpdateTool(op.toolName)) {
    const name = typeof op.args.name === 'string' ? op.args.name : undefined;
    if (name) {
      const existing = await findIdByName(type, name);
      if (existing) return { id: existing, action: 'reused' }; // dedup — do not create a duplicate
    }
    const result = await handler(op.args) as { success?: boolean; id?: string };
    return result?.success !== false && typeof result?.id === 'string' ? { id: result.id, action: 'created' } : undefined;
  }

  const idKey = type === 'template' ? 'templateId' : 'fragmentId';
  const id = op.args[idKey];
  if (typeof id !== 'string') return undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = type === 'template' ? await getTemplate(id) : await getFragment(id);
    const result = await handler({ ...op.args, etag: current.etag }) as { success?: boolean; error?: { code?: string } };
    if (result?.success !== false) return { id, action: 'updated' };
    if (result.error?.code === 'CONFLICT' && attempt === 0) continue;
    return undefined;
  }
  return undefined;
}

async function deployMergedPr(
  config: GitHubConfig, prUrl: string, targetSandbox: string
): Promise<Array<{ type: AssetType; name: string; targetId: string; action: DeployAction }>> {
  const ops = await readMergedPRContent(config, prUrl);
  const out: Array<{ type: AssetType; name: string; targetId: string; action: DeployAction }> = [];
  await withSandbox(targetSandbox, async () => {
    for (const op of ops) {
      const applied = await deployOp(op);
      if (!applied) continue;
      out.push({
        type: assetTypeOfTool(op.toolName),
        name: typeof op.args.name === 'string' ? op.args.name : '(unknown)',
        targetId: applied.id,
        action: applied.action
      });
    }
  });
  return out;
}

// ─── Plan (read-only) ────────────────────────────────────────────────────────────

export interface PlanAsset {
  name: string;
  type: AssetType;
  repoPath: string;
  phase: number;
  folderPath: string[];
  embeds: Array<{ name: string; sourceId: string }>;
  targetStatus: 'absent' | 'present';
  targetId?: string;
}

export interface PromotionPlan {
  sourceSandbox: string;
  targetSandbox: string;
  sourceRef: string;
  phases: Array<{ phase: number; assets: Array<{ name: string; type: AssetType }> }>;
  assets: PlanAsset[];
  warnings: string[];
  blockers: string[];
}

export async function planPromotion(
  selector: PromotionSelector, sourceSandbox: string, targetSandbox: string, sourceRef?: string
): Promise<PromotionPlan> {
  const config = getConfiguredGitHubIntegration();
  const ref = sourceRef ?? config?.defaultBranch ?? 'main';
  if (!config) {
    return { sourceSandbox, targetSandbox, sourceRef: ref, phases: [], assets: [], warnings: [], blockers: ['GitHub integration is not configured — promotion reads content from the repo, so a repo must be configured.'] };
  }

  const index = await buildRepoIndex(config, sourceSandbox, ref);
  const graph = await buildGraphFromRepo(config, selector, index);
  const live = await resolveLiveIds(graph, targetSandbox);

  const assets: PlanAsset[] = graph.order.map(k => {
    const a = graph.assets.get(k)!;
    return {
      name: a.name, type: a.type, repoPath: a.repoPath,
      phase: graph.levelOf.get(k)!,
      folderPath: a.folderSegments,
      embeds: a.embeds.map(e => ({ name: e.name, sourceId: e.sourceId })),
      targetStatus: live.has(k) ? 'present' : 'absent',
      ...(live.has(k) ? { targetId: live.get(k) } : {})
    };
  });

  const maxLevel = Math.max(0, ...assets.map(a => a.phase));
  const phases = [];
  for (let p = 1; p <= maxLevel; p++) {
    const inPhase = assets.filter(a => a.phase === p).map(a => ({ name: a.name, type: a.type }));
    if (inPhase.length) phases.push({ phase: p, assets: inPhase });
  }

  return { sourceSandbox, targetSandbox, sourceRef: ref, phases, assets, warnings: graph.warnings, blockers: graph.blockers };
}

// ─── Execute (resumable, phased) ─────────────────────────────────────────────────

export interface PromotionResult {
  status: 'awaiting_merge' | 'complete' | 'blocked';
  sourceSandbox: string;
  targetSandbox: string;
  sourceRef: string;
  dryRun: boolean;
  openPrs: Array<{ name: string; type: AssetType; prUrl: string; action: 'create' | 'update' }>;
  deployed: Array<{ name: string; type: AssetType; targetId: string; action: 'created' | 'updated' | 'reused' }>;
  unchanged: Array<{ name: string; type: AssetType }>;
  validated?: Array<{ name: string; type: AssetType; action: 'create' | 'update'; warnings: string[] }>;
  idMap: Record<string, string>;
  nextAction: string;
  warnings: string[];
  blockers: string[];
}

// Per-asset PR state, derived once from GitHub so pass 1 (deploy) and pass 2 (open)
// agree and we never double-fetch a PR.
type PrState =
  | { kind: 'none' }
  | { kind: 'open'; url: string }
  | { kind: 'merged-undeployed'; url: string }
  | { kind: 'merged-deployed' }
  | { kind: 'rejected'; url: string };

export async function executePromotion(
  selector: PromotionSelector, sourceSandbox: string, targetSandbox: string, dryRun: boolean, sourceRef?: string
): Promise<PromotionResult> {
  const config = getConfiguredGitHubIntegration()!; // caller guarantees configured + approval-gate for real runs
  const author = getConfiguredAuthorEmail() ?? 'unknown';
  const tenantId = getConfiguredTenantId();
  const tenant = tenantId ? `_${tenantId}` : undefined;
  const ref = sourceRef ?? config.defaultBranch ?? 'main';

  const index = await buildRepoIndex(config, sourceSandbox, ref);
  const graph = await buildGraphFromRepo(config, selector, index);
  const warnings = [...graph.warnings];
  const blockers = [...graph.blockers];
  const live = await resolveLiveIds(graph, targetSandbox);

  const openPrs: PromotionResult['openPrs'] = [];
  const deployed: PromotionResult['deployed'] = [];
  const unchanged: PromotionResult['unchanged'] = [];
  const validated: NonNullable<PromotionResult['validated']> = [];
  const blockedKeys = new Set<string>();
  const deployedKeys = new Set<string>();

  const embedMapFor = (a: SourceAsset): { map: Map<string, string>; missing: boolean } => {
    const map = new Map<string, string>();
    let missing = false;
    for (const emb of a.embeds) {
      const tid = live.get(key('fragment', emb.name));
      if (tid) map.set(emb.sourceId, tid); else missing = true;
    }
    return { map, missing };
  };

  // ── Dry run: validate content + report intended action, no GitHub writes ──
  if (dryRun) {
    for (const k of graph.order) {
      const a = graph.assets.get(k)!;
      const action = live.has(k) ? 'update' : 'create';
      const args = rebuildArgs(a, embedMapFor(a).map, undefined, []);
      // The UUID guard, classified for dry-run. A surviving source id that belongs to
      // an in-batch fragment not yet live is EXPECTED here (a dry run creates nothing,
      // so there's no target id to rewrite the embed to — the real run rewires it in a
      // later phase). Only a genuinely dangling/unresolvable id stays a blocker.
      for (const uuid of findLeakedSourceUuids(args, a)) {
        const emb = a.embeds.find(e => e.sourceId === uuid);
        const depKey = emb ? key('fragment', emb.name) : undefined;
        const inBatch = depKey ? graph.assets.has(depKey) : false;
        const liveInTarget = depKey ? live.has(depKey) : false;
        if (inBatch && !liveInTarget) {
          warnings.push(`${a.name}: embed "${emb!.name}" (source id ${uuid}) still holds the source id in this dry run — it will be rewired to the target id in phase ${depKey ? graph.levelOf.get(depKey) : '?'} once that fragment is live in the target (expected during a dry run).`);
        } else {
          blockers.push(`${a.name}: source UUID ${uuid} survived rewiring and is not an in-batch dependency — would not promote (dangling/unresolvable embed).`);
        }
      }
      const handler = DEPLOY_HANDLERS[createToolFor(a.type)];
      const res = await withSandbox(targetSandbox, async () => handler({ ...args, validateOnly: true })) as { warnings?: string[] };
      validated.push({ name: a.name, type: a.type, action, warnings: res.warnings ?? [] });
    }
    return {
      status: blockers.length ? 'blocked' : 'complete',
      sourceSandbox, targetSandbox, sourceRef: ref, dryRun: true,
      openPrs, deployed, unchanged, validated,
      idMap: Object.fromEntries(live),
      nextAction: blockers.length ? 'Resolve the blockers above, then re-run the dry run.'
        : 'Dry run only — nothing was written. Re-run without dryRun (with confirmWrite) to begin promoting.',
      warnings, blockers
    };
  }

  // ── Derive each asset's PR state from GitHub (one pass) ──
  await ensureLabelExists(config.token, config.owner, config.repo, DEPLOYED_LABEL);
  const promoPrs = (await listPullRequests(config.token, config.owner, config.repo, { state: 'all' }))
    .filter(p => p.head?.ref?.startsWith(PROMOTE_BRANCH_PREFIX));
  const prState = new Map<string, PrState>();
  for (const k of graph.order) {
    const a = graph.assets.get(k)!;
    const prefix = branchPrefixFor(a.type, a.name);
    const recent = promoPrs.find(p => p.head.ref.startsWith(prefix)); // newest-first
    if (!recent) { prState.set(k, { kind: 'none' }); continue; }
    if (recent.state === 'open') { prState.set(k, { kind: 'open', url: recent.html_url }); continue; }
    const full = await getPullRequest(config.token, config.owner, config.repo, recent.number);
    if (!full.merged) { prState.set(k, { kind: 'rejected', url: full.html_url }); continue; }
    const labeled = (full.labels ?? []).some(l => l.name === DEPLOYED_LABEL);
    prState.set(k, labeled ? { kind: 'merged-deployed' } : { kind: 'merged-undeployed', url: full.html_url });
  }

  // ── Pass 1: deploy merged-but-not-yet-deployed PRs (deepest first) ──
  for (const k of graph.order) {
    const a = graph.assets.get(k)!;
    const st = prState.get(k)!;
    if (st.kind !== 'merged-undeployed') continue;
    try {
      const results = await deployMergedPr(config, st.url, targetSandbox);
      // Match this asset's op; fall back to the sole result ONLY on a single-op PR
      // (promotion PRs are single-op). Never guess on a multi-op PR — that could map the
      // asset to a DIFFERENT asset's target id.
      const mine = results.find(r => r.type === a.type && normName(r.name) === normName(a.name))
        ?? (results.length === 1 ? results[0] : undefined);
      if (mine) {
        // Stamp the deployed-label ONLY after confirming an op actually applied. Labeling
        // an empty/failed deploy would flip the PR to "merged-deployed" and permanently
        // skip the retry on the next run — silently losing an update whose deployOp
        // returned undefined (a persistent CONFLICT or a handler success:false).
        const num = parsePRUrlNumber(st.url);
        if (num) await addLabelsToPr(config.token, config.owner, config.repo, num, [DEPLOYED_LABEL]);
        live.set(k, mine.targetId); deployedKeys.add(k); deployed.push({ name: a.name, type: a.type, targetId: mine.targetId, action: mine.action });
      }
      else { blockers.push(`${a.name}: merged PR ${st.url} did not deploy cleanly — no operation applied (check target write access and the PR contents). Left unlabeled so it is retried on the next run.`); blockedKeys.add(k); }
    } catch (err) {
      blockers.push(`${a.name}: deploying merged PR ${st.url} failed: ${err instanceof Error ? err.message : String(err)}`);
      blockedKeys.add(k);
    }
  }

  // ── Pass 2: open create/update PRs for assets whose deps are satisfied ──
  for (const k of graph.order) {
    const a = graph.assets.get(k)!;
    if (deployedKeys.has(k) || blockedKeys.has(k)) continue;
    const st = prState.get(k)!;
    if (st.kind === 'open') { openPrs.push({ name: a.name, type: a.type, prUrl: st.url, action: live.has(k) ? 'update' : 'create' }); continue; }
    if (st.kind === 'rejected') {
      blockers.push(`${a.name}: its most recent promotion PR (${st.url}) was closed without merging — skipping it and any dependents. Merge it, or delete it to allow a fresh PR.`);
      blockedKeys.add(k);
      continue;
    }

    const present = live.has(k);
    let action: 'create' | 'update';
    if (present) {
      const currentHash = computeSourceContentHash(a);
      const prior = await readPriorPromotionMeta(config, targetSandbox, createToolFor(a.type), a.name, a.folderSegments.join('/') || undefined);
      if (prior?.sourceContentHash === currentHash) { unchanged.push({ name: a.name, type: a.type }); continue; }
      action = 'update';
    } else {
      action = 'create';
    }

    // Embedded fragments must be live in the target first.
    const depKeys = a.embeds.map(e => key('fragment', e.name));
    if (depKeys.some(dk => blockedKeys.has(dk))) { blockedKeys.add(k); blockers.push(`${a.name}: a fragment it embeds is blocked, so it cannot be promoted.`); continue; }
    if (depKeys.some(dk => !live.has(dk))) continue; // wait for a later phase/call

    const { map: embedIdMap, missing } = embedMapFor(a);
    if (missing) {
      blockers.push(`${a.name}: MISSING_DEPENDENCY — an embedded fragment is not present in the target and not in this promotion set.`);
      blockedKeys.add(k);
      continue;
    }

    // Resolve folders + tags in the target (real writes, gated upstream by confirmWrite).
    const folder = await ensureTargetFolder(a, targetSandbox);
    if (folder.warning) warnings.push(folder.warning);
    const tags = await resolveTargetTags(a, targetSandbox);
    warnings.push(...tags.warnings);

    const args = rebuildArgs(a, embedIdMap, folder.leafFolderId, tags.tagIds);
    const leaked = findLeakedSourceUuids(args, a);
    if (leaked.length) {
      blockers.push(`${a.name}: refusing to stage — source UUID(s) survived rewiring (${leaked.join(', ')}). This is a bug; please report it.`);
      blockedKeys.add(k);
      continue;
    }
    if (action === 'update') args[a.type === 'template' ? 'templateId' : 'fragmentId'] = live.get(k);
    const sourceContentHash = computeSourceContentHash(a);

    try {
      const branchName = `${branchPrefixFor(a.type, a.name)}${Date.now()}`;
      const tool = action === 'update' ? updateToolFor(a.type) : createToolFor(a.type);
      const { prUrl } = await createApprovalPR(
        config, targetSandbox, tool, args, author,
        a.folderSegments.join('/') || undefined, tenant, branchName, { sourceContentHash }
      );
      openPrs.push({ name: a.name, type: a.type, prUrl, action });
    } catch (err) {
      blockers.push(`${a.name}: opening promotion PR failed: ${err instanceof Error ? err.message : String(err)}`);
      blockedKeys.add(k);
    }
  }

  // ── Status + next action ──
  let status: PromotionResult['status'];
  let nextAction: string;
  if (openPrs.length > 0) {
    status = 'awaiting_merge';
    const creates = openPrs.filter(p => p.action === 'create').length;
    const updates = openPrs.filter(p => p.action === 'update').length;
    nextAction = `Review and merge the ${openPrs.length} open PR(s) (${creates} create, ${updates} update) in ${config.owner}/${config.repo}, then call promote_assets again (with confirmWrite) to deploy them and advance to the next phase. Do NOT call deploy_merged_changes yourself on these promotion PRs — promote_assets deploys them for you. (It is now safe either way: deploys dedup by name, so a double-apply reuses the existing asset instead of duplicating it.)`;
  } else if (blockers.length > 0) {
    status = 'blocked';
    nextAction = 'Resolve the blockers above, then call promote_assets again to continue.';
  } else {
    status = 'complete';
    nextAction = deployed.length
      ? 'All assets are now live in the target sandbox. Promotion complete.'
      : 'Nothing to do — every asset is already present and unchanged in the target.';
  }

  return {
    status, sourceSandbox, targetSandbox, sourceRef: ref, dryRun: false,
    openPrs, deployed, unchanged, idMap: Object.fromEntries(live), nextAction, warnings, blockers
  };
}

function parsePRUrlNumber(prUrl: string): number | null {
  const m = prUrl.match(/\/pull\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ─── Same-sandbox repo → AJO deploy (list + sync) ────────────────────────────────
//
// Unlike promotion (cross-sandbox, opens per-asset PRs), this applies a repo subtree's
// already-merged/approved content DIRECTLY to the SAME-named active sandbox — the
// "deploy_merged_changes, but for a whole subtree" path. Direct write is appropriate
// because the content is already reviewed (it's on the repo's default branch); there
// is nothing new to gate. References are still re-resolved by name/path so a
// re-created asset gets correct target ids. Idempotent: a present asset is reused, so
// re-running deploys nothing new.

export interface RepoAsset { name: string; type: AssetType | 'tag'; path: string }
export interface RepoListing { sandbox: string; sourceRef: string; assets: RepoAsset[]; truncated: boolean }

export async function listRepoAssets(sandbox: string, sourceRef?: string): Promise<RepoListing> {
  const config = getConfiguredGitHubIntegration();
  const ref = sourceRef ?? config?.defaultBranch ?? 'main';
  if (!config) throw new PromotionError('GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured — repo content cannot be listed.');
  const index = await buildRepoIndex(config, sandbox, ref);
  const assets: RepoAsset[] = [];
  for (const t of ['fragment', 'template'] as AssetType[]) {
    for (const path of index.byType[t].values()) {
      assets.push({ name: path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, ''), type: t, path });
    }
  }
  for (const path of index.tags.values()) {
    assets.push({ name: path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, ''), type: 'tag', path });
  }
  assets.sort((a, b) => a.path.localeCompare(b.path));
  return { sandbox, sourceRef: ref, assets, truncated: index.truncated };
}

export interface RepoDeployResult {
  sandbox: string;
  sourceRef: string;
  dryRun: boolean;
  deployed: Array<{ name: string; type: AssetType; targetId: string; action: 'created' | 'reused' }>;
  validated?: Array<{ name: string; type: AssetType; action: 'create' | 'reuse'; warnings: string[] }>;
  idMap: Record<string, string>;
  nextAction: string;
  warnings: string[];
  blockers: string[];
}

export async function deployRepoToSandbox(
  selector: PromotionSelector, sandbox: string, dryRun: boolean, sourceRef?: string
): Promise<RepoDeployResult> {
  const config = getConfiguredGitHubIntegration()!; // caller guarantees configured
  const ref = sourceRef ?? config.defaultBranch ?? 'main';
  const index = await buildRepoIndex(config, sandbox, ref);
  const graph = await buildGraphFromRepo(config, selector, index);
  const warnings = [...graph.warnings];
  const blockers = [...graph.blockers];
  const live = await resolveLiveIds(graph, sandbox);
  const deployed: RepoDeployResult['deployed'] = [];
  const validated: NonNullable<RepoDeployResult['validated']> = [];
  const blockedKeys = new Set<string>();

  // ── Dry run: validate + report intended action, no writes ──
  if (dryRun) {
    for (const k of graph.order) {
      const a = graph.assets.get(k)!;
      if (live.has(k)) { validated.push({ name: a.name, type: a.type, action: 'reuse', warnings: [] }); continue; }
      const embedIdMap = new Map<string, string>();
      for (const e of a.embeds) { const tid = live.get(key('fragment', e.name)); if (tid) embedIdMap.set(e.sourceId, tid); }
      const args = rebuildArgs(a, embedIdMap, undefined, []);
      // A surviving source id for an in-batch fragment not yet live is expected in a dry
      // run (it gets created + rewired in the real pass); a truly dangling id is a blocker.
      for (const uuid of findLeakedSourceUuids(args, a)) {
        const emb = a.embeds.find(e => e.sourceId === uuid);
        const depKey = emb ? key('fragment', emb.name) : undefined;
        if (depKey && graph.assets.has(depKey) && !live.has(depKey)) {
          warnings.push(`${a.name}: embed "${emb!.name}" (source id ${uuid}) will be created and rewired during the real deploy (expected in a dry run).`);
        } else {
          blockers.push(`${a.name}: source UUID ${uuid} survived rewiring and is not an in-subtree dependency — would not deploy (dangling embed).`);
        }
      }
      const handler = DEPLOY_HANDLERS[createToolFor(a.type)];
      const res = await withSandbox(sandbox, async () => handler({ ...args, validateOnly: true })) as { warnings?: string[] };
      validated.push({ name: a.name, type: a.type, action: 'create', warnings: res.warnings ?? [] });
    }
    const toCreate = validated.filter(v => v.action === 'create').length;
    return {
      sandbox, sourceRef: ref, dryRun: true, deployed, validated,
      idMap: Object.fromEntries(live),
      nextAction: blockers.length
        ? 'Resolve the blockers above, then re-run the dry run.'
        : `Dry run only — nothing written. Re-run without dryRun (with confirmWrite) to deploy ${toCreate} new asset(s); ${validated.length - toCreate} already present would be reused.`,
      warnings, blockers
    };
  }

  // ── Real deploy: apply directly to the active sandbox in dependency order ──
  // (Deepest first, so a fragment is live before any template that embeds it.)
  await withSandbox(sandbox, async () => {
    for (const k of graph.order) {
      const a = graph.assets.get(k)!;
      if (a.embeds.map(e => key('fragment', e.name)).some(dk => blockedKeys.has(dk))) {
        blockedKeys.add(k); blockers.push(`${a.name}: a fragment it embeds is blocked, so it cannot be deployed.`); continue;
      }
      if (live.has(k)) { deployed.push({ name: a.name, type: a.type, targetId: live.get(k)!, action: 'reused' }); continue; }

      const embedIdMap = new Map<string, string>();
      let missing = false;
      for (const e of a.embeds) { const tid = live.get(key('fragment', e.name)); if (tid) embedIdMap.set(e.sourceId, tid); else missing = true; }
      if (missing) { blockers.push(`${a.name}: MISSING_DEPENDENCY — an embedded fragment is neither in this subtree nor already live in "${sandbox}".`); blockedKeys.add(k); continue; }

      const folder = await ensureTargetFolder(a, sandbox);
      if (folder.warning) warnings.push(folder.warning);
      const tags = await resolveTargetTags(a, sandbox);
      warnings.push(...tags.warnings);
      const args = rebuildArgs(a, embedIdMap, folder.leafFolderId, tags.tagIds);
      const leaked = findLeakedSourceUuids(args, a);
      if (leaked.length) { blockers.push(`${a.name}: refusing to write — source UUID(s) survived rewiring (${leaked.join(', ')}).`); blockedKeys.add(k); continue; }

      const applied = await deployOp({ toolName: createToolFor(a.type), args });
      if (applied) { live.set(k, applied.id); deployed.push({ name: a.name, type: a.type, targetId: applied.id, action: applied.action === 'reused' ? 'reused' : 'created' }); }
      else { blockers.push(`${a.name}: create failed in "${sandbox}".`); blockedKeys.add(k); }
    }
  });

  const created = deployed.filter(d => d.action === 'created').length;
  const reused = deployed.filter(d => d.action === 'reused').length;
  const nextAction = blockers.length
    ? `${created} asset(s) deployed, ${reused} already present; ${blockers.length} blocked — resolve the blockers and re-run.`
    : created
      ? `Deployed ${created} asset(s) to "${sandbox}" (${reused} already present, reused). Done.`
      : `Nothing to deploy — all ${reused} asset(s) are already present in "${sandbox}".`;

  return { sandbox, sourceRef: ref, dryRun: false, deployed, idMap: Object.fromEntries(live), nextAction, warnings, blockers };
}
