import { describe, it, expect } from 'vitest';
import { buildGenesisPrompt } from './genesisPrompt';

describe('buildGenesisPrompt', () => {
  const input = {
    name: 'TestAgent',
    role: 'engineering partner',
    voiceDescription: 'calm and precise',
    paths: {
      soul: '/test/SOUL.md',
      agent: '/test/.github/agents/test.agent.md',
      memory: '/test/.working-memory/memory.md',
      rules: '/test/.working-memory/rules.md',
      log: '/test/.working-memory/log.md',
      index: '/test/mind-index.md',
    },
  };

  it('includes agent name', () => {
    expect(buildGenesisPrompt(input)).toContain('TestAgent');
  });

  it('includes role and voice', () => {
    const prompt = buildGenesisPrompt(input);
    expect(prompt).toContain('engineering partner');
    expect(prompt).toContain('calm and precise');
  });

  it('includes all six file paths', () => {
    const prompt = buildGenesisPrompt(input);
    expect(prompt).toContain('SOUL.md');
    expect(prompt).toContain('memory.md');
    expect(prompt).toContain('rules.md');
    expect(prompt).toContain('log.md');
    expect(prompt).toContain('mind-index.md');
    expect(prompt).toContain('.agent.md');
  });
});
