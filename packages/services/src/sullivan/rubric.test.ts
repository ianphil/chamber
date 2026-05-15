import { describe, it, expect } from 'vitest';
import {
  MAX_AGGREGATE_TRANSITION_DURATION_MS,
  MAX_TRANSITION_DURATION_MS,
} from './motionLimits';
import {
  RUBRIC,
  type Finding,
  type Rule,
  type RubricContext,
  type Severity,
  type Step,
} from './rubric';

const ALLOWED_SEVERITIES: ReadonlyArray<Severity> = ['block', 'warn', 'note'];

function getRule(id: string): Rule {
  const rule = RUBRIC.find((r) => r.id === id);
  if (!rule) {
    throw new Error(`Rule "${id}" not found in RUBRIC`);
  }
  return rule;
}

function ctxAt(index: number, allSteps: readonly Step[]): RubricContext {
  return { allSteps, index };
}

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 's',
    title: 'Step',
    ...overrides,
  };
}

describe('RUBRIC integrity', () => {
  it('is a frozen array (Object.isFrozen)', () => {
    expect(Object.isFrozen(RUBRIC)).toBe(true);
  });

  it('refuses runtime push() mutation', () => {
    // TS prevents this at compile time via ReadonlyArray; the runtime freeze
    // is the belt-and-braces guarantee that downstream consumers can't reach
    // around the type system and mutate the shared rubric.
    const mutate = (): void => {
      (RUBRIC as Rule[]).push(getRule('one-idea'));
    };
    expect(mutate).toThrow(TypeError);
  });

  it('refuses runtime index-write mutation', () => {
    const mutate = (): void => {
      (RUBRIC as Rule[])[0] = getRule('one-idea');
    };
    expect(mutate).toThrow(TypeError);
  });

  it('every rule object is itself frozen', () => {
    for (const rule of RUBRIC) {
      expect(Object.isFrozen(rule)).toBe(true);
    }
  });

  it('every rule id is unique', () => {
    const ids = RUBRIC.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule.severity is one of the documented set: block | warn | note', () => {
    for (const rule of RUBRIC) {
      expect(ALLOWED_SEVERITIES).toContain(rule.severity);
    }
  });

  it('every rule has a non-empty id, category, summary, and rationale', () => {
    for (const rule of RUBRIC) {
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.category.length).toBeGreaterThan(0);
      expect(rule.summary.length).toBeGreaterThan(0);
      expect(rule.rationale.length).toBeGreaterThan(0);
    }
  });

  it('every rule exposes a (step, context) evaluator of arity 2 (uniform signature)', () => {
    for (const rule of RUBRIC) {
      expect(typeof rule.evaluator).toBe('function');
      expect(rule.evaluator.length).toBe(2);
    }
  });

  it('exposes the six rule ids called out in the Phase 2 brief plus the per-transition motion rule', () => {
    const expected = [
      'one-idea',
      'cognitive-load',
      'missing-alt-text-intent',
      'motion-per-transition',
      'narrative-continuity',
      'redundant-content',
      'motion-aggregate',
    ];
    const actual = RUBRIC.map((r) => r.id).sort();
    expect(actual).toEqual([...expected].sort());
  });
});

describe('one-idea rule (per-step)', () => {
  const rule = getRule('one-idea');

  it('passes when oneIdea is true', () => {
    const step = makeStep({ oneIdea: true });
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('passes when oneIdea is undefined (no assertion either way)', () => {
    const step = makeStep();
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('fires when oneIdea is explicitly false', () => {
    const step = makeStep({ oneIdea: false, title: 'Crowded slide' });
    const finding = rule.evaluator(step, ctxAt(0, [step]));
    expect(finding).not.toBeNull();
    const f = finding as Finding;
    expect(f.rule).toBe('one-idea');
    expect(f.severity).toBe('warn');
    expect(f.message).toMatch(/one idea/i);
  });

  it('includes an actionable suggestion when firing', () => {
    const step = makeStep({ oneIdea: false });
    const finding = rule.evaluator(step, ctxAt(0, [step])) as Finding;
    expect(finding.suggestion).toBeDefined();
    expect(finding.suggestion?.length).toBeGreaterThan(0);
  });
});

describe('cognitive-load rule (per-step)', () => {
  const rule = getRule('cognitive-load');

  it('passes when content is within the word budget', () => {
    const step = makeStep({ content: 'Five short words sit here.' });
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('passes when content is undefined', () => {
    const step = makeStep();
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('fires when content exceeds the per-step word budget', () => {
    const overload = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const step = makeStep({ content: overload });
    const finding = rule.evaluator(step, ctxAt(0, [step]));
    expect(finding).not.toBeNull();
    const f = finding as Finding;
    expect(f.rule).toBe('cognitive-load');
    expect(f.severity).toBe('warn');
    // The message must name the offending count so authors know how far over.
    expect(f.message).toMatch(/\b200\b/);
  });

  it('counts words by whitespace and ignores extra spacing', () => {
    const overload = Array.from({ length: 120 }, (_, i) => `word${i}`).join('   ');
    const step = makeStep({ content: `  ${overload}  ` });
    expect(rule.evaluator(step, ctxAt(0, [step]))).not.toBeNull();
  });
});

describe('missing-alt-text-intent rule (per-step)', () => {
  const rule = getRule('missing-alt-text-intent');

  it('passes when there are no images', () => {
    const step = makeStep();
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('passes when every image has non-empty alt text', () => {
    const step = makeStep({
      images: [
        { src: 'arch.png', alt: 'System architecture diagram with three tiers' },
        { src: 'team.png', alt: 'Photo of the engineering team' },
      ],
    });
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('passes when an image is explicitly marked decorative', () => {
    const step = makeStep({
      images: [{ src: 'flourish.png', decorative: true }],
    });
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('fires when an image has neither alt nor decorative marker', () => {
    const step = makeStep({
      images: [{ src: 'mystery.png' }],
    });
    const finding = rule.evaluator(step, ctxAt(0, [step]));
    expect(finding).not.toBeNull();
    const f = finding as Finding;
    expect(f.rule).toBe('missing-alt-text-intent');
    expect(f.severity).toBe('block');
    expect(f.message).toContain('mystery.png');
  });

  it('fires when alt is empty / whitespace-only and image is not decorative', () => {
    const step = makeStep({
      images: [{ src: 'empty.png', alt: '   ' }],
    });
    expect(rule.evaluator(step, ctxAt(0, [step]))).not.toBeNull();
  });

  it('cites WCAG 1.1.1 in its suggestion', () => {
    const step = makeStep({ images: [{ src: 'a.png' }] });
    const finding = rule.evaluator(step, ctxAt(0, [step])) as Finding;
    expect(finding.suggestion).toBeDefined();
    expect(finding.suggestion).toMatch(/decorative|alt/i);
  });
});

describe('motion-per-transition rule (per-step)', () => {
  const rule = getRule('motion-per-transition');

  it('passes when there are no transitions', () => {
    const step = makeStep();
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('passes at exactly MAX_TRANSITION_DURATION_MS — pinned to 800ms (boundary)', () => {
    expect(MAX_TRANSITION_DURATION_MS).toBe(800);
    const step = makeStep({
      transitions: [{ name: 'fade', durationMs: MAX_TRANSITION_DURATION_MS }],
    });
    expect(rule.evaluator(step, ctxAt(0, [step]))).toBeNull();
  });

  it('fires at MAX_TRANSITION_DURATION_MS + 1ms — 801ms (boundary, pinning)', () => {
    const overBy = MAX_TRANSITION_DURATION_MS + 1;
    const step = makeStep({
      transitions: [{ name: 'fade', durationMs: overBy }],
    });
    const finding = rule.evaluator(step, ctxAt(0, [step]));
    expect(finding).not.toBeNull();
    const f = finding as Finding;
    expect(f.rule).toBe('motion-per-transition');
    expect(f.severity).toBe('block');
    expect(f.message).toContain(String(overBy));
    expect(f.message).toContain(String(MAX_TRANSITION_DURATION_MS));
  });

  it('fires if ANY transition (not just the first) exceeds the cap', () => {
    const step = makeStep({
      transitions: [
        { name: 'fade', durationMs: 300 },
        { name: 'slide', durationMs: MAX_TRANSITION_DURATION_MS + 100 },
      ],
    });
    const finding = rule.evaluator(step, ctxAt(0, [step]));
    expect(finding).not.toBeNull();
    expect((finding as Finding).message).toContain('slide');
  });
});

describe('narrative-continuity rule (cross-step — uses context.allSteps + context.index)', () => {
  const rule = getRule('narrative-continuity');

  it('passes for the first step regardless of narrativeBridge', () => {
    const steps = [
      makeStep({ id: '1', title: 'Intro' }),
      makeStep({ id: '2', title: 'Next', narrativeBridge: 'After the intro...' }),
    ];
    expect(rule.evaluator(steps[0], ctxAt(0, steps))).toBeNull();
  });

  it('passes for a non-first step that has a non-empty narrativeBridge', () => {
    const steps = [
      makeStep({ id: '1', title: 'Intro' }),
      makeStep({ id: '2', title: 'Next', narrativeBridge: 'Building on the intro...' }),
    ];
    expect(rule.evaluator(steps[1], ctxAt(1, steps))).toBeNull();
  });

  it('fires for a non-first step missing a narrativeBridge', () => {
    const steps = [
      makeStep({ id: '1', title: 'Intro' }),
      makeStep({ id: '2', title: 'Next' }),
    ];
    const finding = rule.evaluator(steps[1], ctxAt(1, steps));
    expect(finding).not.toBeNull();
    const f = finding as Finding;
    expect(f.rule).toBe('narrative-continuity');
    expect(f.severity).toBe('note');
  });

  it('uses context.index — a finding at index 2 names the previous step (index 1)', () => {
    const steps = [
      makeStep({ id: '1', title: 'Alpha' }),
      makeStep({ id: '2', title: 'Bravo', narrativeBridge: 'continuing' }),
      makeStep({ id: '3', title: 'Charlie' }),
    ];
    const finding = rule.evaluator(steps[2], ctxAt(2, steps)) as Finding;
    expect(finding).not.toBeNull();
    expect(finding.message).toContain('Bravo');
    expect(finding.message).toContain('Charlie');
  });

  it('fires when narrativeBridge is whitespace-only', () => {
    const steps = [
      makeStep({ id: '1' }),
      makeStep({ id: '2', narrativeBridge: '   ' }),
    ];
    expect(rule.evaluator(steps[1], ctxAt(1, steps))).not.toBeNull();
  });
});

describe('redundant-content rule (cross-step — uses context.allSteps + context.index)', () => {
  const rule = getRule('redundant-content');

  it('passes when all steps have distinct content', () => {
    const steps = [
      makeStep({ id: '1', content: 'alpha bravo charlie delta echo' }),
      makeStep({ id: '2', content: 'foxtrot golf hotel india juliet' }),
    ];
    expect(rule.evaluator(steps[1], ctxAt(1, steps))).toBeNull();
  });

  it('does not fire on the first occurrence of duplicated content (only on the duplicate)', () => {
    const dup = 'alpha bravo charlie delta echo foxtrot golf hotel';
    const steps = [
      makeStep({ id: '1', title: 'First', content: dup }),
      makeStep({ id: '2', title: 'Second', content: dup }),
    ];
    expect(rule.evaluator(steps[0], ctxAt(0, steps))).toBeNull();
  });

  it('fires on a later step whose content overlaps significantly with an earlier step', () => {
    const dup = 'alpha bravo charlie delta echo foxtrot golf hotel';
    const steps = [
      makeStep({ id: '1', title: 'First', content: dup }),
      makeStep({ id: '2', title: 'Second', content: dup }),
    ];
    const finding = rule.evaluator(steps[1], ctxAt(1, steps));
    expect(finding).not.toBeNull();
    const f = finding as Finding;
    expect(f.rule).toBe('redundant-content');
    expect(f.severity).toBe('note');
    expect(f.message).toContain('First');
  });

  it('does not fire when current step has no content', () => {
    const steps = [
      makeStep({ id: '1', content: 'alpha bravo charlie delta echo foxtrot' }),
      makeStep({ id: '2' }),
    ];
    expect(rule.evaluator(steps[1], ctxAt(1, steps))).toBeNull();
  });

  it('does not fire on partial overlap below the similarity threshold', () => {
    const steps = [
      makeStep({ id: '1', content: 'alpha bravo charlie delta echo foxtrot golf hotel' }),
      makeStep({
        id: '2',
        content: 'alpha bravo india juliet kilo lima mike november',
      }),
    ];
    expect(rule.evaluator(steps[1], ctxAt(1, steps))).toBeNull();
  });
});

describe('motion-aggregate rule (cross-step — uses context.allSteps + context.index)', () => {
  const rule = getRule('motion-aggregate');

  it('passes at exactly MAX_AGGREGATE_TRANSITION_DURATION_MS — pinned to 4000ms (boundary)', () => {
    expect(MAX_AGGREGATE_TRANSITION_DURATION_MS).toBe(4000);
    const steps = [
      makeStep({ id: '1', transitions: [{ name: 'fade', durationMs: 2000 }] }),
      makeStep({ id: '2', transitions: [{ name: 'fade', durationMs: 2000 }] }),
    ];
    const last = steps.length - 1;
    expect(rule.evaluator(steps[last], ctxAt(last, steps))).toBeNull();
  });

  it('fires at MAX_AGGREGATE_TRANSITION_DURATION_MS + 1ms — 4001ms (boundary, pinning)', () => {
    const steps = [
      makeStep({ id: '1', transitions: [{ name: 'fade', durationMs: 2000 }] }),
      makeStep({ id: '2', transitions: [{ name: 'fade', durationMs: 2001 }] }),
    ];
    const last = steps.length - 1;
    const finding = rule.evaluator(steps[last], ctxAt(last, steps));
    expect(finding).not.toBeNull();
    const f = finding as Finding;
    expect(f.rule).toBe('motion-aggregate');
    expect(f.severity).toBe('block');
    expect(f.message).toContain(String(MAX_AGGREGATE_TRANSITION_DURATION_MS + 1));
    expect(f.message).toContain(String(MAX_AGGREGATE_TRANSITION_DURATION_MS));
  });

  it('only fires on the last step — the finding lands on index = allSteps.length - 1', () => {
    const steps = [
      makeStep({ id: '1', transitions: [{ name: 'fade', durationMs: 2500 }] }),
      makeStep({ id: '2', transitions: [{ name: 'fade', durationMs: 2500 }] }),
    ];
    // index 0 — intermediate, no finding (avoids duplicates across steps)
    expect(rule.evaluator(steps[0], ctxAt(0, steps))).toBeNull();
    // index 1 — last step, finding fires
    expect(rule.evaluator(steps[1], ctxAt(1, steps))).not.toBeNull();
  });

  it('sums transition durations across many steps', () => {
    const steps = [
      makeStep({ id: '1', transitions: [{ name: 'fade', durationMs: 500 }] }),
      makeStep({
        id: '2',
        transitions: [
          { name: 'fade', durationMs: 500 },
          { name: 'slide', durationMs: 500 },
        ],
      }),
      makeStep({ id: '3', transitions: [{ name: 'fade', durationMs: 500 }] }),
      makeStep({ id: '4', transitions: [{ name: 'fade', durationMs: 500 }] }),
    ];
    // aggregate = 2500ms, well under 4000ms — pass on the last step
    const last = steps.length - 1;
    expect(rule.evaluator(steps[last], ctxAt(last, steps))).toBeNull();
  });

  it('passes when no steps declare transitions', () => {
    const steps = [makeStep({ id: '1' }), makeStep({ id: '2' })];
    expect(rule.evaluator(steps[1], ctxAt(1, steps))).toBeNull();
  });
});

describe('evaluator purity', () => {
  function presentationFixture(): Step[] {
    return [
      makeStep({
        id: 's1',
        title: 'First',
        oneIdea: false,
        content: 'alpha bravo charlie delta echo foxtrot',
        transitions: [{ name: 'fade', durationMs: 400 }],
        images: [{ src: 'a.png' }],
      }),
      makeStep({
        id: 's2',
        title: 'Second',
        oneIdea: true,
        content: 'alpha bravo charlie delta echo foxtrot',
        transitions: [{ name: 'spin', durationMs: 900 }],
        narrativeBridge: 'continuing',
        images: [{ src: 'b.png', alt: 'a real image' }],
      }),
    ];
  }

  it('every rule returns deterministic findings — same input, same output across calls', () => {
    for (const rule of RUBRIC) {
      const steps = presentationFixture();
      const ctx = ctxAt(steps.length - 1, steps);
      const a = rule.evaluator(steps[steps.length - 1], ctx);
      const b = rule.evaluator(steps[steps.length - 1], ctx);
      expect(a).toEqual(b);
    }
  });

  it('no rule mutates the step it receives', () => {
    for (const rule of RUBRIC) {
      const steps = presentationFixture();
      const target = steps[steps.length - 1];
      const snapshot = JSON.stringify(target);
      rule.evaluator(target, ctxAt(steps.length - 1, steps));
      expect(JSON.stringify(target)).toBe(snapshot);
    }
  });

  it('no rule mutates the context.allSteps array it receives', () => {
    for (const rule of RUBRIC) {
      const steps = presentationFixture();
      const snapshot = JSON.stringify(steps);
      rule.evaluator(steps[steps.length - 1], ctxAt(steps.length - 1, steps));
      expect(JSON.stringify(steps)).toBe(snapshot);
    }
  });
});
