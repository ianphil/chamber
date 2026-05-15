import type { ChamberToolProvider } from '../chamberTools';
import type { Tool } from '../mind/types';
import type { SullivanService } from './types';
import { buildSullivanTools } from './tools';

/**
 * Provider for the five Sullivan presentation tools.
 *
 * v1 stance: this provider is stateless. The Phase 3 tools are pure
 * functions over their declared inputs — they compose the Phase 1 /
 * Phase 2 primitives (`./contrast`, `./motionLimits`, `./rubric`) with
 * no fs / keytar / electron / network — so there is nothing to set up
 * on activation or tear down on release. `activateMind` and
 * `releaseMind` are therefore intentional no-ops; they exist to
 * satisfy `ChamberToolProvider`'s optional contract and to leave a
 * stable extension point for a future v2 that needs per-mind state.
 *
 * The cast `as Tool[]` mirrors `CanvasService.getToolsForMind`
 * (`packages/services/src/canvas/CanvasService.ts`). `SessionTool` is
 * structurally compatible with the SDK's `Tool<any>` — no runtime
 * transform, no duck-type adapter.
 */
export class SullivanToolsService implements ChamberToolProvider, SullivanService {
  getToolsForMind(mindId: string, mindPath: string): Tool[] {
    return buildSullivanTools(mindId, mindPath, this) as Tool[];
  }

  async activateMind(_mindId: string, _mindPath: string): Promise<void> {
    // stateless v1: no per-mind activation needed; see plan.md
    void _mindId;
    void _mindPath;
  }

  async releaseMind(_mindId: string): Promise<void> {
    // stateless v1: no per-mind activation needed; see plan.md
    void _mindId;
  }
}
