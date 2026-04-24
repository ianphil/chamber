import type { ChamberToolProvider } from '../chamberTools';
import { buildA2ATools } from './tools';
import type { MessageRouter } from './MessageRouter';
import type { AgentCardRegistry } from './AgentCardRegistry';
import type { TaskManager } from './TaskManager';
import type { Tool } from '../mind/types';

export class A2aToolProvider implements ChamberToolProvider {
  constructor(
    private readonly messageRouter: MessageRouter,
    private readonly agentCardRegistry: AgentCardRegistry,
    private readonly taskManager: TaskManager,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getToolsForMind(mindId: string, _mindPath: string): Tool[] {
    return buildA2ATools(
      mindId,
      this.messageRouter,
      this.agentCardRegistry,
      this.taskManager,
    ) as Tool[];
  }
}
