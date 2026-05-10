import { describe, expect, it } from 'vitest';
import { generateMindId } from './generateMindId';

describe('generateMindId', () => {
  it('generates id from folder basename + 4 hex chars', () => {
    const id = generateMindId('/tmp/agents/my-agent');
    expect(id).toMatch(/^my-agent-[a-f0-9]{4}$/);
  });

  it('generates id from unix-style path', () => {
    const id = generateMindId('/home/user/agents/fox');
    expect(id).toMatch(/^fox-[a-f0-9]{4}$/);
  });

  it('generates unique ids for same path', () => {
    const id1 = generateMindId('/tmp/agents/q');
    const id2 = generateMindId('/tmp/agents/q');

    expect(id1).toMatch(/^q-[a-f0-9]{4}$/);
    expect(id2).toMatch(/^q-[a-f0-9]{4}$/);
  });
});
