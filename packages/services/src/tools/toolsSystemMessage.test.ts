import { describe, it, expect } from 'vitest';
import type { InstalledTool } from '@chamber/shared/types';
import { buildToolsSection } from './toolsSystemMessage';

type InstalledNpmTool = Extract<InstalledTool, { package: string }>;

function tool(overrides: Partial<InstalledNpmTool> = {}): InstalledTool {
  return {
    id: 'workiq',
    package: '@microsoft/workiq',
    version: 'latest',
    install: { type: 'npm-global', package: '@microsoft/workiq', version: 'latest' },
    bin: 'workiq',
    displayName: 'Microsoft Work IQ',
    description: 'Query M365 data via natural language.',
    help: 'workiq ask --help',
    agentInstructions: 'Use `workiq ask "<question>"` to query M365 data.',
    source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
    installedAt: '2026-05-07T21:00:00.000Z',
    ...overrides,
  };
}

describe('buildToolsSection', () => {
  it('returns null when no tools are installed', () => {
    expect(buildToolsSection([])).toBeNull();
  });

  it('renders a tool with bin, displayName, description, help, and instructions', () => {
    const section = buildToolsSection([tool()]);
    expect(section).not.toBeNull();
    expect(section).toContain('## Tools');
    expect(section).toContain('### workiq — Microsoft Work IQ');
    expect(section).toContain('Query M365 data via natural language.');
    expect(section).toContain('- Help: `workiq ask --help`');
    expect(section).toContain('Use `workiq ask "<question>"`');
  });

  it('omits the help line when no help is set', () => {
    const section = buildToolsSection([tool({ help: undefined })]);
    expect(section).not.toContain('Help:');
  });

  it('omits the instructions paragraph when not provided', () => {
    const section = buildToolsSection([tool({ agentInstructions: undefined })]);
    expect(section).not.toContain('Use `workiq');
  });

  it('renders multiple tools separated by blank lines', () => {
    const section = buildToolsSection([
      tool(),
      tool({ id: 'other', bin: 'other', displayName: 'Other', description: 'Another tool.' }),
    ]);
    expect(section).toContain('### workiq');
    expect(section).toContain('### other — Other');
  });
});
