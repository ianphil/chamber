import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildA2ATools } from './tools';
import type { AgentCard, SendMessageRequest, Task } from './types';
import type { MessageRouter } from './MessageRouter';
import type { AgentCardRegistry } from './AgentCardRegistry';
import type { TaskManager } from './TaskManager';

interface ToolParameterSchema {
  type: string;
  properties: Record<string, { type: string; description?: string; items?: { type: string } }>;
  required?: string[];
}

const mockTaskManager = {
  sendTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  cancelTask: vi.fn(),
};

const mockRouter = {
  sendMessage: vi.fn(async (req: SendMessageRequest) => ({
    message: {
      messageId: req.message.messageId,
      contextId: 'ctx-assigned',
      role: 'user',
      parts: req.message.parts,
    },
  })),
};

const mockRegistry = {
  getCard: vi.fn(),
  getCards: vi.fn(() => [
    {
      mindId: 'mind-a',
      name: 'Agent A',
      description: 'First agent',
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    },
    {
      mindId: 'mind-b',
      name: 'Agent B',
      description: 'Second agent',
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    },
    {
      mindId: 'mind-c',
      name: 'Agent C',
      description: 'Third agent',
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    },
  ]),
  getCardByName: vi.fn(),
};

describe('A2A Tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('buildA2ATools() returns all 6 A2A tools', () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    expect(tools.length).toBe(6);
  });

  it('buildA2ATools() includes send_message and list_agents', () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const names = tools.map((t) => t.name);
    expect(names).toContain('a2a_send_message');
    expect(names).toContain('a2a_list_agents');
  });

  it('send_message tool has correct parameter schema', () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message');
    if (!sendTool) throw new Error('Expected to find a2a_send_message tool');
    expect(sendTool.parameters).toBeDefined();
    const params = sendTool.parameters as unknown as ToolParameterSchema;
    expect(params.properties.recipient).toBeDefined();
    expect(params.properties.message).toBeDefined();
    expect(params.required).toContain('recipient');
    expect(params.required).toContain('message');
  });

  it('send_message handler constructs conformant A2A Message', async () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message');
    if (!sendTool) throw new Error('Expected to find a2a_send_message tool');
    await sendTool.handler({ recipient: 'mind-b', message: 'Hello B' });

    expect(mockRouter.sendMessage).toHaveBeenCalledTimes(1);
    const req = mockRouter.sendMessage.mock.calls[0][0];
    expect(req.message.role).toBe('user');
    expect(req.message.parts[0].text).toBe('Hello B');
    expect(req.message.parts[0].mediaType).toBe('text/plain');
    expect(req.message.metadata!.fromId).toBe('mind-a');
    expect(req.message.metadata!.hopCount).toBe(0);
  });

  it('send_message handler constructs SendMessageRequest with returnImmediately', async () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message');
    if (!sendTool) throw new Error('Expected to find a2a_send_message tool');
    await sendTool.handler({ recipient: 'mind-b', message: 'Hello' });

    const req = mockRouter.sendMessage.mock.calls[0][0];
    expect(req.recipient).toBe('mind-b');
    expect(req.configuration!.returnImmediately).toBe(true);
  });

  it('send_message handler returns SendMessageResponse shape', async () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message');
    if (!sendTool) throw new Error('Expected to find a2a_send_message tool');
    const result = await sendTool.handler({ recipient: 'mind-b', message: 'Hello' });

    expect(result).toHaveProperty('message');
    expect((result as { message: { contextId: string } }).message.contextId).toBe('ctx-assigned');
  });

  it('send_message handler passes context_id when provided', async () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message');
    if (!sendTool) throw new Error('Expected to find a2a_send_message tool');
    await sendTool.handler({
      recipient: 'mind-b',
      message: 'Follow up',
      context_id: 'ctx-existing',
    });

    const req = mockRouter.sendMessage.mock.calls[0][0];
    expect(req.message.contextId).toBe('ctx-existing');
  });

  it('list_agents returns AgentCards excluding self', async () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const listTool = tools.find((t) => t.name === 'a2a_list_agents');
    if (!listTool) throw new Error('Expected to find a2a_list_agents tool');
    const result = await listTool.handler({});

    expect(Array.isArray(result)).toBe(true);
    const agents = result as AgentCard[];
    expect(agents.length).toBe(2); // 3 total minus self (mind-a)
    expect(agents.every((a) => a.mindId !== 'mind-a')).toBe(true);
  });

  it('list_agents returns full A2A AgentCard shape', async () => {
    const tools = buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
    const listTool = tools.find((t) => t.name === 'a2a_list_agents');
    if (!listTool) throw new Error('Expected to find a2a_list_agents tool');
    const result = (await listTool.handler({})) as AgentCard[];

    const card = result[0];
    expect(card).toHaveProperty('name');
    expect(card).toHaveProperty('description');
    expect(card).toHaveProperty('skills');
    expect(card).toHaveProperty('supportedInterfaces');
    expect(card).toHaveProperty('mindId');
  });

  it('tools are mind-scoped via closure', async () => {
    const toolsA = buildA2ATools('mind-a', mockRouter as unknown as MessageRouter, mockRegistry as unknown as AgentCardRegistry, mockTaskManager as unknown as TaskManager);
    const toolsB = buildA2ATools('mind-b', mockRouter as unknown as MessageRouter, mockRegistry as unknown as AgentCardRegistry, mockTaskManager as unknown as TaskManager);

    const sendA = toolsA.find((t) => t.name === 'a2a_send_message');
    if (!sendA) throw new Error('Expected to find a2a_send_message tool');
    const sendB = toolsB.find((t) => t.name === 'a2a_send_message');
    if (!sendB) throw new Error('Expected to find a2a_send_message tool');

    await sendA.handler({ recipient: 'mind-c', message: 'From A' });
    await sendB.handler({ recipient: 'mind-c', message: 'From B' });

    expect(mockRouter.sendMessage.mock.calls[0][0].message.metadata!.fromId).toBe('mind-a');
    expect(mockRouter.sendMessage.mock.calls[1][0].message.metadata!.fromId).toBe('mind-b');
  });
});

// ---------------------------------------------------------------------------
// Task Tools
// ---------------------------------------------------------------------------

describe('A2A Task Tools', () => {
  beforeEach(() => vi.clearAllMocks());

  function getTools() {
    return buildA2ATools(
      'mind-a',
      mockRouter as unknown as MessageRouter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
  }

  function findTool(name: string) {
    const tool = getTools().find((t) => t.name === name);
    if (!tool) throw new Error('Expected to find tool ' + name);
    return tool;
  }

  const fakeTask: Task = {
    id: 'task-123',
    contextId: 'ctx-456',
    status: { state: 'submitted', timestamp: new Date().toISOString() },
    artifacts: [],
    history: [],
  };

  // 1. a2a_send_task creates task via TaskManager.sendTask
  it('a2a_send_task creates task via TaskManager.sendTask', async () => {
    mockTaskManager.sendTask.mockResolvedValueOnce(fakeTask);
    const tool = findTool('a2a_send_task');
    await tool.handler({ recipient: 'mind-b', message: 'Do something' });

    expect(mockTaskManager.sendTask).toHaveBeenCalledTimes(1);
    const req = mockTaskManager.sendTask.mock.calls[0][0];
    expect(req.recipient).toBe('mind-b');
    expect(req.message.parts[0].text).toBe('Do something');
    expect(req.configuration.returnImmediately).toBe(true);
  });

  // 2. a2a_send_task passes contextId and referenceTaskIds
  it('a2a_send_task passes contextId and referenceTaskIds', async () => {
    mockTaskManager.sendTask.mockResolvedValueOnce(fakeTask);
    const tool = findTool('a2a_send_task');
    await tool.handler({
      recipient: 'mind-b',
      message: 'Follow up',
      context_id: 'ctx-existing',
      reference_task_ids: ['task-prev-1', 'task-prev-2'],
    });

    const req = mockTaskManager.sendTask.mock.calls[0][0];
    expect(req.message.contextId).toBe('ctx-existing');
    expect(req.message.referenceTaskIds).toEqual(['task-prev-1', 'task-prev-2']);
  });

  // 3. a2a_send_task returns task with id and state
  it('a2a_send_task returns task with id and state', async () => {
    mockTaskManager.sendTask.mockResolvedValueOnce(fakeTask);
    const tool = findTool('a2a_send_task');
    const result = (await tool.handler({ recipient: 'mind-b', message: 'Go' })) as Task;

    expect(result.id).toBe('task-123');
    expect(result.contextId).toBe('ctx-456');
    expect(result.status.state).toBe('submitted');
  });

  // 4. a2a_send_task has natural language description
  it('a2a_send_task has natural language description', () => {
    const tool = findTool('a2a_send_task');
    expect(tool.description.length).toBeGreaterThan(20);
    expect(tool.description.toLowerCase()).toContain('task');
  });

  // 5. a2a_get_task returns task from TaskManager
  it('a2a_get_task returns task from TaskManager', async () => {
    mockTaskManager.getTask.mockReturnValueOnce(fakeTask);
    const tool = findTool('a2a_get_task');
    const result = await tool.handler({ task_id: 'task-123' });

    expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-123', undefined);
    expect(result).toEqual(fakeTask);
  });

  // 6. a2a_get_task with historyLength param
  it('a2a_get_task with historyLength param', async () => {
    mockTaskManager.getTask.mockReturnValueOnce(fakeTask);
    const tool = findTool('a2a_get_task');
    await tool.handler({ task_id: 'task-123', history_length: 5 });

    expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-123', 5);
  });

  // 7. a2a_get_task for unknown task returns error message
  it('a2a_get_task for unknown task returns error message', async () => {
    mockTaskManager.getTask.mockReturnValueOnce(null);
    const tool = findTool('a2a_get_task');
    const result = await tool.handler({ task_id: 'task-nonexistent' });

    expect(result).toEqual({ error: 'Task not found' });
  });

  // 8. a2a_list_tasks returns tasks from TaskManager
  it('a2a_list_tasks returns tasks from TaskManager', async () => {
    const response = { tasks: [fakeTask], nextPageToken: '', pageSize: 1, totalSize: 1 };
    mockTaskManager.listTasks.mockReturnValueOnce(response);
    const tool = findTool('a2a_list_tasks');
    const result = await tool.handler({});

    expect(mockTaskManager.listTasks).toHaveBeenCalledTimes(1);
    expect(result).toEqual(response);
  });

  // 9. a2a_list_tasks passes filter params
  it('a2a_list_tasks passes filter params', async () => {
    const response = { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 };
    mockTaskManager.listTasks.mockReturnValueOnce(response);
    const tool = findTool('a2a_list_tasks');
    await tool.handler({ context_id: 'ctx-456', status: 'working' });

    expect(mockTaskManager.listTasks).toHaveBeenCalledWith({ contextId: 'ctx-456', status: 'working' });
  });

  // 9b. a2a_list_tasks rejects invalid status string with error message
  it('a2a_list_tasks rejects invalid status string with error message', async () => {
    const tool = findTool('a2a_list_tasks');
    const result = await tool.handler({ status: 'bogus' });

    expect(result).toEqual({ error: expect.stringContaining('Invalid status: bogus') });
    expect(mockTaskManager.listTasks).not.toHaveBeenCalled();
  });

  // 10. a2a_cancel_task cancels via TaskManager
  it('a2a_cancel_task cancels via TaskManager', async () => {
    const canceledTask = { ...fakeTask, status: { state: 'canceled' as const, timestamp: new Date().toISOString() } };
    mockTaskManager.cancelTask.mockReturnValueOnce(canceledTask);
    const tool = findTool('a2a_cancel_task');
    const result = await tool.handler({ task_id: 'task-123' });

    expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-123');
    expect((result as Task).status.state).toBe('canceled');
  });

  // 11. a2a_cancel_task for terminal task returns error message
  it('a2a_cancel_task for terminal task returns error message', async () => {
    mockTaskManager.cancelTask.mockImplementationOnce(() => {
      throw new Error('Cannot cancel task in terminal state: completed');
    });
    const tool = findTool('a2a_cancel_task');
    const result = await tool.handler({ task_id: 'task-done' });

    expect(result).toEqual({ error: 'Cannot cancel task in terminal state: completed' });
  });

  // 12. All 4 tools have correct parameter schemas
  it('all task tools have correct parameter schemas', () => {
    const tools = getTools();

    const sendTask = tools.find((t) => t.name === 'a2a_send_task');
    if (!sendTask) throw new Error('Expected to find a2a_send_task tool');
    const sendParams = sendTask.parameters as unknown as ToolParameterSchema;
    expect(sendParams.required).toContain('recipient');
    expect(sendParams.required).toContain('message');
    expect(sendParams.properties.context_id).toBeDefined();
    expect(sendParams.properties.reference_task_ids).toBeDefined();
    expect(sendParams.properties.reference_task_ids.type).toBe('array');

    const getTask = tools.find((t) => t.name === 'a2a_get_task');
    if (!getTask) throw new Error('Expected to find a2a_get_task tool');
    const getParams = getTask.parameters as unknown as ToolParameterSchema;
    expect(getParams.required).toContain('task_id');
    expect(getParams.properties.history_length).toBeDefined();
    expect(getParams.properties.history_length.type).toBe('number');

    const listTasks = tools.find((t) => t.name === 'a2a_list_tasks');
    if (!listTasks) throw new Error('Expected to find a2a_list_tasks tool');
    const listParams = listTasks.parameters as unknown as ToolParameterSchema;
    expect(listParams.properties.context_id).toBeDefined();
    expect(listParams.properties.status).toBeDefined();
    expect(listParams.required).toBeUndefined();

    const cancelTask = tools.find((t) => t.name === 'a2a_cancel_task');
    if (!cancelTask) throw new Error('Expected to find a2a_cancel_task tool');
    const cancelParams = cancelTask.parameters as unknown as ToolParameterSchema;
    expect(cancelParams.required).toContain('task_id');
  });
});