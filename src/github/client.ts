import * as git from 'isomorphic-git';
import gitHttp from 'isomorphic-git/http/node';
import { Volume, createFsFromVolume } from 'memfs';

const GITHUB_API = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

async function ghRequest(token: string, path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: { ...ghHeaders(token), ...(options.headers as Record<string, string> ?? {}) }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg: string;
    try { msg = (JSON.parse(body) as { message?: string }).message ?? body; } catch { msg = body; }
    throw new Error(`GitHub API ${res.status}: ${msg}`);
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
    const data = await ghRequest(token, `/repos/${owner}/${repo}/contents/${path}${q}`) as { sha: string };
    return data.sha ?? null;
  } catch {
    return null;
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

export interface GHPullRequest {
  number: number;
  state: string;
  merged: boolean;
  html_url: string;
  title: string;
  merge_commit_sha: string | null;
}

export async function getPullRequest(
  token: string, owner: string, repo: string, prNumber: number
): Promise<GHPullRequest> {
  return ghRequest(token, `/repos/${owner}/${repo}/pulls/${prNumber}`) as Promise<GHPullRequest>;
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

export function parsePRUrl(prUrl: string): { owner: string; repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}
