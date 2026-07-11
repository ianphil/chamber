import type { ChamberToolProvider } from '../chamberTools';
import { Logger } from '../logger';
import type { Tool } from '../mind/types';
import type {
  WtdCompactDraftDag,
  WtdRetrieveRequest,
  WtdRetrievalMode,
  WtdRuntimeClient,
  WtdToolResult,
} from './types';

const log = Logger.create('wtd');
const MAX_QUERY_LENGTH = 4_000;
const MAX_TITLE_LENGTH = 512;
const MAX_STEPS = 64;
const MAX_STEP_LENGTH = 512;
const DEFAULT_CANDIDATE_COUNT = 5;
const MAX_CANDIDATE_COUNT = 5;
const VALID_MODES = new Set<WtdRetrievalMode>(['auto', 'structural', 'metadata']);

export class WtdAdvisorService implements ChamberToolProvider {
  constructor(private readonly runtime: WtdRuntimeClient) {}

  getToolsForMind(): Tool[] {
    return [{
      name: 'wtd_retrieve_topology',
      description:
        'Recommend proven workflow topologies before authoring a non-trivial @ianphil/ttasks-ts TaskGraph. '
        + 'Pass the workflow intent as query text, compact draft steps, or both. '
        + 'WTD recommends structure only; you must still author, validate, and run the concrete automation script.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Workflow intent or goal. Maximum 4,000 characters.',
          },
          draftDag: {
            type: 'object',
            description: 'Compact draft workflow used for structural topology retrieval.',
            properties: {
              title: { type: 'string', description: 'Optional workflow title.' },
              steps: {
                type: 'array',
                description: 'Ordered rough workflow steps. Maximum 64.',
                items: { type: 'string' },
              },
            },
            required: ['steps'],
          },
          k: {
            type: 'number',
            description: 'Number of candidates to return, from 1 to 5. Defaults to 5.',
          },
          mode: {
            type: 'string',
            enum: ['auto', 'structural', 'metadata'],
            description: 'Retrieval mode. Defaults to auto.',
          },
        },
      },
      handler: async (args) => this.retrieve(args),
    }] as Tool[];
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
  }

  private async retrieve(args: Record<string, unknown>): Promise<WtdToolResult> {
    const request = parseRetrieveRequest(args);
    const startedAt = Date.now();
    try {
      const result = await this.runtime.retrieve(request);
      const shaped = shapeResult(result);
      log.info('WTD topology retrieval completed', {
        revision: result.revision,
        cacheHit: result.cacheHit,
        queryKind: result.queryKind,
        candidateCount: shaped.candidates.length,
        durationMs: Date.now() - startedAt,
      });
      return shaped;
    } catch (error) {
      log.warn('WTD topology retrieval failed', {
        errorType: error instanceof Error ? error.name : typeof error,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}

function parseRetrieveRequest(args: Record<string, unknown>): WtdRetrieveRequest {
  const query = optionalBoundedString(args.query, 'query', MAX_QUERY_LENGTH);
  const draftDag = args.draftDag === undefined ? undefined : parseDraftDag(args.draftDag);
  if (!query && !draftDag) {
    throw new Error('wtd_retrieve_topology requires query text, a draftDag, or both.');
  }

  const k = args.k === undefined ? DEFAULT_CANDIDATE_COUNT : parseCandidateCount(args.k);
  const mode = args.mode === undefined ? 'auto' : parseMode(args.mode);
  return {
    ...(query ? { query } : {}),
    ...(draftDag ? { draftDag } : {}),
    k,
    mode,
  };
}

function parseDraftDag(value: unknown): WtdCompactDraftDag {
  if (!isRecord(value) || !Array.isArray(value.steps)) {
    throw new Error('draftDag must contain a steps array.');
  }
  if (value.steps.length === 0 || value.steps.length > MAX_STEPS) {
    throw new Error(`draftDag.steps must contain between 1 and ${MAX_STEPS} steps.`);
  }
  const steps = value.steps.map((step, index) => {
    if (typeof step !== 'string') {
      throw new Error(`draftDag.steps[${index}] must be a string.`);
    }
    const trimmed = step.trim();
    if (!trimmed || trimmed.length > MAX_STEP_LENGTH) {
      throw new Error(`draftDag.steps[${index}] must contain 1 to ${MAX_STEP_LENGTH} characters.`);
    }
    return trimmed;
  });
  const title = optionalBoundedString(value.title, 'draftDag.title', MAX_TITLE_LENGTH);
  return { ...(title ? { title } : {}), steps };
}

function parseCandidateCount(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > MAX_CANDIDATE_COUNT) {
    throw new Error(`k must be an integer from 1 to ${MAX_CANDIDATE_COUNT}.`);
  }
  return value;
}

function parseMode(value: unknown): WtdRetrievalMode {
  if (typeof value !== 'string' || !VALID_MODES.has(value as WtdRetrievalMode)) {
    throw new Error('mode must be auto, structural, or metadata.');
  }
  return value as WtdRetrievalMode;
}

function optionalBoundedString(value: unknown, name: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maximum) {
    throw new Error(`${name} must not exceed ${maximum} characters.`);
  }
  return trimmed;
}

function shapeResult(result: Awaited<ReturnType<WtdRuntimeClient['retrieve']>>): WtdToolResult {
  return {
    packageVersion: result.packageVersion,
    revision: result.revision,
    cacheHit: result.cacheHit,
    queryKind: result.queryKind,
    querySummary: result.querySummary,
    ...(result.fallback ? { fallback: result.fallback } : {}),
    candidates: result.candidates.map((candidate) => ({
      ...(candidate.id ? { id: candidate.id } : {}),
      name: candidate.name,
      score: candidate.score,
      description: candidate.description,
      shape: {
        nodes: candidate.nodeCount,
        edges: candidate.edgeCount,
        ...(candidate.depth === undefined ? {} : { depth: candidate.depth }),
      },
      ...(candidate.rankReason ? { rankReason: candidate.rankReason } : {}),
      guidance: candidate.guidance,
      ...(candidate.risks ? { risks: candidate.risks } : {}),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
