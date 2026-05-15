import { describe, it, expect } from 'vitest';
import type { ChamberToolProvider } from '../chamberTools';
import type { SessionTool } from '../a2a/tools';
import type {
  ContrastCheckResult,
  CritiqueResult,
  MotionBudgetResult,
  OutlineValidateResult,
  PresentationTemplateResult,
} from './tools';
import { SullivanToolsService } from './SullivanToolsService';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

const MIND_ID = 'mind-test';
const MIND_PATH = '/tmp/mind-test';

const TOOL_NAMES = [
  'presentation_template',
  'presentation_outline_validate',
  'presentation_critique',
  'presentation_contrast_check',
  'presentation_motion_budget',
] as const;

function makeService(): SullivanToolsService {
  return new SullivanToolsService();
}

/**
 * Resolve a tool from the provider for runtime invocation. The provider
 * returns SDK `Tool[]` (matching `ChamberToolProvider.getToolsForMind`'s
 * signature). The runtime objects are `SessionTool` shape — same as
 * `buildSullivanTools` produces — so we cast through `unknown` to drive
 * the handler with the `(args)` signature the underlying tools use.
 */
function resolveSessionTool(
  service: SullivanToolsService,
  mindId: string,
  mindPath: string,
  name: string,
): SessionTool {
  const tools = service.getToolsForMind(mindId, mindPath) as unknown as SessionTool[];
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

// -----------------------------------------------------------------------------
// Provider contract — ChamberToolProvider shape
// -----------------------------------------------------------------------------

describe('SullivanToolsService — provider contract', () => {
  it('is assignable to ChamberToolProvider', () => {
    const service: ChamberToolProvider = new SullivanToolsService();
    expect(typeof service.getToolsForMind).toBe('function');
    expect(typeof service.activateMind).toBe('function');
    expect(typeof service.releaseMind).toBe('function');
  });

  it('getToolsForMind returns an array', () => {
    const service = makeService();
    const tools = service.getToolsForMind(MIND_ID, MIND_PATH);
    expect(Array.isArray(tools)).toBe(true);
  });

  it('returns exactly the five Sullivan tools in stable order', () => {
    const service = makeService();
    const tools = service.getToolsForMind(MIND_ID, MIND_PATH);
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('every returned tool has the SessionTool fields', () => {
    const service = makeService();
    const tools = service.getToolsForMind(MIND_ID, MIND_PATH) as unknown as SessionTool[];
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.parameters).toBe('object');
      expect(tool.parameters).not.toBeNull();
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('successive calls to getToolsForMind return independent array references', () => {
    const service = makeService();
    const first = service.getToolsForMind(MIND_ID, MIND_PATH);
    const second = service.getToolsForMind(MIND_ID, MIND_PATH);
    expect(first).not.toBe(second);
    expect(first.map((t) => t.name)).toEqual(second.map((t) => t.name));
  });
});

// -----------------------------------------------------------------------------
// Stateless lifecycle — activateMind / releaseMind are no-ops
// -----------------------------------------------------------------------------

describe('SullivanToolsService — stateless lifecycle', () => {
  it('activateMind resolves without throwing', async () => {
    const service = makeService();
    await expect(service.activateMind('m1', '/tmp/m1')).resolves.toBeUndefined();
  });

  it('activateMind leaves getToolsForMind output unchanged', async () => {
    const service = makeService();
    const before = service.getToolsForMind('m1', '/tmp/m1').map((t) => t.name);
    await service.activateMind('m1', '/tmp/m1');
    const after = service.getToolsForMind('m1', '/tmp/m1').map((t) => t.name);
    expect(after).toEqual(before);
  });

  it('releaseMind resolves without throwing', async () => {
    const service = makeService();
    await expect(service.releaseMind('m1')).resolves.toBeUndefined();
  });

  it('releaseMind is idempotent — repeated calls all resolve', async () => {
    const service = makeService();
    await service.releaseMind('m1');
    await service.releaseMind('m1');
    await expect(service.releaseMind('m1')).resolves.toBeUndefined();
  });

  it('releaseMind before activateMind resolves without throwing', async () => {
    const service = makeService();
    await expect(service.releaseMind('never-activated')).resolves.toBeUndefined();
  });

  it('does not retain per-mind state across getToolsForMind calls', () => {
    const service = makeService();
    const namesForA = service.getToolsForMind('m1', '/tmp/m1').map((t) => t.name);
    const namesForB = service.getToolsForMind('m2', '/tmp/m2').map((t) => t.name);
    expect(namesForA).toEqual([...TOOL_NAMES]);
    expect(namesForB).toEqual([...TOOL_NAMES]);
  });

  it('two service instances produce equivalent tool lists', () => {
    const a = new SullivanToolsService();
    const b = new SullivanToolsService();
    expect(a.getToolsForMind(MIND_ID, MIND_PATH).map((t) => t.name)).toEqual(
      b.getToolsForMind(MIND_ID, MIND_PATH).map((t) => t.name),
    );
  });

  it('activate/release in any order has no observable effect on tool output', async () => {
    const service = makeService();
    await service.releaseMind('m1');
    await service.activateMind('m1', '/tmp/m1');
    await service.activateMind('m1', '/tmp/m1');
    await service.releaseMind('m1');
    const names = service.getToolsForMind('m1', '/tmp/m1').map((t) => t.name);
    expect(names).toEqual([...TOOL_NAMES]);
  });
});

// -----------------------------------------------------------------------------
// Integration smoke — invoke each handler through the provider
// -----------------------------------------------------------------------------

describe('SullivanToolsService — integration smoke through the provider', () => {
  it('presentation_template handler returns the empty-scaffold shape', async () => {
    const service = makeService();
    const tool = resolveSessionTool(service, MIND_ID, MIND_PATH, 'presentation_template');
    const result = (await tool.handler({
      topic: 'Cell division',
      audience: 'High school biology students',
      learningObjective: 'Distinguish mitosis from meiosis.',
    })) as PresentationTemplateResult;

    expect(result).toEqual(
      expect.objectContaining({
        thesis: '',
        narrativeArc: [],
        steps: [],
      }),
    );
    expect(result.guidance.oneIdeaPerStep).toBe(true);
    expect(typeof result.guidance.maxWordsPerSlide).toBe('number');
    expect(result.guidance.timeBudgetTargetMinutes).toBeNull();
  });

  it('presentation_outline_validate handler returns findings + summary on a clean outline', async () => {
    const service = makeService();
    const tool = resolveSessionTool(
      service,
      MIND_ID,
      MIND_PATH,
      'presentation_outline_validate',
    );
    const result = (await tool.handler({
      thesis: 'Photosynthesis converts light to chemical energy.',
      narrativeArc: ['hook', 'body', 'close'],
      steps: [
        { id: 's1', title: 'Hook', content: 'Plants need sunlight.', oneIdea: true },
        { id: 's2', title: 'Body', content: 'Chloroplasts capture photons.', oneIdea: true },
        { id: 's3', title: 'Close', content: 'Energy flows to all life.', oneIdea: true },
      ],
    })) as OutlineValidateResult;

    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.summary).toEqual(
      expect.objectContaining({
        blockCount: expect.any(Number),
        warnCount: expect.any(Number),
        noteCount: expect.any(Number),
      }),
    );
  });

  it('presentation_critique handler returns findings + perStep + summary', async () => {
    const service = makeService();
    const tool = resolveSessionTool(service, MIND_ID, MIND_PATH, 'presentation_critique');
    const result = (await tool.handler({
      steps: [
        { id: 's1', title: 'Hook', content: 'Plants need sunlight.', oneIdea: true },
        { id: 's2', title: 'Body', content: 'Chloroplasts capture photons.', oneIdea: true },
        { id: 's3', title: 'Close', content: 'Energy flows to all life.', oneIdea: true },
      ],
    })) as CritiqueResult;

    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.perStep)).toBe(true);
    expect(result.perStep).toHaveLength(3);
    expect(result.perStep.map((s) => s.stepId)).toEqual(['s1', 's2', 's3']);
    expect(result.summary).toEqual(
      expect.objectContaining({
        blockCount: expect.any(Number),
        warnCount: expect.any(Number),
        noteCount: expect.any(Number),
      }),
    );
  });

  it('presentation_contrast_check handler returns AA/AAA + recommendation per pair', async () => {
    const service = makeService();
    const tool = resolveSessionTool(
      service,
      MIND_ID,
      MIND_PATH,
      'presentation_contrast_check',
    );
    const result = (await tool.handler({
      pairs: [
        { foreground: '#000000', background: '#ffffff', label: 'body' },
        { foreground: '#777777', background: '#ffffff', label: 'muted' },
      ],
    })) as readonly ContrastCheckResult[];

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(typeof entry.ratio).toBe('number');
      expect(entry.AA).toEqual(
        expect.objectContaining({
          largeText: expect.any(Boolean),
          normalText: expect.any(Boolean),
        }),
      );
      expect(entry.AAA).toEqual(
        expect.objectContaining({
          largeText: expect.any(Boolean),
          normalText: expect.any(Boolean),
        }),
      );
      expect(typeof entry.recommendation).toBe('string');
      expect(entry.recommendation.length).toBeGreaterThan(0);
    }
  });

  it('presentation_motion_budget handler returns perTransition + aggregate', async () => {
    const service = makeService();
    const tool = resolveSessionTool(
      service,
      MIND_ID,
      MIND_PATH,
      'presentation_motion_budget',
    );
    const result = (await tool.handler({
      transitions: [
        { id: 't1', durationMs: 300, type: 'fade' },
        { id: 't2', durationMs: 500, type: 'zoom' },
      ],
    })) as MotionBudgetResult;

    expect(Array.isArray(result.perTransition)).toBe(true);
    expect(result.perTransition).toHaveLength(2);
    for (const t of result.perTransition) {
      expect(typeof t.withinPerTransitionBudget).toBe('boolean');
      expect(typeof t.reducedMotionEquivalent).toBe('string');
      expect(typeof t.recommendation).toBe('string');
    }
    expect(result.aggregate.totalDurationMs).toBe(800);
    expect(typeof result.aggregate.withinAggregateBudget).toBe('boolean');
    expect(typeof result.aggregate.recommendation).toBe('string');
  });

  it('handler errors on malformed input propagate as thrown errors (template)', async () => {
    const service = makeService();
    const tool = resolveSessionTool(service, MIND_ID, MIND_PATH, 'presentation_template');
    await expect(tool.handler({})).rejects.toThrow(/topic/i);
  });
});
