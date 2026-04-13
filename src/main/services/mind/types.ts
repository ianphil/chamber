// Internal mind context — main process only, not exposed to renderer
// Extends the shared MindContext with infrastructure details

import type { MindContext } from '../../../shared/types.js';
import type { CopilotClient, CopilotSession, Tool } from '@github/copilot-sdk';

export type { CopilotClient, CopilotSession };
export type ExtensionTool = Tool;

export interface InternalMindContext extends MindContext {
  client: CopilotClient;
  session: CopilotSession | null;
  extensions: ExtensionTool[];
}
