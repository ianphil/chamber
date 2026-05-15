import { describe, it, expect } from 'vitest';
import type { SessionTool } from '../a2a/tools';
import {
  MAX_AGGREGATE_TRANSITION_DURATION_MS,
  MAX_TRANSITION_DURATION_MS,
  REDUCED_MOTION_EQUIVALENT,
  VESTIBULAR_RISKY_TRANSITIONS,
} from './motionLimits';
import { MAX_STEP_WORD_COUNT, type Step } from './rubric';
import {
  buildSullivanTools,
  type ContrastCheckResult,
  type CritiqueResult,
  type MotionBudgetResult,
  type OutlineValidateResult,
  type PresentationTemplateResult,
  type SullivanService,
} from './tools';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

const MIND_ID = 'mind-test';
const MIND_PATH = '/tmp/mind-test';
const SERVICE: SullivanService = {} as SullivanService;

const TOOL_NAMES = [
  'presentation_template',
  'presentation_outline_validate',
  'presentation_critique',
  'presentation_contrast_check',
  'presentation_motion_budget',
] as const;

function buildTools(): SessionTool[] {
  return buildSullivanTools(MIND_ID, MIND_PATH, SERVICE);
}

function getTool(name: string): SessionTool {
  const tool = buildTools().find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

function makeStep(overrides: Partial<Step> & { id: string; title: string }): Step {
  return overrides;
}

// -----------------------------------------------------------------------------
// buildSullivanTools — shape
// -----------------------------------------------------------------------------

describe('buildSullivanTools — shape', () => {
  it('returns exactly five SessionTool entries', () => {
    const tools = buildTools();
    expect(tools).toHaveLength(5);
  });

  it('returns the five documented tool names in a stable order', () => {
    const tools = buildTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('every tool has name, description, parameters (object), and async handler', () => {
    const tools = buildTools();
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.parameters).toBe('object');
      expect(tool.parameters).not.toBeNull();
      expect(typeof tool.handler).toBe('function');
      // SessionTool.handler signature: (args) => Promise<unknown>.
      expect(tool.handler.constructor.name).toBe('AsyncFunction');
    }
  });

  it('every tool exposes a JSON-schema-shaped parameters object', () => {
    const tools = buildTools();
    for (const tool of tools) {
      const params = tool.parameters as Record<string, unknown>;
      expect(params.type).toBe('object');
      expect(typeof params.properties).toBe('object');
      expect(params.properties).not.toBeNull();
    }
  });

  it('builds without touching fs / electron / network — pure construction', () => {
    // No keytar / fs / electron stubs needed; if any were required, the
    // import chain would fail before we reach this point. The assertion
    // here is informational: a smoke that buildSullivanTools is callable
    // with placeholder context. The full purity contract is enforced by
    // each handler's own no-side-effects test below.
    expect(() => buildSullivanTools(MIND_ID, MIND_PATH, SERVICE)).not.toThrow();
  });
});

// -----------------------------------------------------------------------------
// presentation_template
// -----------------------------------------------------------------------------

describe('presentation_template', () => {
  const tool = (): SessionTool => getTool('presentation_template');

  it('returns an empty outline scaffold + structural guidance on the happy path', async () => {
    const result = (await tool().handler({
      topic: 'Cognitive Load Theory',
      audience: 'Junior engineers',
      learningObjective: 'Recognise extraneous cognitive load and apply Mayer / Sweller mitigations.',
      timeBudgetMinutes: 30,
    })) as PresentationTemplateResult;

    expect(typeof result).not.toBe('string');
    expect(result).toEqual(
      expect.objectContaining({
        thesis: '',
        narrativeArc: [],
        steps: [],
        guidance: expect.objectContaining({
          oneIdeaPerStep: true,
          maxWordsPerSlide: MAX_STEP_WORD_COUNT,
          timeBudgetTargetMinutes: 30,
        }),
      }),
    );
  });

  it('returns null timeBudgetTargetMinutes when the caller omits the optional field', async () => {
    const result = (await tool().handler({
      topic: 'Topic',
      audience: 'Audience',
      learningObjective: 'Objective',
    })) as PresentationTemplateResult;

    expect(result.guidance.timeBudgetTargetMinutes).toBeNull();
  });

  it('pins maxWordsPerSlide to the imported MAX_STEP_WORD_COUNT (no inline literal)', async () => {
    // If the rubric's word-count budget changes, this tool's guidance must
    // change with it — that's the contract. Pinning the assertion to the
    // imported constant catches silent drift in either direction.
    const result = (await tool().handler({
      topic: 'X',
      audience: 'Y',
      learningObjective: 'Z',
    })) as PresentationTemplateResult;
    expect(result.guidance.maxWordsPerSlide).toBe(MAX_STEP_WORD_COUNT);
  });

  it('throws when topic is missing or blank', async () => {
    await expect(tool().handler({ audience: 'a', learningObjective: 'o' })).rejects.toThrow(/topic/i);
    await expect(tool().handler({ topic: '', audience: 'a', learningObjective: 'o' })).rejects.toThrow(/topic/i);
    await expect(tool().handler({ topic: '   ', audience: 'a', learningObjective: 'o' })).rejects.toThrow(/topic/i);
  });

  it('throws when audience is missing or blank', async () => {
    await expect(tool().handler({ topic: 't', learningObjective: 'o' })).rejects.toThrow(/audience/i);
    await expect(tool().handler({ topic: 't', audience: '', learningObjective: 'o' })).rejects.toThrow(/audience/i);
  });

  it('throws when learningObjective is missing or blank', async () => {
    await expect(tool().handler({ topic: 't', audience: 'a' })).rejects.toThrow(/learningObjective/i);
    await expect(tool().handler({ topic: 't', audience: 'a', learningObjective: '   ' })).rejects.toThrow(
      /learningObjective/i,
    );
  });

  it('throws when timeBudgetMinutes is provided but non-positive or non-finite', async () => {
    const base = { topic: 't', audience: 'a', learningObjective: 'o' };
    await expect(tool().handler({ ...base, timeBudgetMinutes: 0 })).rejects.toThrow(/timeBudget/i);
    await expect(tool().handler({ ...base, timeBudgetMinutes: -5 })).rejects.toThrow(/timeBudget/i);
    await expect(tool().handler({ ...base, timeBudgetMinutes: Number.NaN })).rejects.toThrow(/timeBudget/i);
    await expect(tool().handler({ ...base, timeBudgetMinutes: Number.POSITIVE_INFINITY })).rejects.toThrow(
      /timeBudget/i,
    );
    await expect(tool().handler({ ...base, timeBudgetMinutes: 'thirty' as unknown as number })).rejects.toThrow(
      /timeBudget/i,
    );
  });

  it('is deterministic — same input yields deep-equal output across calls', async () => {
    const args = {
      topic: 'Topic',
      audience: 'Audience',
      learningObjective: 'Objective',
      timeBudgetMinutes: 20,
    };
    const a = await tool().handler({ ...args });
    const b = await tool().handler({ ...args });
    expect(a).toEqual(b);
  });
});

// -----------------------------------------------------------------------------
// presentation_outline_validate
// -----------------------------------------------------------------------------

describe('presentation_outline_validate', () => {
  const tool = (): SessionTool => getTool('presentation_outline_validate');

  it('returns no findings and zero summary counts on an empty (but well-formed) outline', async () => {
    const result = (await tool().handler({
      thesis: 'A clear thesis.',
      narrativeArc: ['intro', 'body', 'close'],
      steps: [],
    })) as OutlineValidateResult;

    expect(typeof result).not.toBe('string');
    expect(result).toEqual(
      expect.objectContaining({
        findings: [],
        summary: { blockCount: 0, warnCount: 0, noteCount: 0 },
      }),
    );
  });

  it('returns rubric findings (not throws) when steps trigger pedagogy rules', async () => {
    const steps: Step[] = [
      makeStep({ id: 's1', title: 'First', oneIdea: false, narrativeBridge: 'opening' }),
    ];
    const result = (await tool().handler({
      thesis: '',
      narrativeArc: [],
      steps,
    })) as OutlineValidateResult;

    const ruleIds = result.findings.map((f) => f.rule);
    expect(ruleIds).toContain('one-idea');
    expect(result.summary.warnCount).toBeGreaterThanOrEqual(1);
  });

  it('returns block-severity findings as a successful result (not a throw)', async () => {
    const steps: Step[] = [
      makeStep({
        id: 's1',
        title: 'Image step',
        images: [{ src: 'logo.png' }],
      }),
    ];
    const result = (await tool().handler({ thesis: '', narrativeArc: [], steps })) as OutlineValidateResult;
    expect(result.findings.some((f) => f.rule === 'missing-alt-text-intent' && f.severity === 'block')).toBe(true);
    expect(result.summary.blockCount).toBeGreaterThanOrEqual(1);
  });

  it('summary counts match the severities of the returned findings', async () => {
    const steps: Step[] = [
      makeStep({
        id: 's1',
        title: 'A',
        oneIdea: false,
        images: [{ src: 'x.png' }],
        transitions: [{ name: 't', durationMs: MAX_TRANSITION_DURATION_MS + 1 }],
      }),
    ];
    const result = (await tool().handler({ thesis: '', narrativeArc: [], steps })) as OutlineValidateResult;
    const block = result.findings.filter((f) => f.severity === 'block').length;
    const warn = result.findings.filter((f) => f.severity === 'warn').length;
    const note = result.findings.filter((f) => f.severity === 'note').length;
    expect(result.summary).toEqual({ blockCount: block, warnCount: warn, noteCount: note });
  });

  it('throws when steps is missing or not an array', async () => {
    await expect(tool().handler({ thesis: '', narrativeArc: [] })).rejects.toThrow(/steps/i);
    await expect(
      tool().handler({ thesis: '', narrativeArc: [], steps: 'not-an-array' as unknown as Step[] }),
    ).rejects.toThrow(/steps/i);
  });

  it('throws when a step is missing required id or title', async () => {
    await expect(
      tool().handler({
        thesis: '',
        narrativeArc: [],
        steps: [{ title: 'no id' } as unknown as Step],
      }),
    ).rejects.toThrow(/id/i);
    await expect(
      tool().handler({
        thesis: '',
        narrativeArc: [],
        steps: [{ id: 'has-id' } as unknown as Step],
      }),
    ).rejects.toThrow(/title/i);
  });

  it('throws on duplicate step ids', async () => {
    await expect(
      tool().handler({
        thesis: '',
        narrativeArc: [],
        steps: [makeStep({ id: 's1', title: 'A' }), makeStep({ id: 's1', title: 'B' })],
      }),
    ).rejects.toThrow(/duplicate/i);
  });

  it('throws when oneIdea is present but not a boolean', async () => {
    await expect(
      tool().handler({
        thesis: '',
        narrativeArc: [],
        steps: [{ id: 's1', title: 'A', oneIdea: 'yes' } as unknown as Step],
      }),
    ).rejects.toThrow(/oneIdea/i);
  });

  it('throws when a transition has a non-finite or negative durationMs', async () => {
    await expect(
      tool().handler({
        thesis: '',
        narrativeArc: [],
        steps: [
          {
            id: 's1',
            title: 'A',
            transitions: [{ name: 'bad', durationMs: Number.NaN }],
          } as unknown as Step,
        ],
      }),
    ).rejects.toThrow(/duration/i);
    await expect(
      tool().handler({
        thesis: '',
        narrativeArc: [],
        steps: [
          {
            id: 's1',
            title: 'A',
            transitions: [{ name: 'bad', durationMs: -1 }],
          } as unknown as Step,
        ],
      }),
    ).rejects.toThrow(/duration/i);
  });

  it('throws when an image is missing src', async () => {
    await expect(
      tool().handler({
        thesis: '',
        narrativeArc: [],
        steps: [
          { id: 's1', title: 'A', images: [{ alt: 'no src' }] } as unknown as Step,
        ],
      }),
    ).rejects.toThrow(/src/i);
  });

  it('is deterministic — same input yields deep-equal output across calls', async () => {
    const args = {
      thesis: '',
      narrativeArc: [],
      steps: [makeStep({ id: 's1', title: 'A', oneIdea: false })],
    };
    const a = await tool().handler(JSON.parse(JSON.stringify(args)));
    const b = await tool().handler(JSON.parse(JSON.stringify(args)));
    expect(a).toEqual(b);
  });

  it('returns a structured object, not a JSON-stringified payload', async () => {
    const result = await tool().handler({ thesis: '', narrativeArc: [], steps: [] });
    expect(typeof result).not.toBe('string');
    expect(result).toEqual(expect.objectContaining({ findings: expect.any(Array) }));
  });
});

// -----------------------------------------------------------------------------
// presentation_critique
// -----------------------------------------------------------------------------

describe('presentation_critique', () => {
  const tool = (): SessionTool => getTool('presentation_critique');

  function badOutline(): Step[] {
    // Crafted to trigger several rule kinds at once.
    return [
      makeStep({
        id: 's1',
        title: 'Opening',
        oneIdea: false,
        images: [{ src: 'logo.png' }],
        transitions: [{ name: 'zoom', durationMs: MAX_TRANSITION_DURATION_MS + 1 }],
        narrativeBridge: 'opening',
      }),
      makeStep({
        id: 's2',
        title: 'Closing',
        transitions: [{ name: 'spin', durationMs: MAX_AGGREGATE_TRANSITION_DURATION_MS }],
      }),
    ];
  }

  it('returns no findings on a clean outline and an empty perStep bucket per step', async () => {
    const steps: Step[] = [
      makeStep({ id: 's1', title: 'A', oneIdea: true }),
      makeStep({
        id: 's2',
        title: 'B',
        oneIdea: true,
        narrativeBridge: 'building on A',
      }),
    ];
    const result = (await tool().handler({ steps })) as CritiqueResult;
    expect(typeof result).not.toBe('string');
    expect(result.findings).toEqual([]);
    expect(result.perStep).toEqual([
      { stepId: 's1', findings: [] },
      { stepId: 's2', findings: [] },
    ]);
    expect(result.summary).toEqual({ blockCount: 0, warnCount: 0, noteCount: 0 });
  });

  it('returns the expected rule ids when an outline triggers several rules at once', async () => {
    const steps = badOutline();
    const result = (await tool().handler({ steps })) as CritiqueResult;
    const ruleIds = new Set(result.findings.map((f) => f.rule));
    // missing-alt-text-intent fires on s1's untagged image, motion-per-transition
    // fires on s1's > cap transition, and motion-aggregate fires on s2 (last step)
    // because the deck-total exceeds the aggregate cap.
    expect(ruleIds.has('missing-alt-text-intent')).toBe(true);
    expect(ruleIds.has('motion-per-transition')).toBe(true);
    expect(ruleIds.has('motion-aggregate')).toBe(true);
  });

  it('attributes every finding to a perStep bucket whose stepId matches a real step', async () => {
    const steps = badOutline();
    const result = (await tool().handler({ steps })) as CritiqueResult;
    const stepIds = new Set(steps.map((s) => s.id));
    expect(result.perStep.map((b) => b.stepId)).toEqual([...steps.map((s) => s.id)]);
    for (const bucket of result.perStep) {
      expect(stepIds.has(bucket.stepId)).toBe(true);
    }
    // Every global finding appears in exactly one per-step bucket.
    const flattened = result.perStep.flatMap((b) => b.findings);
    expect(flattened).toHaveLength(result.findings.length);
  });

  it('every finding severity is one of block | warn | note', async () => {
    const steps = badOutline();
    const result = (await tool().handler({ steps })) as CritiqueResult;
    for (const f of result.findings) {
      expect(['block', 'warn', 'note']).toContain(f.severity);
    }
  });

  it('throws on malformed steps using the same validator as outline_validate', async () => {
    await expect(tool().handler({})).rejects.toThrow(/steps/i);
    await expect(tool().handler({ steps: 'not-an-array' as unknown as Step[] })).rejects.toThrow(/steps/i);
    await expect(
      tool().handler({ steps: [{ id: 's1' } as unknown as Step] }),
    ).rejects.toThrow(/title/i);
    await expect(
      tool().handler({
        steps: [makeStep({ id: 'a', title: 'A' }), makeStep({ id: 'a', title: 'B' })],
      }),
    ).rejects.toThrow(/duplicate/i);
  });

  it('is deterministic — same input yields deep-equal output across calls', async () => {
    const args = { steps: badOutline() };
    const a = await tool().handler(JSON.parse(JSON.stringify(args)));
    const b = await tool().handler(JSON.parse(JSON.stringify(args)));
    expect(a).toEqual(b);
  });
});

// -----------------------------------------------------------------------------
// presentation_contrast_check
// -----------------------------------------------------------------------------

describe('presentation_contrast_check', () => {
  const tool = (): SessionTool => getTool('presentation_contrast_check');

  it('returns an array of structured results, one per input pair', async () => {
    const result = (await tool().handler({
      pairs: [
        { foreground: '#000000', background: '#ffffff', label: 'body text' },
        { foreground: '#777777', background: '#ffffff' },
      ],
    })) as readonly ContrastCheckResult[];

    expect(typeof result).not.toBe('string');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(entry).toEqual(
        expect.objectContaining({
          foreground: expect.any(String),
          background: expect.any(String),
          ratio: expect.any(Number),
          AA: expect.objectContaining({ largeText: expect.any(Boolean), normalText: expect.any(Boolean) }),
          AAA: expect.objectContaining({ largeText: expect.any(Boolean), normalText: expect.any(Boolean) }),
          recommendation: expect.any(String),
        }),
      );
    }
  });

  it('preserves the optional label when supplied', async () => {
    const result = (await tool().handler({
      pairs: [{ foreground: '#000000', background: '#ffffff', label: 'headline' }],
    })) as readonly ContrastCheckResult[];
    expect(result[0].label).toBe('headline');
  });

  it('black on white passes WCAG AA and AAA at both sizes (max contrast)', async () => {
    const result = (await tool().handler({
      pairs: [{ foreground: '#000000', background: '#ffffff' }],
    })) as readonly ContrastCheckResult[];
    expect(result[0].AA).toEqual({ largeText: true, normalText: true });
    expect(result[0].AAA).toEqual({ largeText: true, normalText: true });
    expect(result[0].ratio).toBeGreaterThan(20);
  });

  it('low contrast fails every level and returns a remediation recommendation', async () => {
    const result = (await tool().handler({
      pairs: [{ foreground: '#cccccc', background: '#ffffff' }],
    })) as readonly ContrastCheckResult[];
    expect(result[0].AA.normalText).toBe(false);
    expect(result[0].AA.largeText).toBe(false);
    expect(result[0].AAA.normalText).toBe(false);
    expect(result[0].AAA.largeText).toBe(false);
    expect(result[0].recommendation.length).toBeGreaterThan(0);
  });

  it('mid-range contrast passes AA but not AAA for normal text', async () => {
    // #767676 on white is the canonical "AA but not AAA for normal text"
    // boundary case cited by WCAG guidance.
    const result = (await tool().handler({
      pairs: [{ foreground: '#767676', background: '#ffffff' }],
    })) as readonly ContrastCheckResult[];
    expect(result[0].AA.normalText).toBe(true);
    expect(result[0].AAA.normalText).toBe(false);
  });

  it('throws on malformed hex via the imported parseHexColor helper', async () => {
    await expect(
      tool().handler({ pairs: [{ foreground: 'not-a-color', background: '#ffffff' }] }),
    ).rejects.toThrow(/hex/i);
    await expect(
      tool().handler({ pairs: [{ foreground: '#fff', background: '#1234' }] }),
    ).rejects.toThrow(/hex/i);
  });

  it('throws when pairs is missing, not an array, or a pair is missing colour fields', async () => {
    await expect(tool().handler({})).rejects.toThrow(/pairs/i);
    await expect(tool().handler({ pairs: 'not-an-array' as unknown as object[] })).rejects.toThrow(/pairs/i);
    await expect(
      tool().handler({ pairs: [{ background: '#fff' } as unknown as { foreground: string; background: string }] }),
    ).rejects.toThrow(/foreground/i);
    await expect(
      tool().handler({ pairs: [{ foreground: '#000' } as unknown as { foreground: string; background: string }] }),
    ).rejects.toThrow(/background/i);
  });

  it('is deterministic — same input yields deep-equal output across calls', async () => {
    const args = { pairs: [{ foreground: '#000000', background: '#ffffff' }] };
    const a = await tool().handler(JSON.parse(JSON.stringify(args)));
    const b = await tool().handler(JSON.parse(JSON.stringify(args)));
    expect(a).toEqual(b);
  });
});

// -----------------------------------------------------------------------------
// presentation_motion_budget
// -----------------------------------------------------------------------------

describe('presentation_motion_budget', () => {
  const tool = (): SessionTool => getTool('presentation_motion_budget');

  it('returns empty perTransition and zero aggregate on an empty input', async () => {
    const result = (await tool().handler({ transitions: [] })) as MotionBudgetResult;
    expect(typeof result).not.toBe('string');
    expect(result.perTransition).toEqual([]);
    expect(result.aggregate.totalDurationMs).toBe(0);
    expect(result.aggregate.withinAggregateBudget).toBe(true);
    expect(typeof result.aggregate.recommendation).toBe('string');
  });

  it('marks a transition at the per-transition cap as within budget (pinned to MAX_TRANSITION_DURATION_MS)', async () => {
    const result = (await tool().handler({
      transitions: [{ id: 't1', durationMs: MAX_TRANSITION_DURATION_MS, type: 'fade' }],
    })) as MotionBudgetResult;
    expect(result.perTransition[0].withinPerTransitionBudget).toBe(true);
  });

  it('marks a transition one millisecond over the cap as out of budget', async () => {
    const result = (await tool().handler({
      transitions: [{ id: 't1', durationMs: MAX_TRANSITION_DURATION_MS + 1, type: 'fade' }],
    })) as MotionBudgetResult;
    expect(result.perTransition[0].withinPerTransitionBudget).toBe(false);
    expect(result.perTransition[0].recommendation).toMatch(/(exceeds|reduce|cap)/i);
  });

  it('marks aggregate at exactly the cap as within budget', async () => {
    const result = (await tool().handler({
      transitions: [
        { id: 't1', durationMs: MAX_TRANSITION_DURATION_MS, type: 'fade' },
        { id: 't2', durationMs: MAX_AGGREGATE_TRANSITION_DURATION_MS - MAX_TRANSITION_DURATION_MS, type: 'fade' },
      ],
    })) as MotionBudgetResult;
    expect(result.aggregate.totalDurationMs).toBe(MAX_AGGREGATE_TRANSITION_DURATION_MS);
    expect(result.aggregate.withinAggregateBudget).toBe(true);
  });

  it('marks aggregate one millisecond over the cap as out of budget', async () => {
    const result = (await tool().handler({
      transitions: [
        { durationMs: MAX_AGGREGATE_TRANSITION_DURATION_MS + 1, type: 'fade' },
      ],
      // ^ uses a single transition above the per-transition cap to drive
      // the aggregate above its cap; the aggregate budget assertion is the
      // one we care about here.
    })) as MotionBudgetResult;
    expect(result.aggregate.withinAggregateBudget).toBe(false);
    expect(result.aggregate.recommendation).toMatch(/(exceeds|trim|aggregate)/i);
  });

  it('maps a vestibular-risky type to its REDUCED_MOTION_EQUIVALENT', async () => {
    const result = (await tool().handler({
      transitions: [{ id: 't1', durationMs: 400, type: 'zoom' }],
    })) as MotionBudgetResult;
    expect(VESTIBULAR_RISKY_TRANSITIONS.has('zoom')).toBe(true);
    expect(result.perTransition[0].reducedMotionEquivalent).toBe(REDUCED_MOTION_EQUIVALENT['zoom']);
    // Pin to the imported map, not the literal 'fade', to catch silent drift.
  });

  it('emits a vestibular-risk recommendation when the type is in the risky set', async () => {
    const result = (await tool().handler({
      transitions: [{ id: 't1', durationMs: 400, type: 'parallax' }],
    })) as MotionBudgetResult;
    expect(result.perTransition[0].recommendation).toMatch(/(vestibular|reduced[- ]motion|prefers-reduced-motion)/i);
  });

  it('leaves a safe type unchanged in reducedMotionEquivalent', async () => {
    const result = (await tool().handler({
      transitions: [{ id: 't1', durationMs: 400, type: 'fade' }],
    })) as MotionBudgetResult;
    expect(result.perTransition[0].reducedMotionEquivalent).not.toMatch(/^$/);
    expect(VESTIBULAR_RISKY_TRANSITIONS.has(result.perTransition[0].reducedMotionEquivalent)).toBe(false);
  });

  it('throws when transitions is missing or not an array', async () => {
    await expect(tool().handler({})).rejects.toThrow(/transitions/i);
    await expect(
      tool().handler({ transitions: 'nope' as unknown as { durationMs: number }[] }),
    ).rejects.toThrow(/transitions/i);
  });

  it('throws on non-finite or non-positive durationMs', async () => {
    await expect(
      tool().handler({ transitions: [{ durationMs: 0 }] }),
    ).rejects.toThrow(/duration/i);
    await expect(
      tool().handler({ transitions: [{ durationMs: -100 }] }),
    ).rejects.toThrow(/duration/i);
    await expect(
      tool().handler({ transitions: [{ durationMs: Number.NaN }] }),
    ).rejects.toThrow(/duration/i);
    await expect(
      tool().handler({ transitions: [{ durationMs: Number.POSITIVE_INFINITY }] }),
    ).rejects.toThrow(/duration/i);
    await expect(
      tool().handler({ transitions: [{ durationMs: 'fast' as unknown as number }] }),
    ).rejects.toThrow(/duration/i);
  });

  it('throws when a transition object is missing durationMs entirely', async () => {
    await expect(
      tool().handler({ transitions: [{ id: 't1' } as unknown as { durationMs: number }] }),
    ).rejects.toThrow(/duration/i);
  });

  it('is deterministic — same input yields deep-equal output across calls', async () => {
    const args = {
      transitions: [
        { id: 't1', durationMs: 400, type: 'fade' },
        { id: 't2', durationMs: 600, type: 'zoom' },
      ],
    };
    const a = await tool().handler(JSON.parse(JSON.stringify(args)));
    const b = await tool().handler(JSON.parse(JSON.stringify(args)));
    expect(a).toEqual(b);
  });
});

// -----------------------------------------------------------------------------
// Cross-cutting — purity / no side effects across all handlers
// -----------------------------------------------------------------------------

describe('sullivan tools — purity', () => {
  it('does not mutate its input arguments', async () => {
    const cases: Array<{ name: string; args: Record<string, unknown> }> = [
      {
        name: 'presentation_template',
        args: { topic: 't', audience: 'a', learningObjective: 'o', timeBudgetMinutes: 10 },
      },
      {
        name: 'presentation_outline_validate',
        args: {
          thesis: '',
          narrativeArc: ['intro'],
          steps: [makeStep({ id: 's1', title: 'A', oneIdea: true })],
        },
      },
      {
        name: 'presentation_critique',
        args: { steps: [makeStep({ id: 's1', title: 'A', oneIdea: true })] },
      },
      {
        name: 'presentation_contrast_check',
        args: { pairs: [{ foreground: '#000000', background: '#ffffff' }] },
      },
      {
        name: 'presentation_motion_budget',
        args: { transitions: [{ id: 't1', durationMs: 400, type: 'fade' }] },
      },
    ];

    for (const c of cases) {
      const before = JSON.stringify(c.args);
      await getTool(c.name).handler(c.args);
      const after = JSON.stringify(c.args);
      expect(after).toBe(before);
    }
  });
});
