// Internal mind context — main process only, not exposed to renderer
// Extends the shared MindContext with infrastructure details

import type { MindContext } from '../../../shared/types.js';
import type { CopilotClient, CopilotSession, SessionConfig, Tool as SdkTool } from '@github/copilot-sdk';

export type { CopilotClient, CopilotSession };

// Match the SDK's own SessionConfig.tools signature (Tool<any>[]), so that any
// tool flavor — ExtensionTool, SessionTool, or SDK Tool — satisfies it without casts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tool = SdkTool<any>;

// UserInputHandler / request / response are not re-exported from the SDK's public
// index, but SessionConfig.onUserInputRequest exposes the handler type. Derive them
// from SessionConfig so our types stay in sync with whatever the SDK ships.
export type UserInputHandler = NonNullable<SessionConfig['onUserInputRequest']>;
export type UserInputRequest = Parameters<UserInputHandler>[0];
export type UserInputResponse = Awaited<ReturnType<UserInputHandler>>;

export interface InternalMindContext extends MindContext {
  client: CopilotClient;
  session: CopilotSession | null;
}
