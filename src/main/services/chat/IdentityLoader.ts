import * as fs from 'fs';
import * as path from 'path';
import type { MindIdentity } from '../../../shared/types';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const H1_RE = /^#\s+(.+)$/m;

export class IdentityLoader {
  load(mindPath: string | null): MindIdentity | null {
    if (!mindPath) return null;
    const parts: string[] = [];

    try {
      const soulPath = path.join(mindPath, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        parts.push(fs.readFileSync(soulPath, 'utf-8'));
      }
    } catch { /* missing */ }

    try {
      const agentsDir = path.join(mindPath, '.github', 'agents');
      if (fs.existsSync(agentsDir)) {
        const files = fs.readdirSync(agentsDir)
          .filter(f => String(f).endsWith('.agent.md'))
          .sort();
        for (const file of files) {
          const content = fs.readFileSync(path.join(agentsDir, String(file)), 'utf-8');
          parts.push(content.replace(FRONTMATTER_RE, '').trim());
        }
      }
    } catch { /* missing */ }

    if (parts.length === 0) return null;

    const systemMessage = parts.join('\n\n---\n\n');
    const name = this.extractName(systemMessage, mindPath);

    return { name, systemMessage };
  }

  private extractName(content: string, mindPath: string): string {
    const match = content.match(H1_RE);
    if (match) {
      // Strip common suffixes like "— Soul", "- Soul"
      return match[1].trim().replace(/\s*[—–-]\s*Soul$/i, '').trim();
    }
    return path.basename(mindPath);
  }
}
