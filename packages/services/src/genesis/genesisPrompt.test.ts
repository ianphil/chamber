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

  it('includes the five user-visible identity file paths', () => {
    const prompt = buildGenesisPrompt(input);
    expect(prompt).toContain('SOUL.md');
    expect(prompt).toContain('memory.md');
    expect(prompt).toContain('rules.md');
    expect(prompt).toContain('mind-index.md');
    expect(prompt).toContain('.agent.md');
  });

  // log.md is reserved for structured CompletedTurn frames written by
  // DailyLogWriter. The genesis prompt must not instruct the LLM to write
  // there or it poisons the chamber-structured-log/v1 contract before the
  // first turn ever runs.
  it('does not instruct the LLM to write to log.md', () => {
    expect(buildGenesisPrompt(input)).not.toContain('log.md');
  });

  it('still accepts an input with paths.log set for backward compatibility', () => {
    const withLog = {
      ...input,
      paths: { ...input.paths, log: '/test/.working-memory/log.md' },
    };
    expect(() => buildGenesisPrompt(withLog)).not.toThrow();
    expect(buildGenesisPrompt(withLog)).not.toContain('log.md');
  });

  it('accepts an input that omits paths.log entirely', () => {
    expect(() => buildGenesisPrompt(input)).not.toThrow();
    expect(buildGenesisPrompt(input)).not.toContain('log.md');
  });
});
