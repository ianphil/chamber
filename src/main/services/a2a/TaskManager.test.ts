import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManager } from './TaskManager';
import type { TaskSessionFactory } from './TaskManager';
import type { AgentCard, SendMessageRequest, TaskState, Message, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, Artifact } from './types';
import type { AgentCardRegistry } from './AgentCardRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeCard(overrides: Partial<AgentCard> & { mindId: string; name: string }): AgentCard {
  return {
    description: 'Test agent',
    version: '1.0.0',
    supportedInterfaces: [{ url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' }],
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    ...overrides,
  };
}

function makeRequest(
  recipient: string,
  text: string,
  opts?: { contextId?: string; referenceTaskIds?: string[] },
): SendMessageRequest {
  return {
    recipient,
    message: {
      messageId: 'msg-test-1',
      role: 'user',
      parts: [{ text, mediaType: 'text/plain' }],
      metadata: { fromId: 'sender-1', fromName: 'Sender' },
      contextId: opts?.contextId,
      referenceTaskIds: opts?.referenceTaskIds,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock session factory
// ---------------------------------------------------------------------------

type SessionCallback = (event?: unknown) => void;

function createMockSession() {
  const listeners = new Map<string, SessionCallback[]>();
  return {
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: SessionCallback) => {
      if (!listeners.has(event)) listeners.set(event, []);
      const cbs = listeners.get(event);
      if (cbs) cbs.push(cb);
      return vi.fn(); // unsub
    }),
    // test helper — fire a registered event
    _emit(event: string, data?: unknown) {
      for (const cb of listeners.get(event) ?? []) cb(data);
    },
    _listeners: listeners,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRegistry = {
  getCard: vi.fn() as ReturnType<typeof vi.fn>,
  getCardByName: vi.fn() as ReturnType<typeof vi.fn>,
  getCards: vi.fn() as ReturnType<typeof vi.fn>,
};

let latestMockSession: ReturnType<typeof createMockSession>;

const mockMindManager = {
  createTaskSession: vi.fn(async () => {
    latestMockSession = createMockSession();
    return latestMockSession;
  }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskManager', () => {
  let tm: TaskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    tm = new TaskManager(mockMindManager as unknown as TaskSessionFactory, mockRegistry as unknown as AgentCardRegistry);
  });


  it('sendTask() creates task with generated id starting with task-', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    expect(task.id).toMatch(/^task-/);
  });


  it('sendTask() sets initial state to submitted', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    expect(task.status.state).toBe('submitted');
  });


  it('sendTask() always assigns contextId (never undefined)', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    expect(task.contextId).toBeDefined();
    expect(typeof task.contextId).toBe('string');
    expect(task.contextId.length).toBeGreaterThan(0);
  });


  it('sendTask() transitions to working after send', async () => {
    const events: TaskStatusUpdateEvent[] = [];
    tm.on('task:status-update', (e) => events.push(e));

    await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    const workingEvent = events.find((e) => e.status.state === 'working');
    expect(workingEvent).toBeDefined();
  });


  it('sendTask() transitions to completed on session idle', async () => {
    const events: TaskStatusUpdateEvent[] = [];
    tm.on('task:status-update', (e) => events.push(e));

    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    // Simulate session completion
    latestMockSession._emit('session.idle');
    await flushPromises();

    const fetched = tm.getTask(task.id);
    if (!fetched) throw new Error('Expected task to exist');
    expect(fetched.status.state).toBe('completed');
    expect(events.some((e) => e.status.state === 'completed')).toBe(true);
  });


  it('sendTask() transitions to failed on session error', async () => {
    const events: TaskStatusUpdateEvent[] = [];
    tm.on('task:status-update', (e) => events.push(e));

    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    latestMockSession._emit('session.error', { data: { message: 'boom' } });
    await flushPromises();

    const fetched = tm.getTask(task.id);
    if (!fetched) throw new Error('Expected task to exist');
    expect(fetched.status.state).toBe('failed');
    expect(events.some((e) => e.status.state === 'failed')).toBe(true);
  });


  it('sendTask() returns task immediately (state is submitted, not completed)', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    expect(task.status.state).toBe('submitted');
  });


  it('sendTask() creates artifact from agent response', async () => {
    const artifactEvents: TaskArtifactUpdateEvent[] = [];
    tm.on('task:artifact-update', (e) => artifactEvents.push(e));

    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    // Simulate assistant response then idle
    latestMockSession._emit('assistant.message', { data: { content: 'I did it' } });
    latestMockSession._emit('session.idle');
    await flushPromises();

    const fetched = tm.getTask(task.id);
    if (!fetched) throw new Error('Expected task to exist');
    if (!fetched.artifacts) throw new Error('Expected artifacts');
    expect(fetched.artifacts).toBeDefined();
    expect(fetched.artifacts.length).toBeGreaterThan(0);
    expect(fetched.artifacts[0].parts[0].text).toBe('I did it');
    expect(artifactEvents.length).toBeGreaterThan(0);
  });


  it('sendTask() accumulates history messages', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    latestMockSession._emit('assistant.message', { data: { content: 'reply 1' } });
    latestMockSession._emit('assistant.message', { data: { content: 'reply 2' } });
    latestMockSession._emit('session.idle');
    await flushPromises();

    const fetched = tm.getTask(task.id);
    if (!fetched) throw new Error('Expected task to exist');
    if (!fetched.history) throw new Error('Expected history');
    // Should have at least the original user message + assistant replies
    expect(fetched.history.length).toBeGreaterThanOrEqual(3);
  });


  it('sendTask() uses provided contextId (does not overwrite)', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello', { contextId: 'ctx-custom' }));
    expect(task.contextId).toBe('ctx-custom');
  });


  it('sendTask() generates contextId when not provided', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    expect(task.contextId).toMatch(/^ctx-/);
  });


  it('sendTask() passes referenceTaskIds from message', async () => {
    const task = await tm.sendTask(
      makeRequest('target-1', 'hello', { referenceTaskIds: ['task-prev-1', 'task-prev-2'] }),
    );
    // referenceTaskIds should be on the history's first message
    const fetched = tm.getTask(task.id);
    if (!fetched) throw new Error('Expected task to exist');
    const userMsg = fetched.history?.find((m) => m.role === 'user');
    expect(userMsg?.referenceTaskIds).toEqual(['task-prev-1', 'task-prev-2']);
  });


  it('getTask() returns current task state', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    const fetched = tm.getTask(task.id);
    expect(fetched).toBeDefined();
    if (!fetched) throw new Error('Expected task to exist');
    expect(fetched.id).toBe(task.id);
  });


  it('getTask() returns null for unknown taskId', () => {
    expect(tm.getTask('nonexistent')).toBeNull();
  });


  it('getTask() respects historyLength (unset=all, 0=none)', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    latestMockSession._emit('assistant.message', { data: { content: 'r1' } });
    latestMockSession._emit('assistant.message', { data: { content: 'r2' } });
    latestMockSession._emit('session.idle');
    await flushPromises();

    // unset → full history
    const full = tm.getTask(task.id);
    if (!full) throw new Error('Expected task to exist');
    if (!full.history) throw new Error('Expected history');
    expect(full.history.length).toBeGreaterThan(0);

    // 0 → empty history
    const none = tm.getTask(task.id, 0);
    if (!none) throw new Error('Expected task to exist');
    expect(none.history).toEqual([]);

    // 1 → last 1 item
    const one = tm.getTask(task.id, 1);
    if (!one) throw new Error('Expected task to exist');
    if (!one.history) throw new Error('Expected history');
    expect(one.history.length).toBe(1);
  });


  it('listTasks() returns ListTasksResponse with totalSize', async () => {
    await tm.sendTask(makeRequest('target-1', 'a'));
    await tm.sendTask(makeRequest('target-1', 'b'));

    const res = tm.listTasks();
    expect(res.tasks.length).toBe(2);
    expect(res.totalSize).toBe(2);
    expect(res.pageSize).toBe(2);
    expect(res.nextPageToken).toBe('');
  });


  it('listTasks() filters by contextId', async () => {
    await tm.sendTask(makeRequest('target-1', 'a', { contextId: 'ctx-A' }));
    await tm.sendTask(makeRequest('target-1', 'b', { contextId: 'ctx-B' }));

    const res = tm.listTasks({ contextId: 'ctx-A' });
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].contextId).toBe('ctx-A');
  });


  it('listTasks() filters by state', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'a'));
    await flushPromises();

    latestMockSession._emit('session.idle');
    await flushPromises();

    await tm.sendTask(makeRequest('target-1', 'b'));

    // task a should be completed, task b submitted/working
    const completed = tm.listTasks({ status: 'completed' as TaskState });
    expect(completed.tasks.length).toBe(1);
    expect(completed.tasks[0].id).toBe(task.id);
  });


  it('cancelTask() sets state to canceled', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    const canceled = tm.cancelTask(task.id);
    expect(canceled.status.state).toBe('canceled');
  });


  it('cancelTask() on terminal task throws', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    latestMockSession._emit('session.idle');
    await flushPromises();

    const taskBeforeCancel = tm.getTask(task.id);
    if (!taskBeforeCancel) throw new Error('Expected task to exist');
    expect(taskBeforeCancel.status.state).toBe('completed');
    expect(() => tm.cancelTask(task.id)).toThrow();
  });

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------

  it('completed tasks within MAX_COMPLETED_TASKS are retained', async () => {
    // Create 3 tasks and complete them — all should remain (well under limit of 100)
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const task = await tm.sendTask(makeRequest('target-1', `msg-${i}`));
      ids.push(task.id);
      await flushPromises();
      latestMockSession._emit('session.idle');
      await flushPromises();
    }

    for (const id of ids) {
      const t = tm.getTask(id);
      expect(t).not.toBeNull();
      if (!t) throw new Error('Expected task to exist');
      expect(t.status.state).toBe('completed');
    }

    // Verify limit is documented
    expect(TaskManager.MAX_COMPLETED_TASKS).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // Issue fixes
  // ---------------------------------------------------------------------------


  it('after cancelTask, buffered assistant.message events do not mutate history', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    // Cancel the task
    tm.cancelTask(task.id);
    const afterCancel = tm.getTask(task.id);
    if (!afterCancel) throw new Error('Expected task to exist');
    if (!afterCancel.history) throw new Error('Expected history');
    const historyLenAfterCancel = afterCancel.history.length;

    // Fire a buffered assistant.message after cancellation
    latestMockSession._emit('assistant.message', { data: { content: 'late message' } });
    await flushPromises();

    const afterBuffered = tm.getTask(task.id);
    if (!afterBuffered) throw new Error('Expected task to exist');
    if (!afterBuffered.history) throw new Error('Expected history');
    expect(afterBuffered.history.length).toBe(historyLenAfterCancel);
  });


  it('multiple assistant.message events accumulate in artifact text', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    latestMockSession._emit('assistant.message', { data: { content: 'first part' } });
    latestMockSession._emit('assistant.message', { data: { content: 'second part' } });
    latestMockSession._emit('session.idle');
    await flushPromises();

    const fetched = tm.getTask(task.id);
    if (!fetched) throw new Error('Expected task to exist');
    if (!fetched.artifacts) throw new Error('Expected artifacts');
    const artifactText = fetched.artifacts[0].parts[0].text;
    expect(artifactText).toContain('first part');
    expect(artifactText).toContain('second part');
  });

  // ---------------------------------------------------------------------------
  // input-required flow
  // ---------------------------------------------------------------------------

  describe('input-required flow', () => {
    let capturedOnUserInputRequest: ((prompt: string) => Promise<{ answer: string; wasFreeform: boolean }>) | undefined;

    beforeEach(() => {
      capturedOnUserInputRequest = undefined;
      // Override mock to capture the onUserInputRequest callback
      mockMindManager.createTaskSession.mockImplementation((async (...args: unknown[]) => {
        capturedOnUserInputRequest = args[2] as typeof capturedOnUserInputRequest;
        latestMockSession = createMockSession();
        return latestMockSession;
      }) as typeof mockMindManager.createTaskSession);
    });


    it('onUserInputRequest callback sets task to input-required', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Trigger the input-required callback (simulates agent calling ask_user)
      expect(capturedOnUserInputRequest).toBeDefined();
      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      capturedOnUserInputRequest('What is your name?');
      await flushPromises();

      const fetched = tm.getTask(task.id);
      if (!fetched) throw new Error('Expected task to exist');
      expect(fetched.status.state).toBe('input-required');
    });


    it('input-required emits task:status-update', async () => {
      const events: TaskStatusUpdateEvent[] = [];
      tm.on('task:status-update', (e) => events.push(e));

      await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      capturedOnUserInputRequest('Need info');
      await flushPromises();

      const inputRequiredEvent = events.find((e) => e.status.state === 'input-required');
      expect(inputRequiredEvent).toBeDefined();
      expect(inputRequiredEvent.status.message).toBeDefined();
      expect(inputRequiredEvent.status.message.parts[0].text).toBe('Need info');
    });


    it('resumeTask sends answer to session callback', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Trigger input-required and capture the promise
      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      const inputPromise = capturedOnUserInputRequest('Pick a color');
      await flushPromises();

      // Resume with user answer
      const answerMessage: Message = {
        messageId: 'msg-answer-1',
        role: 'user',
        parts: [{ text: 'Blue', mediaType: 'text/plain' }],
      };
      tm.resumeTask(task.id, answerMessage);

      // The onUserInputRequest promise should resolve with the answer
      const result = await inputPromise;
      expect(result.answer).toBe('Blue');
      expect(result.wasFreeform).toBe(true);
    });


    it('resumeTask transitions back to working', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      capturedOnUserInputRequest('Confirm?');
      await flushPromises();

      const answerMessage: Message = {
        messageId: 'msg-answer-2',
        role: 'user',
        parts: [{ text: 'Yes', mediaType: 'text/plain' }],
      };
      tm.resumeTask(task.id, answerMessage);

      const fetched = tm.getTask(task.id);
      if (!fetched) throw new Error('Expected task to exist');
      expect(fetched.status.state).toBe('working');
    });


    it('resumeTask on non-input-required task throws', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();
      // Task is in 'working' state, not 'input-required'

      const answerMessage: Message = {
        messageId: 'msg-answer-3',
        role: 'user',
        parts: [{ text: 'answer', mediaType: 'text/plain' }],
      };
      expect(() => tm.resumeTask(task.id, answerMessage)).toThrow(/not in input-required state/);
    });


    it('resumeTask on unknown task throws', () => {
      const answerMessage: Message = {
        messageId: 'msg-answer-4',
        role: 'user',
        parts: [{ text: 'answer', mediaType: 'text/plain' }],
      };
      expect(() => tm.resumeTask('nonexistent-task', answerMessage)).toThrow(/not found/);
    });

    // 27 (resumeTask snapshot)
    it('resumeTask returns a distinct snapshot', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      capturedOnUserInputRequest('Pick a color');
      await flushPromises();

      const answerMessage: Message = {
        messageId: 'msg-snap-1',
        role: 'user',
        parts: [{ text: 'Blue', mediaType: 'text/plain' }],
      };
      const returned = tm.resumeTask(task.id, answerMessage);
      const internal = tm.getTask(task.id);
      if (!internal) throw new Error('Expected task to exist');

      // Must be distinct objects
      expect(returned).not.toBe(internal);
      expect(returned.status).not.toBe(internal.status);
      expect(returned.history).not.toBe(internal.history);
      expect(returned.artifacts).not.toBe(internal.artifacts);

      // Mutating returned must not affect internal
      (returned.status as { state: string }).state = 'failed';
      const afterMutation = tm.getTask(task.id);
      if (!afterMutation) throw new Error('Expected task to exist');
      expect(afterMutation.status.state).toBe('working');
    });


    it('full flow: send → working → input-required → resume → completed', async () => {
      const events: TaskStatusUpdateEvent[] = [];
      tm.on('task:status-update', (e) => events.push(e));

      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Should be working now
      expect(events.some((e) => e.status.state === 'working')).toBe(true);

      // Agent asks for input
      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      const inputPromise = capturedOnUserInputRequest('What color?');
      await flushPromises();

      const taskAfterInput = tm.getTask(task.id);
      if (!taskAfterInput) throw new Error('Expected task to exist');
      expect(taskAfterInput.status.state).toBe('input-required');
      expect(events.some((e) => e.status.state === 'input-required')).toBe(true);

      // User provides answer
      const answerMessage: Message = {
        messageId: 'msg-answer-5',
        role: 'user',
        parts: [{ text: 'Red', mediaType: 'text/plain' }],
      };
      tm.resumeTask(task.id, answerMessage);

      // Verify answer resolves correctly
      const result = await inputPromise;
      expect(result.answer).toBe('Red');

      // Task should be back to working
      const taskAfterResume = tm.getTask(task.id);
      if (!taskAfterResume) throw new Error('Expected task to exist');
      expect(taskAfterResume.status.state).toBe('working');

      // Agent completes
      latestMockSession._emit('assistant.message', { data: { content: 'Done with Red' } });
      latestMockSession._emit('session.idle');
      await flushPromises();

      const taskAfterComplete = tm.getTask(task.id);
      if (!taskAfterComplete) throw new Error('Expected task to exist');
      expect(taskAfterComplete.status.state).toBe('completed');

      // Verify full state progression
      const states = events.map((e) => e.status.state);
      expect(states).toContain('submitted');
      expect(states).toContain('working');
      expect(states).toContain('input-required');
      expect(states).toContain('completed');
    });
  });

  // ---------------------------------------------------------------------------
  // Stale session retry
  // ---------------------------------------------------------------------------

  describe('stale session retry', () => {
    it('creates fresh session and completes task on stale-send retry', async () => {
      const events: TaskStatusUpdateEvent[] = [];
      tm.on('task:status-update', (e) => events.push(e));

      // First session: send rejects with stale error
      const staleSession = createMockSession();
      staleSession.send.mockRejectedValueOnce(new Error('Session not found: abc-123'));
      mockMindManager.createTaskSession.mockResolvedValueOnce(staleSession);

      // Second session: succeeds
      const freshSession = createMockSession();
      mockMindManager.createTaskSession.mockResolvedValueOnce(freshSession);

      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Simulate success on fresh session
      freshSession._emit('assistant.message', { data: { content: 'Done' } });
      freshSession._emit('session.idle');
      await flushPromises();

      expect(mockMindManager.createTaskSession).toHaveBeenCalledTimes(2);
      const completedTask = tm.getTask(task.id);
      if (!completedTask) throw new Error('Expected task to exist');
      if (!completedTask.artifacts) throw new Error('Expected artifacts');
      expect(completedTask.status.state).toBe('completed');
      expect(completedTask.artifacts[0].parts[0].text).toBe('Done');
    });

    it('rebinds listeners — fresh session events drive task to completion', async () => {
      const artifactEvents: TaskArtifactUpdateEvent[] = [];
      tm.on('task:artifact-update', (e) => artifactEvents.push(e));

      // First session: stale
      const staleSession = createMockSession();
      staleSession.send.mockRejectedValueOnce(new Error('Session not found: abc'));
      mockMindManager.createTaskSession.mockResolvedValueOnce(staleSession);

      // Second session: succeeds
      const freshSession = createMockSession();
      mockMindManager.createTaskSession.mockResolvedValueOnce(freshSession);

      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Fresh session completes the task
      freshSession._emit('assistant.message', { data: { content: 'real response' } });
      freshSession._emit('session.idle');
      await flushPromises();

      const fetched = tm.getTask(task.id);
      if (!fetched) throw new Error('Expected task to exist');
      expect(fetched.status.state).toBe('completed');
      if (!fetched.artifacts) throw new Error('Expected artifacts');
      expect(fetched.artifacts.length).toBeGreaterThan(0);
      expect(fetched.artifacts[0].parts[0].text).toContain('real response');
      expect(artifactEvents.length).toBeGreaterThan(0);
    });

    it('does not loop — fails task when retry also throws stale error', async () => {
      const events: TaskStatusUpdateEvent[] = [];
      tm.on('task:status-update', (e) => events.push(e));

      // Both sessions throw stale error
      const staleSession1 = createMockSession();
      staleSession1.send.mockRejectedValueOnce(new Error('Session not found: abc'));
      mockMindManager.createTaskSession.mockResolvedValueOnce(staleSession1);

      const staleSession2 = createMockSession();
      staleSession2.send.mockRejectedValueOnce(new Error('Session not found: def'));
      mockMindManager.createTaskSession.mockResolvedValueOnce(staleSession2);

      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // processTask's .catch() transitions to failed
      const failedTask1 = tm.getTask(task.id);
      if (!failedTask1) throw new Error('Expected task to exist');
      expect(failedTask1.status.state).toBe('failed');
      expect(mockMindManager.createTaskSession).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-stale errors', async () => {
      const staleSession = createMockSession();
      staleSession.send.mockRejectedValueOnce(new Error('Network error'));
      mockMindManager.createTaskSession.mockResolvedValueOnce(staleSession);

      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // processTask's .catch() transitions to failed, no retry
      const failedTask2 = tm.getTask(task.id);
      if (!failedTask2) throw new Error('Expected task to exist');
      expect(failedTask2.status.state).toBe('failed');
      expect(mockMindManager.createTaskSession).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 1: targetMindId in events
  // ---------------------------------------------------------------------------

  describe('targetMindId in events', () => {
    it('emitted task:status-update includes targetMindId', async () => {
      const events: Array<TaskStatusUpdateEvent & { targetMindId?: string }> = [];
      tm.on('task:status-update', (e) => events.push(e as TaskStatusUpdateEvent & { targetMindId?: string }));

      await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Every status event should carry targetMindId
      for (const e of events) {
        expect(e.targetMindId).toBe('target-1');
      }
    });

    it('emitted task:artifact-update includes targetMindId', async () => {
      const artifactEvents: Array<TaskArtifactUpdateEvent & { targetMindId?: string }> = [];
      tm.on('task:artifact-update', (e) => artifactEvents.push(e as TaskArtifactUpdateEvent & { targetMindId?: string }));

      await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      latestMockSession._emit('assistant.message', { data: { content: 'result' } });
      latestMockSession._emit('session.idle');
      await flushPromises();

      expect(artifactEvents.length).toBeGreaterThan(0);
      for (const e of artifactEvents) {
        expect(e.targetMindId).toBe('target-1');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 2: snapshot isolation
  // ---------------------------------------------------------------------------

  describe('snapshot isolation', () => {
    it('getTask() returns a distinct object — mutating it does not affect internal state', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      const fetched = tm.getTask(task.id);
      if (!fetched) throw new Error('Expected task to exist');
      // Mutate the returned object
      (fetched.status as { state: string }).state = 'failed';
      if (!fetched.history) throw new Error('Expected history');
      (fetched.history as unknown[]).push({ messageId: 'rogue', role: 'user', parts: [] });
      if (!fetched.artifacts) throw new Error('Expected artifacts');
      (fetched.artifacts as unknown[]).push({ artifactId: 'rogue' });

      // Internal state must be unchanged
      const internal = tm.getTask(task.id);
      if (!internal) throw new Error('Expected task to exist');
      expect(internal.status.state).not.toBe('failed');
      if (!internal.history) throw new Error('Expected history');
      expect(internal.history.find((m: Message) => m.messageId === 'rogue')).toBeUndefined();
      if (!internal.artifacts) throw new Error('Expected artifacts');
      expect(internal.artifacts.find((a: Artifact) => a.artifactId === 'rogue')).toBeUndefined();
    });

    it('listTasks() tasks are distinct from internal state', async () => {
      await tm.sendTask(makeRequest('target-1', 'hello'));

      const listed = tm.listTasks().tasks[0];
      (listed.status as { state: string }).state = 'failed';
      if (!listed.artifacts) throw new Error('Expected artifacts');
      (listed.artifacts as unknown[]).push({ artifactId: 'rogue' });

      const internal = tm.listTasks().tasks[0];
      expect(internal.status.state).not.toBe('failed');
      if (!internal.artifacts) throw new Error('Expected artifacts');
      expect(internal.artifacts.find((a: Artifact) => a.artifactId === 'rogue')).toBeUndefined();
    });

    it('cancelTask() returns a distinct snapshot', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      const canceled = tm.cancelTask(task.id);

      (canceled.status as { state: string }).state = 'completed';
      if (!canceled.artifacts) throw new Error('Expected artifacts');
      (canceled.artifacts as unknown[]).push({ artifactId: 'rogue' });

      const internal = tm.getTask(task.id);
      if (!internal) throw new Error('Expected task to exist');
      expect(internal.status.state).toBe('canceled');
      if (!internal.artifacts) throw new Error('Expected artifacts');
      expect(internal.artifacts.find((a: Artifact) => a.artifactId === 'rogue')).toBeUndefined();
    });
  });
});
