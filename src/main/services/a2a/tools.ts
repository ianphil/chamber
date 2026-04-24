import type { MessageRouter } from './MessageRouter';
import type { AgentCardRegistry } from './AgentCardRegistry';
import type { TaskManager } from './TaskManager';
import type { TaskState } from './types';
import { createTextMessage } from './helpers';

export interface SessionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function buildA2ATools(
  mindId: string,
  messageRouter: MessageRouter,
  agentCardRegistry: AgentCardRegistry,
  taskManager: TaskManager,
): SessionTool[] {
  const sendMessage: SessionTool = {
    name: 'a2a_send_message',
    description:
      'Send a message to another agent in this workspace. Messages are delivered to the other agent\'s conversation. Call a2a_list_agents first if you don\'t know the recipient\'s ID.',
    parameters: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'The mindId or name of the target agent' },
        message: { type: 'string', description: 'The message content to send' },
        context_id: {
          type: 'string',
          description: 'Optional context ID to continue an existing conversation',
        },
      },
      required: ['recipient', 'message'],
    },
    handler: async (args) => {
      const { recipient, message: text, context_id } = args as {
        recipient: string;
        message: string;
        context_id?: string;
      };
      const a2aMessage = createTextMessage(mindId, text, {
        contextId: context_id,
      });
      const response = await messageRouter.sendMessage({
        recipient,
        message: a2aMessage,
        configuration: { returnImmediately: true },
      });
      return response;
    },
  };

  const listAgents: SessionTool = {
    name: 'a2a_list_agents',
    description:
      'List other agents in this workspace that you can talk to. Returns their names, descriptions, and skills. Use this when the user asks about other agents or wants to send a message to one.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      return agentCardRegistry.getCards().filter((c) => c.mindId !== mindId);
    },
  };

  return [sendMessage, listAgents, ...buildTaskTools(mindId, taskManager)];
}

const VALID_TASK_STATES: Set<string> = new Set([
  'submitted', 'working', 'completed', 'failed', 'canceled', 'input-required', 'rejected', 'auth-required',
]);

function buildTaskTools(mindId: string, taskManager: TaskManager): SessionTool[] {
  const sendTask: SessionTool = {
    name: 'a2a_send_task',
    description:
      'Create a tracked task for another agent. The agent will work on it asynchronously. Use a2a_get_task to check progress.',
    parameters: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'The mindId or name of the target agent' },
        message: { type: 'string', description: 'The task description to send' },
        context_id: {
          type: 'string',
          description: 'Optional context ID to group related tasks',
        },
        reference_task_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional IDs of related tasks for context',
        },
      },
      required: ['recipient', 'message'],
    },
    handler: async (args) => {
      const { recipient, message: text, context_id, reference_task_ids } = args as {
        recipient: string;
        message: string;
        context_id?: string;
        reference_task_ids?: string[];
      };
      const a2aMessage = createTextMessage(mindId, text, { contextId: context_id });
      if (reference_task_ids) {
        a2aMessage.referenceTaskIds = reference_task_ids;
      }
      return taskManager.sendTask({
        recipient,
        message: a2aMessage,
        configuration: { returnImmediately: true },
      });
    },
  };

  const getTask: SessionTool = {
    name: 'a2a_get_task',
    description:
      'Check the status of a task. Returns the task\'s current state, artifacts, and history.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the task to retrieve' },
        history_length: {
          type: 'number',
          description: 'Optional max number of history messages to return',
        },
      },
      required: ['task_id'],
    },
    handler: async (args) => {
      const { task_id, history_length } = args as {
        task_id: string;
        history_length?: number;
      };
      const task = taskManager.getTask(task_id, history_length);
      return task ?? { error: 'Task not found' };
    },
  };

  const listTasks: SessionTool = {
    name: 'a2a_list_tasks',
    description: 'List tasks, optionally filtered by context or status.',
    parameters: {
      type: 'object',
      properties: {
        context_id: { type: 'string', description: 'Filter by context ID' },
        status: { type: 'string', description: 'Filter by task state (e.g. submitted, working, completed)' },
      },
    },
    handler: async (args) => {
      const { context_id, status } = args as {
        context_id?: string;
        status?: string;
      };
      if (status && !VALID_TASK_STATES.has(status)) {
        return { error: `Invalid status: ${status}. Valid values: ${[...VALID_TASK_STATES].join(', ')}` };
      }
      return taskManager.listTasks({ contextId: context_id, status: status as TaskState });
    },
  };

  const cancelTask: SessionTool = {
    name: 'a2a_cancel_task',
    description: 'Cancel a task that is in progress.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the task to cancel' },
      },
      required: ['task_id'],
    },
    handler: async (args) => {
      const { task_id } = args as { task_id: string };
      try {
        return taskManager.cancelTask(task_id);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [sendTask, getTask, listTasks, cancelTask];
}
