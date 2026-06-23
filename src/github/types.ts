export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  requireApproval: boolean;
  defaultBranch: string;
}
