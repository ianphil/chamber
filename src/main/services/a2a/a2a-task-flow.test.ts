import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { TaskManager } from './TaskManager';
import { AgentCardRegistry } from './AgentCardRegistry';
import { buildSessionTools } from './tools';
import type { MessageRouter } from './MessageRouter';
import type { TaskSessionFactory } from './TaskManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockSession() {
  const emitter = new EventEmitter();
  return {
    send: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    on: (event: string, fn: (...args: unknown[]) => void) => emitter.on(event, fn),
    off: (event: string, fn: (...args: unknown[]) => void) => emitter.off(event, fn),
    _emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  };
}

function makeMockMindManager(session = makeMockSession()) {
  return {
    createTaskSession: vi.fn(async () => session),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

function makeMockRegistry() {
  const registry = new AgentCardRegistry();
  // Manually insert a card without touching the file system
  (registry as unknown as { cards: Map<string, unknown> }).cards.set('mind-target', {
    name: 'Target Agent',
    description: 'A test agent',
    version: '1.0.0',
    supportedInterfaces: [],
    capabilities: {},
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    mindId: 'mind-target',
  });
  return registry;
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    recipient: 'mind-target',
    message: {
      messageId: 'msg-1',
      role: 'user' as const,
      parts: [{ text: 'Do a thing', mediaType: 'text/plain' }],
      ...(overrides.message as Record<string, unknown> ?? {}),
    },
    configuration: { returnImmediately: true },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A2A Task Flow Integration', () => {
  let session: ReturnType<typeof makeMockSession>;
  let mindManager: ReturnType<typeof makeMockMindManager>;
  let registry: AgentCardRegistry;
  let taskManager: TaskManager;

  beforeEach(() => {
    session = makeMockSession();
    mindManager = makeMockMindManager(session);
    registry = makeMockRegistry();
    taskManager = new TaskManager(mindManager as unknown as TaskSessionFactory, registry);
  });

  // 1. Full lifecycle: sendTask → working → completed with artifact
  it('full lifecycle: submitted → working → completed with artifact', async () => {
    const events: { type: string; state?: string }[] = [];
    taskManager.on('task:status-update', (e) =>
      events.push({ type: 'status', state: e.status.state }),
    );
    taskManager.on('task:artifact-update', () =>
      events.push({ type: 'artifact' }),
    );

    const task = await taskManager.sendTask(makeRequest());
    expect(task.status.state).toBe('submitted');

    // Let microtask queue flush (processTask runs via Promise.resolve().then)
    await vi.waitFor(() => {
      expect(mindManager.createTaskSession).toHaveBeenCalled();
    });

    // Simulate assistant response then idle
    session._emit('assistant.message', { data: { content: 'Done!' } });
    session._emit('session.idle');

    await vi.waitFor(() => {
      expect(events.some((e) => e.state === 'completed')).toBe(true);
    });

    // Verify full state sequence: submitted → working → completed
    const states = events.filter((e) => e.type === 'status').map((e) => e.state);
    expect(states).toEqual(['submitted', 'working', 'completed']);

    // Verify artifact emitted
    expect(events.some((e) => e.type === 'artifact')).toBe(true);

    // Verify persisted task
    const persisted = taskManager.getTask(task.id);
    expect(persisted?.status.state).toBe('completed');
    expect(persisted?.artifacts).toHaveLength(1);
    expect(persisted?.artifacts?.[0].parts[0].text).toBe('Done!');
  });

  // 2. Task cancel mid-processing
  it('cancel mid-processing aborts session and sets canceled state', async () => {
    await taskManager.sendTask(makeRequest());

    // Wait for processTask to start
    await vi.waitFor(() => {
      expect(mindManager.createTaskSession).toHaveBeenCalled();
    });

    // Get the task id from the registry
    const tasks = taskManager.listTasks();
    const taskId = tasks.tasks[0].id;

    const canceled = taskManager.cancelTask(taskId);
    expect(canceled.status.state).toBe('canceled');
    expect(session.abort).toHaveBeenCalled();
  });

  // 3. Multiple tasks in same contextId
  it('multiple tasks with same contextId are listed correctly', async () => {
    const ctx = 'ctx-shared';
    const req1 = makeRequest({ message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Task A' }], contextId: ctx } });
    const req2 = makeRequest({ message: { messageId: 'msg-2', role: 'user', parts: [{ text: 'Task B' }], contextId: ctx } });

    const t1 = await taskManager.sendTask(req1);
    const t2 = await taskManager.sendTask(req2);

    expect(t1.id).not.toBe(t2.id);
    expect(t1.contextId).toBe(ctx);
    expect(t2.contextId).toBe(ctx);

    const byContext = taskManager.listTasks({ contextId: ctx });
    expect(byContext.tasks).toHaveLength(2);

    const byOther = taskManager.listTasks({ contextId: 'ctx-other' });
    expect(byOther.tasks).toHaveLength(0);
  });

  // 4. Task events reach IPC bus (event wiring test)
  it('task events forward to a2aEventBus', async () => {
    const a2aEventBus = new EventEmitter();
    const busEvents: string[] = [];
    a2aEventBus.on('task:status-update', () => busEvents.push('status'));
    a2aEventBus.on('task:artifact-update', () => busEvents.push('artifact'));

    // Wire events — same as main.ts should do
    taskManager.on('task:status-update', (e) => a2aEventBus.emit('task:status-update', e));
    taskManager.on('task:artifact-update', (e) => a2aEventBus.emit('task:artifact-update', e));

    await taskManager.sendTask(makeRequest());

    await vi.waitFor(() => {
      expect(mindManager.createTaskSession).toHaveBeenCalled();
    });

    session._emit('assistant.message', { data: { content: 'Result' } });
    session._emit('session.idle');

    await vi.waitFor(() => {
      expect(busEvents).toContain('artifact');
    });

    expect(busEvents.filter((e) => e === 'status').length).toBeGreaterThanOrEqual(3); // submitted, working, completed
    expect(busEvents).toContain('artifact');
  });

  // 5. buildSessionTools includes all 6 tools
  it('buildSessionTools returns 6 tools with correct names', () => {
    const mockRouter = {} as MessageRouter;
    const mockTaskMgr = {
      sendTask: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn(),
      cancelTask: vi.fn(),
    } as unknown as TaskManager;

    const tools = buildSessionTools('mind-1', [], mockRouter, registry, mockTaskMgr);

    expect(tools).toHaveLength(6);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'a2a_send_message',
        'a2a_list_agents',
        'a2a_send_task',
        'a2a_get_task',
        'a2a_list_tasks',
        'a2a_cancel_task',
      ]),
    );
  });
});
