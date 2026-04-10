import { execSync } from 'child_process';

type ExecFn = (command: string, options: Record<string, unknown>) => string;

export interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

export class GitHubRegistryClient {
  private exec: ExecFn;

  constructor(exec?: ExecFn) {
    this.exec = exec ?? ((cmd, opts) => execSync(cmd, opts as Parameters<typeof execSync>[1]) as unknown as string);
  }

  fetchTree(owner: string, repo: string, branch: string): TreeEntry[] {
    const raw = this.exec(
      `gh api /repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { encoding: 'utf8', timeout: 30_000 },
    );
    return JSON.parse(raw).tree;
  }

  fetchBlob(owner: string, repo: string, sha: string): Buffer {
    const raw = this.exec(
      `gh api /repos/${owner}/${repo}/git/blobs/${sha}`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    const blob = JSON.parse(raw);
    return Buffer.from(blob.content, 'base64');
  }

  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): unknown {
    const raw = this.exec(
      `gh api /repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
      { encoding: 'utf8' },
    );
    const content = JSON.parse(raw);
    return JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'));
  }
}
