import { describe, it, expect } from 'vitest';
import { buildChamberSection } from './chamberSystemMessage';

describe('buildChamberSection', () => {
  it('renders Chamber identity and documentation guidance', () => {
    const section = buildChamberSection();

    expect(section).toContain('## Chamber');
    expect(section).toContain('operating inside Chamber as a Chamber agent');
    expect(section).toContain('https://github.com/ianphil/chamber');
    expect(section).toContain('README.md');
    expect(section).toContain('ai-docs/');
    expect(section).toContain('local desktop auto-update testing');
    expect(section).toContain('CONTRIBUTING.md');
    expect(section).toContain('AGENTS.md');
    expect(section).toContain('.github/copilot-instructions.md');
    expect(section).toContain('search the repository docs/source first');
    expect(section).toContain('cite or link the most relevant doc path');
  });
});
