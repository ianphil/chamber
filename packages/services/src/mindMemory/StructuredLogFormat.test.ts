import { describe, expect, it } from 'vitest';

import {
  STRUCTURED_LOG_SENTINEL,
  detectSentinel,
  parseLog,
  serializeTurn,
  type CompletedTurn,
} from './StructuredLogFormat';

const SENTINEL = STRUCTURED_LOG_SENTINEL;

const baseTurn = (overrides: Partial<CompletedTurn> = {}): CompletedTurn => ({
  turnId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'sess-abc',
  model: 'gpt-5.5',
  status: 'completed',
  startedAt: '2026-05-12T15:00:00Z',
  endedAt: '2026-05-12T15:00:05Z',
  prompt: 'hello',
  finalAssistantMessage: 'hi there',
  ...overrides,
});

describe('STRUCTURED_LOG_SENTINEL', () => {
  it('is the exact magic marker locked in the plan', () => {
    expect(STRUCTURED_LOG_SENTINEL).toBe('<!-- chamber-structured-log/v1 -->');
  });
});

describe('serializeTurn', () => {
  it('emits the canonical frame with double-space separators in the heading', () => {
    const out = serializeTurn(baseTurn());
    expect(out).toBe(
      '## 2026-05-12T15:00:05Z  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
        'session: sess-abc\n' +
        'model: gpt-5.5\n' +
        '\n' +
        '### user\n' +
        'hello\n' +
        '\n' +
        '### assistant\n' +
        'hi there\n',
    );
  });

  it('ends with a trailing newline so multiple turns concatenate cleanly', () => {
    const out = serializeTurn(baseTurn());
    expect(out.endsWith('\n')).toBe(true);
  });

  it('preserves multi-line prompts verbatim', () => {
    const out = serializeTurn(baseTurn({ prompt: 'line 1\nline 2\nline 3' }));
    expect(out).toContain('### user\nline 1\nline 2\nline 3\n\n### assistant');
  });

  it('preserves multi-line assistant messages verbatim', () => {
    const out = serializeTurn(baseTurn({ finalAssistantMessage: 'a\nb\nc' }));
    expect(out).toContain('### assistant\na\nb\nc\n');
  });

  it('renders status:completed', () => {
    const out = serializeTurn(baseTurn({ status: 'completed' }));
    expect(out).toMatch(/^## .+ {2}status:completed$/m);
  });

  it('renders status:aborted', () => {
    const out = serializeTurn(baseTurn({ status: 'aborted' }));
    expect(out).toMatch(/^## .+ {2}status:aborted$/m);
  });

  it('renders status:error', () => {
    const out = serializeTurn(baseTurn({ status: 'error' }));
    expect(out).toMatch(/^## .+ {2}status:error$/m);
  });
});

describe('parseLog — sentinel detector', () => {
  it('returns sentinel:false for an empty file', () => {
    expect(parseLog('')).toEqual({ sentinel: false, turns: [], malformed: 0 });
  });

  it('returns sentinel:false for whitespace-only content', () => {
    const out = parseLog('   \n\n\t\n');
    expect(out.sentinel).toBe(false);
    expect(out.turns).toEqual([]);
    expect(out.malformed).toBe(0);
  });

  it('detects sentinel after a UTF-8 BOM', () => {
    const out = parseLog('\uFEFF' + SENTINEL + '\n');
    expect(out.sentinel).toBe(true);
    expect(out.turns).toEqual([]);
    expect(out.malformed).toBe(0);
  });

  it('detects sentinel and parses turns when the file uses CRLF line endings', () => {
    const turn = baseTurn();
    const content = SENTINEL + '\r\n' + serializeTurn(turn).replace(/\n/g, '\r\n');
    const out = parseLog(content);
    expect(out.sentinel).toBe(true);
    expect(out.malformed).toBe(0);
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0].prompt).toBe('hello');
    expect(out.turns[0].assistant).toBe('hi there');
  });

  it('returns sentinel:false when the marker is missing', () => {
    const out = parseLog('# Just notes\nnothing structured here\n');
    expect(out.sentinel).toBe(false);
    expect(out.turns).toEqual([]);
    expect(out.malformed).toBe(0);
  });

  it('returns sentinel:false when the marker is not the first non-blank line', () => {
    const out = parseLog('some prose\n' + SENTINEL + '\n');
    expect(out.sentinel).toBe(false);
    expect(out.turns).toEqual([]);
  });

  it('tolerates a duplicated sentinel later in the file without inflating malformed count', () => {
    const t = baseTurn({
      finalAssistantMessage: 'before\n' + SENTINEL + '\nafter',
    });
    const content = SENTINEL + '\n' + serializeTurn(t);
    const out = parseLog(content);
    expect(out.sentinel).toBe(true);
    expect(out.malformed).toBe(0);
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0].assistant).toBe('before\n' + SENTINEL + '\nafter');
  });

  it('detectSentinel agrees with parseLog for canonical input', () => {
    const content = SENTINEL + '\n' + serializeTurn(baseTurn());
    expect(detectSentinel(content)).toBe(true);
  });

  it('detectSentinel returns false for empty content', () => {
    expect(detectSentinel('')).toBe(false);
  });

  it('detectSentinel returns false when sentinel is not first non-blank line', () => {
    expect(detectSentinel('garbage\n' + SENTINEL + '\n')).toBe(false);
  });

  it('detectSentinel handles BOM + CRLF combined', () => {
    expect(detectSentinel('\uFEFF' + SENTINEL + '\r\n')).toBe(true);
  });
});

describe('parseLog — turn parsing', () => {
  it('round-trips a single turn (sentinel + serialize)', () => {
    const t = baseTurn();
    const out = parseLog(SENTINEL + '\n' + serializeTurn(t));
    expect(out.sentinel).toBe(true);
    expect(out.malformed).toBe(0);
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0]).toEqual({
      turnId: t.turnId,
      sessionId: t.sessionId,
      model: t.model,
      status: t.status,
      timestamp: t.endedAt,
      prompt: t.prompt,
      assistant: t.finalAssistantMessage,
    });
  });

  it('round-trips multiple turns and preserves order', () => {
    const t1 = baseTurn({
      turnId: '11111111-1111-4111-8111-111111111111',
      endedAt: '2026-05-12T15:00:05Z',
      prompt: 'q1',
      finalAssistantMessage: 'a1',
    });
    const t2 = baseTurn({
      turnId: '22222222-2222-4222-8222-222222222222',
      endedAt: '2026-05-12T15:01:05Z',
      prompt: 'q2',
      finalAssistantMessage: 'a2',
      status: 'aborted',
    });
    const t3 = baseTurn({
      turnId: '33333333-3333-4333-8333-333333333333',
      endedAt: '2026-05-12T15:02:05Z',
      prompt: 'q3',
      finalAssistantMessage: 'a3',
      status: 'error',
    });
    const content =
      SENTINEL + '\n' + serializeTurn(t1) + serializeTurn(t2) + serializeTurn(t3);
    const out = parseLog(content);
    expect(out.malformed).toBe(0);
    expect(out.turns.map((t) => t.turnId)).toEqual([t1.turnId, t2.turnId, t3.turnId]);
    expect(out.turns.map((t) => t.status)).toEqual(['completed', 'aborted', 'error']);
    expect(out.turns.map((t) => t.prompt)).toEqual(['q1', 'q2', 'q3']);
    expect(out.turns.map((t) => t.assistant)).toEqual(['a1', 'a2', 'a3']);
  });

  it('drops a block with missing session: line and increments malformed', () => {
    const goodTurn = baseTurn({
      turnId: '22222222-2222-4222-8222-222222222222',
      endedAt: '2026-05-12T15:01:00Z',
    });
    const bad =
      '## 2026-05-12T15:00:00Z  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'model: gpt-5.5\n' +
      '\n### user\nq\n\n### assistant\na\n';
    const content = SENTINEL + '\n' + bad + serializeTurn(goodTurn);
    const out = parseLog(content);
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0].turnId).toBe(goodTurn.turnId);
  });

  it('drops a block with missing model: line and increments malformed', () => {
    const bad =
      '## 2026-05-12T15:00:00Z  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'session: sess-abc\n' +
      '\n### user\nq\n\n### assistant\na\n';
    const out = parseLog(SENTINEL + '\n' + bad);
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(0);
  });

  it('drops a block with malformed timestamp', () => {
    const bad =
      '## not-a-date  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'session: s\nmodel: m\n\n### user\nq\n\n### assistant\na\n';
    const out = parseLog(SENTINEL + '\n' + bad);
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(0);
  });

  it('drops a block with timestamp not in UTC (no Z suffix)', () => {
    const bad =
      '## 2026-05-12T15:00:00+02:00  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'session: s\nmodel: m\n\n### user\nq\n\n### assistant\na\n';
    const out = parseLog(SENTINEL + '\n' + bad);
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(0);
  });

  it('drops a block with unknown status', () => {
    const bad =
      '## 2026-05-12T15:00:00Z  turn:11111111-1111-4111-8111-111111111111  status:weird\n' +
      'session: s\nmodel: m\n\n### user\nq\n\n### assistant\na\n';
    const out = parseLog(SENTINEL + '\n' + bad);
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(0);
  });

  it('drops a block missing the ### user header', () => {
    const bad =
      '## 2026-05-12T15:00:00Z  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'session: s\nmodel: m\n\n### assistant\na\n';
    const out = parseLog(SENTINEL + '\n' + bad);
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(0);
  });

  it('drops a block missing the ### assistant header', () => {
    const bad =
      '## 2026-05-12T15:00:00Z  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'session: s\nmodel: m\n\n### user\nq\n';
    const out = parseLog(SENTINEL + '\n' + bad);
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(0);
  });

  it('continues parsing after a malformed block', () => {
    const good = baseTurn({
      turnId: '22222222-2222-4222-8222-222222222222',
      endedAt: '2026-05-12T15:02:00Z',
      prompt: 'good',
      finalAssistantMessage: 'OK',
    });
    const bad =
      '## not-a-date  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'session: s\nmodel: m\n\n### user\nq\n\n### assistant\na\n';
    const out = parseLog(SENTINEL + '\n' + bad + serializeTurn(good));
    expect(out.malformed).toBe(1);
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0].prompt).toBe('good');
  });

  it('discards orphan content before the first heading without flagging it as malformed', () => {
    const t = baseTurn();
    const content =
      SENTINEL + '\nstray prose between sentinel and first heading\n\n' + serializeTurn(t);
    const out = parseLog(content);
    expect(out.malformed).toBe(0);
    expect(out.turns).toHaveLength(1);
  });

  it('returns no turns when the file contains only the sentinel', () => {
    const out = parseLog(SENTINEL + '\n');
    expect(out.sentinel).toBe(true);
    expect(out.turns).toEqual([]);
    expect(out.malformed).toBe(0);
  });
});

describe('parseLog — round-trip property pack', () => {
  const fixtures: ReadonlyArray<{ name: string; turn: CompletedTurn }> = [
    { name: 'simple ASCII', turn: baseTurn() },
    { name: 'empty prompt body', turn: baseTurn({ prompt: '' }) },
    { name: 'empty assistant body', turn: baseTurn({ finalAssistantMessage: '' }) },
    {
      name: 'UTF-8 multibyte (emoji + Japanese)',
      turn: baseTurn({ prompt: '🚀 こんにちは', finalAssistantMessage: '世界 🌍' }),
    },
    { name: 'multi-line prompt', turn: baseTurn({ prompt: 'a\nb\nc\nd' }) },
    {
      name: 'multi-line assistant',
      turn: baseTurn({ finalAssistantMessage: 'one\ntwo\nthree' }),
    },
    {
      name: 'embedded "## " in prompt that does not match heading regex',
      turn: baseTurn({ prompt: '## look at this header\n## another one' }),
    },
    {
      name: 'embedded "## " in assistant that does not match heading regex',
      turn: baseTurn({ finalAssistantMessage: '## final answer\n## see above' }),
    },
    {
      name: 'inline ### tokens not at column 0',
      turn: baseTurn({
        prompt: 'see ###deepheading inline',
        finalAssistantMessage: 'foo ### bar baz',
      }),
    },
    {
      name: 'tabs and mixed whitespace',
      turn: baseTurn({ prompt: '\thello\tworld', finalAssistantMessage: '  spaced  ' }),
    },
    { name: 'aborted status', turn: baseTurn({ status: 'aborted' }) },
    { name: 'error status', turn: baseTurn({ status: 'error' }) },
    { name: 'long single-line prompt', turn: baseTurn({ prompt: 'x'.repeat(5000) }) },
    {
      name: 'long single-line assistant',
      turn: baseTurn({ finalAssistantMessage: 'y'.repeat(5000) }),
    },
    {
      name: 'truncate marker preserved verbatim in prompt',
      turn: baseTurn({ prompt: 'first 2KB of content\n[…truncated, originally 5 KB]' }),
    },
    {
      name: 'truncate marker preserved verbatim in assistant',
      turn: baseTurn({
        finalAssistantMessage: 'reply body\n[…truncated, originally 8 KB]',
      }),
    },
    {
      name: 'fractional second timestamp',
      turn: baseTurn({ endedAt: '2026-05-12T15:00:05.123Z' }),
    },
    {
      name: 'unicode in session/model',
      turn: baseTurn({ sessionId: 'sess-✨-1', model: 'gpt-5.5' }),
    },
    {
      name: 'numeric-looking content',
      turn: baseTurn({ prompt: '1234567890', finalAssistantMessage: '0.0001' }),
    },
    {
      name: 'colon-heavy content (does not confuse frontmatter parser)',
      turn: baseTurn({
        prompt: 'a:b:c:d',
        finalAssistantMessage: 'session: not-a-real-frontmatter\nmodel: also-not-real',
      }),
    },
  ];

  for (const { name, turn } of fixtures) {
    it(`round-trips: ${name}`, () => {
      const content = STRUCTURED_LOG_SENTINEL + '\n' + serializeTurn(turn);
      const out = parseLog(content);
      expect(out.sentinel).toBe(true);
      expect(out.malformed).toBe(0);
      expect(out.turns).toHaveLength(1);
      const parsed = out.turns[0];
      expect(parsed.turnId).toBe(turn.turnId);
      expect(parsed.sessionId).toBe(turn.sessionId);
      expect(parsed.model).toBe(turn.model);
      expect(parsed.status).toBe(turn.status);
      expect(parsed.timestamp).toBe(turn.endedAt);
      expect(parsed.prompt).toBe(turn.prompt);
      expect(parsed.assistant).toBe(turn.finalAssistantMessage);
    });
  }
});
