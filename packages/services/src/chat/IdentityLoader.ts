import * as fs from 'fs';
import * as path from 'path';
import type { InstalledTool, MindIdentity } from '@chamber/shared/types';
import { buildToolsSection } from '../tools/toolsSystemMessage';
import { buildChamberSection } from './chamberSystemMessage';
import {
  createWorkingMemoryComposer,
  type WorkingMemoryComposer,
  type WorkingMemoryComposerConfig,
} from './WorkingMemoryComposer';
import {
  loadChamberMindConfig,
  DEFAULT_WORKING_MEMORY_CONSOLIDATION,
} from '../mind/chamberMindConfig';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const H1_RE = /^#\s+(.+)$/m;

export type InstalledToolsProvider = () => InstalledTool[];

export class IdentityLoader {
  private readonly composer: WorkingMemoryComposer;

  constructor(
    private readonly getInstalledTools: InstalledToolsProvider = () => [],
    composer: WorkingMemoryComposer = createWorkingMemoryComposer(),
  ) {
    this.composer = composer;
  }

  load(mindPath: string | null): MindIdentity | null {
    if (!mindPath) return null;
    const identityParts: string[] = [];
    const memoryParts: string[] = [];

    try {
      const soulPath = path.join(mindPath, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        identityParts.push(fs.readFileSync(soulPath, 'utf-8'));
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
          identityParts.push(content.replace(FRONTMATTER_RE, '').trim());
        }
      }
    } catch { /* missing */ }

    try {
      const composerConfig = this.resolveComposerConfig(mindPath);
      const memorySection = this.composer.compose(mindPath, composerConfig);
      if (memorySection.length > 0) memoryParts.push(memorySection);
    } catch { /* composer is defensive; defense-in-depth */ }

    const parts = [...identityParts, ...memoryParts];
    if (parts.length === 0) return null;

    parts.push(buildChamberSection());

    const toolsSection = buildToolsSection(this.getInstalledTools());
    if (toolsSection) parts.push(toolsSection);

    const systemMessage = parts.join('\n\n---\n\n');
    const name = this.extractName(identityParts.join('\n\n---\n\n'), mindPath);

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

  private resolveComposerConfig(mindPath: string): WorkingMemoryComposerConfig {
    // .chamber.json is the source of truth for composer caps. loadChamberMindConfig
    // already returns DEFAULT_WORKING_MEMORY_CONSOLIDATION when the file is missing,
    // unparseable, or schema-invalid, so this never throws. Defaults are also
    // exported here so a composer-only failure path still has a fallback.
    try {
      const c = loadChamberMindConfig(mindPath).workingMemory.consolidation;
      return {
        enabled: c.enabled,
        lastKTurns: c.lastKTurns,
        perTurnMaxBytes: c.perTurnMaxBytes,
        memoryMaxBytes: c.memoryMaxBytes,
      };
    } catch {
      return {
        enabled: DEFAULT_WORKING_MEMORY_CONSOLIDATION.enabled,
        lastKTurns: DEFAULT_WORKING_MEMORY_CONSOLIDATION.lastKTurns,
        perTurnMaxBytes: DEFAULT_WORKING_MEMORY_CONSOLIDATION.perTurnMaxBytes,
        memoryMaxBytes: DEFAULT_WORKING_MEMORY_CONSOLIDATION.memoryMaxBytes,
      };
    }
  }
}
