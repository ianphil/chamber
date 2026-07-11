export type WtdRetrievalMode = 'auto' | 'structural' | 'metadata';

export interface WtdCompactDraftDag {
  readonly title?: string;
  readonly steps: string[];
}

export interface WtdRetrieveRequest {
  readonly query?: string;
  readonly draftDag?: WtdCompactDraftDag;
  readonly k?: number;
  readonly mode?: WtdRetrievalMode;
}

export interface WtdRuntimeCandidate {
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly score: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly depth?: number;
  readonly rankReason?: string;
  readonly guidance: string;
  readonly risks?: string[];
}

export interface WtdRuntimeRetrieveResult {
  readonly packageVersion: string;
  readonly revision: string;
  readonly cacheHit: boolean;
  readonly queryKind: 'text' | 'draftDag';
  readonly querySummary: string;
  readonly candidates: WtdRuntimeCandidate[];
  readonly fallback?: {
    readonly used: boolean;
    readonly from: string;
    readonly to: string;
    readonly reason: string;
  };
}

export interface WtdRuntimeClient {
  retrieve(request: WtdRetrieveRequest): Promise<WtdRuntimeRetrieveResult>;
  stop(): Promise<void>;
}

export interface WtdToolResult {
  readonly packageVersion: string;
  readonly revision: string;
  readonly cacheHit: boolean;
  readonly queryKind: 'text' | 'draftDag';
  readonly querySummary: string;
  readonly fallback?: WtdRuntimeRetrieveResult['fallback'];
  readonly candidates: Array<{
    readonly id?: string;
    readonly name: string;
    readonly score: number;
    readonly description: string;
    readonly shape: {
      readonly nodes: number;
      readonly edges: number;
      readonly depth?: number;
    };
    readonly rankReason?: string;
    readonly guidance: string;
    readonly risks?: string[];
  }>;
}
