import type { InstalledTool } from '@chamber/shared/types';

/**
 * Renders a `## Tools` markdown section advertising installed CLI tools to
 * the model. Returns null when no tools are installed so callers can skip
 * appending an empty section.
 *
 * The section is intentionally terse — model-facing instructions per tool
 * come from the marketplace's `agentInstructions` field, captured at install
 * time and stored on the InstalledTool record.
 */
export function buildToolsSection(tools: InstalledTool[]): string | null {
  if (tools.length === 0) return null;
  const intro = '## Tools\n\nThe following CLI tools are installed and available on the shell PATH. Invoke them as shell commands.';
  const blocks = tools.map(renderToolBlock).join('\n\n');
  return `${intro}\n\n${blocks}`;
}

function renderToolBlock(tool: InstalledTool): string {
  const header = `### ${tool.bin} — ${tool.displayName}`;
  const lines: string[] = [header, tool.description];
  if (tool.help) {
    lines.push(`- Help: \`${tool.help}\``);
  }
  if (tool.agentInstructions) {
    lines.push('', tool.agentInstructions.trim());
  }
  return lines.join('\n');
}
