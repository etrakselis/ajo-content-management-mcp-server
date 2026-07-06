import * as git from 'isomorphic-git';
import gitHttp from 'isomorphic-git/http/node';
import { Volume, createFsFromVolume } from 'memfs';
import { logger } from '../telemetry/index.js';

const GITHUB_API = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

// `quietStatuses` lists HTTP statuses the CALLER treats as normal control flow and
// catches itself — e.g. getFileSha's 404 ("file absent → create it") or
// ensureLabelExists's 422 ("label already exists"). Those are logged at debug, not
// warn, so a handled outcome never masquerades as a failure in the logs. ghRequest
// still throws for them (the caller's try/catch decides what to do); any OTHER
// non-2xx is a real error and still logs at warn.
async function ghRequest(
  token: string, path: string, options: RequestInit = {}, quietStatuses: number[] = []
): Promise<unknown> {
  const method = (options.method ?? 'GET').toUpperCase();
  // Log the exact outbound request (method + path, never the token) so a failing
  // GitHub call names itself in the logs. Errors below include the upstream body.
  logger.debug('GitHub API request', { method, path });
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: { ...ghHeaders(token), ...(options.headers as Record<string, string> ?? {}) }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg: string;
    try { msg = (JSON.parse(body) as { message?: string }).message ?? body; } catch { msg = body; }
    const meta = { method, path, status: res.status, message: msg };
    if (quietStatuses.includes(res.status)) logger.debug('GitHub API expected non-2xx', meta);
    else logger.warn('GitHub API error', meta);
    // Attach the HTTP status so a caller can branch on it (e.g. getFileSha treats ONLY a
    // 404 as "file absent" and must propagate every other status) without parsing the message.
    const error = new Error(`GitHub API ${res.status} on ${method} ${path}: ${msg}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) return res.json();
  return res.text();
}

// Returns true if the repo was just initialized (empty → seeded with README), false if it already had commits.
export async function testConnection(token: string, owner: string, repo: string): Promise<{ initialized: boolean }> {
  const data = await ghRequest(token, `/repos/${owner}/${repo}`) as {
    permissions?: { push?: boolean } | null;
    default_branch?: string;
  };
  // For public repos, GET /repos/{owner}/{repo} succeeds even for tokens with no
  // explicit write scope — the repo is publicly readable. A missing or non-true
  // `push` value means the token can read but cannot write; treat that as failure
  // rather than letting commits fail later with an opaque 403.
  if (data.permissions?.push !== true) {
    throw new Error(
      `The PAT does not have write access to ${owner}/${repo}. ` +
      `Go to GitHub → Settings → Developer settings → Personal access tokens, ` +
      `create a fine-grained PAT scoped to this repository, and set ` +
      `"Contents: Read and write" and "Pull requests: Read and write" under Repository permissions.`
    );
  }
  const branch = data.default_branch ?? 'main';
  try {
    await ghRequest(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    return { initialized: false };
  } catch {
    // Repo exists and PAT has write access, but no commits yet — initialize it automatically.
    await initializeRepoWithReadme(token, owner, repo, branch);
    return { initialized: true };
  }
}

async function initializeRepoWithReadme(
  token: string, owner: string, repo: string, defaultBranch: string
): Promise<void> {
  const vol = new Volume();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = createFsFromVolume(vol) as any;
  const dir = '/repo';
  vol.mkdirSync(dir);

  await git.init({ fs, dir, defaultBranch });
  vol.writeFileSync(`${dir}/README.md`, `# ${repo}\n`);
  await git.add({ fs, dir, filepath: 'README.md' });
  await git.commit({
    fs,
    dir,
    message: 'Initial commit',
    author: { name: 'AJO Content MCP', email: 'noreply@ajo-content-mcp' }
  });

  try {
    await git.push({
      fs,
      http: gitHttp,
      dir,
      url: `https://github.com/${owner}/${repo}.git`,
      onAuth: () => ({ username: token }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Repository "${owner}/${repo}" is empty and automatic initialization failed: ${msg}. ` +
      `Go to github.com/${owner}/${repo} and add a file manually, then test the connection again.`
    );
  }
}

export async function getDefaultBranch(token: string, owner: string, repo: string): Promise<string> {
  const data = await ghRequest(token, `/repos/${owner}/${repo}`) as { default_branch: string };
  return data.default_branch ?? 'main';
}

export async function getFileSha(
  token: string, owner: string, repo: string, path: string, ref?: string
): Promise<string | null> {
  try {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    // 404 = the file doesn't exist yet (→ caller creates it instead of updating), which
    // is the normal case for a new file on a fresh PR branch — quiet it (debug, not warn).
    const data = await ghRequest(token, `/repos/${owner}/${repo}/contents/${path}${q}`, {}, [404]) as { sha: string };
    return data.sha ?? null;
  } catch (err) {
    // ONLY a 404 means "file absent" (→ caller creates it). Any OTHER failure — a 5xx, a
    // 403 rate-limit, an auth blip — must NOT be reported as absent: doing so makes callers
    // commit a delete tombstone with no preserved content, PUT without a sha (→ 422), or
    // skip a delete entirely, all while the operation still looks successful. Propagate it.
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}

export async function getBranchSha(
  token: string, owner: string, repo: string, branch: string
): Promise<string> {
  const data = await ghRequest(
    token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
  ) as { object: { sha: string } };
  return data.object.sha;
}

export async function createBranch(
  token: string, owner: string, repo: string, branchName: string, fromSha: string
): Promise<void> {
  await ghRequest(token, `/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha })
  });
}

export async function commitFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string,
  branch?: string | null,
  existingSha?: string | null
): Promise<void> {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64')
  };
  // For empty repositories, omit branch so GitHub creates the initial commit on the
  // default branch. Providing an explicit branch name for a branch that has no commits
  // yet returns 422 "Reference does not exist".
  if (branch) body.branch = branch;
  if (existingSha) body.sha = existingSha;
  await ghRequest(token, `/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}


// Delete a file (DELETE /contents/:path). Requires the file's current blob sha
// (the tree-entry sha or a getFileSha result). Used to remove a stale mirror copy
// left at an asset's previous path after it was filed into / moved between folders
// (see pruneRelocatedCopies in sync.ts).
export async function deleteFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  sha: string,
  message: string,
  branch?: string | null
): Promise<void> {
  const body: Record<string, unknown> = { message, sha };
  if (branch) body.branch = branch;
  await ghRequest(token, `/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'DELETE',
    body: JSON.stringify(body)
  });
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<{ number: number; html_url: string }> {
  return ghRequest(token, `/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, body, head, base })
  }) as Promise<{ number: number; html_url: string }>;
}

// Update an existing PR's title and/or body (PATCH /pulls/{n}). Used when an open PR is
// reused for a same-asset write so its title/body reflect the LATEST operation.
export async function updatePullRequest(
  token: string, owner: string, repo: string, prNumber: number,
  fields: { title?: string; body?: string }
): Promise<void> {
  await ghRequest(token, `/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: 'PATCH',
    body: JSON.stringify(fields)
  });
}

export interface GHPullRequest {
  number: number;
  state: string;
  merged: boolean;
  html_url: string;
  title: string;
  merge_commit_sha: string | null;
  labels?: Array<{ name: string }>;
}

export async function getPullRequest(
  token: string, owner: string, repo: string, prNumber: number
): Promise<GHPullRequest> {
  return ghRequest(token, `/repos/${owner}/${repo}/pulls/${prNumber}`) as Promise<GHPullRequest>;
}

// Ensure a repo label exists; a 422 means it already exists (idempotent). Used so
// addLabelsToPr never fails on a not-yet-created label.
export async function ensureLabelExists(
  token: string, owner: string, repo: string, name: string, color = 'ededed'
): Promise<void> {
  try {
    await ghRequest(token, `/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name, color })
    }, [422]); // 422 = label already exists; expected and handled in catch — quiet it.
  } catch (err) {
    // 422 = already exists; anything else is a real failure worth surfacing.
    if (!(err instanceof Error && /422/.test(err.message))) throw err;
  }
}

export async function addLabelsToPr(
  token: string, owner: string, repo: string, prNumber: number, labels: string[]
): Promise<void> {
  await ghRequest(token, `/repos/${owner}/${repo}/issues/${prNumber}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels })
  });
}

// A PR as returned by the list endpoint. Unlike GET /pulls/{n}, the list payload
// does NOT include `merged` or `merge_commit_sha` — a closed PR may or may not be
// merged, so callers that need that distinction must re-fetch with getPullRequest.
export interface GHPullRequestListItem {
  number: number;
  state: string; // "open" | "closed"
  html_url: string;
  title: string;
  head: { ref: string };
  labels?: Array<{ name: string }>;
}

// List pull requests, most-recently-updated first. Used by promotion to discover
// the PRs it previously opened (matched by head-branch prefix) without storing any
// state between phases. Single page (default 100) — promotion sets are small and
// recent, so the newest page covers them.
export async function listPullRequests(
  token: string, owner: string, repo: string,
  opts: { state?: 'open' | 'closed' | 'all'; perPage?: number } = {}
): Promise<GHPullRequestListItem[]> {
  const state = opts.state ?? 'all';
  const perPage = opts.perPage ?? 100;
  return ghRequest(
    token,
    `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&sort=updated&direction=desc`
  ) as Promise<GHPullRequestListItem[]>;
}

export interface GHPRFile {
  filename: string;
  status: string;
}

export async function getPRFiles(
  token: string, owner: string, repo: string, prNumber: number
): Promise<GHPRFile[]> {
  return ghRequest(token, `/repos/${owner}/${repo}/pulls/${prNumber}/files`) as Promise<GHPRFile[]>;
}

export async function getFileContent(
  token: string, owner: string, repo: string, filePath: string, ref: string
): Promise<string> {
  const data = await ghRequest(
    token, `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`
  ) as { content: string; encoding: string };
  if (data.encoding === 'base64') {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  return data.content;
}

export interface GHTreeEntry { path: string; type: string; sha: string }

// List a commit/tree's full file tree (recursive). Used by repo-sourced promotion to
// locate asset JSON files by name without knowing their folder path up front.
// `truncated` is true if the repo exceeds GitHub's tree-listing cap (very large repos).
export async function listRepoTree(
  token: string, owner: string, repo: string, treeSha: string
): Promise<{ tree: GHTreeEntry[]; truncated: boolean }> {
  const data = await ghRequest(
    token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`
  ) as { tree?: GHTreeEntry[]; truncated?: boolean };
  return { tree: data.tree ?? [], truncated: data.truncated ?? false };
}

export function parsePRUrl(prUrl: string): { owner: string; repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}
