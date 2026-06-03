import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqliteStore } from '@ianphil/ttasks-ts';
import { TaskManager } from './TaskManager';
import type { TaskSessionFactory } from './TaskManager';
import type { UserInputHandler } from '../mind/types';
import type { AgentCard, SendMessageRequest, TaskState, Message, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, Artifact } from './types';
import type { AgentCardRegistry } from './AgentCardRegistry';
import { InMemoryLedgerStore, TaskLedger } from '../ledger';

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
    supportedInterfaces: [{ url: `chamber:mind:${encodeURIComponent(overrides.mindId)}`, protocolBinding: 'https://github.com/ianphil/chamber/a2a/bindings/in-process/v1', protocolVersion: '1.0' }],
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
      role: 'ROLE_USER',
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
    expect(task.status.state).toBe('TASK_STATE_SUBMITTED');
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

    const workingEvent = events.find((e) => e.status.state === 'TASK_STATE_WORKING');
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
    expect(fetched.status.state).toBe('TASK_STATE_COMPLETED');
    expect(events.some((e) => e.status.state === 'TASK_STATE_COMPLETED')).toBe(true);
  });

  it('sendTask() emits submitted → working → completed and stores the terminal task state', async () => {
    const events: TaskStatusUpdateEvent[] = [];
    tm.on('task:status-update', (e) => events.push(e));

    const submitted = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    latestMockSession._emit('session.idle');
    await flushPromises();

    const terminal = tm.getTask(submitted.id);
    if (!terminal) throw new Error('Expected task to exist');
    expect(submitted.status.state).toBe('TASK_STATE_SUBMITTED');
    expect(events.map((event) => event.status.state)).toEqual([
      'TASK_STATE_SUBMITTED',
      'TASK_STATE_WORKING',
      'TASK_STATE_COMPLETED',
    ]);
    expect(terminal.status.state).toBe('TASK_STATE_COMPLETED');
  });

  it('sendTask() writes an audit-only ledger row and finalizes it on completion', async () => {
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-1',
      now: () => '2026-05-21T21:45:00.000Z',
    });
    tm = new TaskManager(
      mockMindManager as unknown as TaskSessionFactory,
      mockRegistry as unknown as AgentCardRegistry,
      { ledger },
    );

    const submitted = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();
    latestMockSession._emit('session.idle');
    await flushPromises();

    expect(ledger.reader.getByLedgerId('ledger-1')).toMatchObject({
      runtime: 'a2a',
      ownerMindId: 'target-1',
      status: 'succeeded',
      a2aTaskId: submitted.id,
      contextId: submitted.contextId,
      payload: { runtime: 'a2a', a2aTaskId: submitted.id, contextId: submitted.contextId },
    });
  });

  it('sendTask() persists a chamber:a2a ttasks row when a store is configured', async () => {
    const store = new SqliteStore({ path: ':memory:' });
    tm = new TaskManager(
      mockMindManager as unknown as TaskSessionFactory,
      mockRegistry as unknown as AgentCardRegistry,
      { ttasksStore: store },
    );

    const task = await tm.sendTask(makeRequest('target-1', 'hello'));

    const persisted = store.tasks.get(task.id);
    expect(persisted).toBeDefined();
    expect(persisted?.type).toBe('chamber:a2a');
    expect(JSON.parse(persisted?.payload ?? '{}')).toMatchObject({
      recipient: 'target-1',
      message: 'hello',
      contextId: task.contextId,
    });
    expect(persisted?.metadata).toMatchObject({ runtime: 'a2a', ownerMindId: 'target-1', a2aTaskId: task.id });
  });

  it('sendTask() tolerates ttasks persistence failures', async () => {
   const badStore = {
     tasks: {
       save: vi.fn(() => {
         throw new Error('db unavailable');
       }),
     },
   };
   tm = new TaskManager(
     mockMindManager as unknown as TaskSessionFactory,
     mockRegistry as unknown as AgentCardRegistry,
     { ttasksStore: badStore as never },
   );

   const task = await tm.sendTask(makeRequest('target-1', 'hello'));
   await flushPromises();

   latestMockSession._emit('session.idle');
   await flushPromises();

   expect(tm.getTask(task.id)?.status.state).toBe('TASK_STATE_COMPLETED');
  });

   it('sendTask() skips audit ledger writes when suppressLedgerWrite is set', async () => {
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-1',
      now: () => '2026-05-21T21:45:00.000Z',
    });
    tm = new TaskManager(
      mockMindManager as unknown as TaskSessionFactory,
      mockRegistry as unknown as AgentCardRegistry,
      { ledger },
    );

    await tm.sendTask({
      ...makeRequest('target-1', 'hello'),
      suppressLedgerWrite: true,
    });

    expect(ledger.reader.getByLedgerId('ledger-1')).toBeUndefined();
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
    expect(fetched.status.state).toBe('TASK_STATE_FAILED');
    expect(events.some((e) => e.status.state === 'TASK_STATE_FAILED')).toBe(true);
  });


  it('sendTask() returns task immediately (state is submitted, not completed)', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    expect(task.status.state).toBe('TASK_STATE_SUBMITTED');
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
    const userMsg = fetched.history?.find((m) => m.role === 'ROLE_USER');
    expect(userMsg?.referenceTaskIds).toEqual(['task-prev-1', 'task-prev-2']);
  });


  it('sendTask() passes custom onUserInputRequest through to createTaskSession', async () => {
    const customHandler: UserInputHandler = async () => ({
      answer: 'Not now',
      wasFreeform: true,
    });

    await tm.sendTask({
      ...makeRequest('target-1', 'hello'),
      onUserInputRequest: customHandler,
    });
    await flushPromises();

    expect(mockMindManager.createTaskSession).toHaveBeenCalledWith(
      'target-1',
      expect.stringMatching(/^task-/),
      customHandler,
    );
  });

  it('sendTask() injects current datetime context into the task prompt', async () => {
    await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    const sentPrompt = latestMockSession.send.mock.calls[0]?.[0]?.prompt;
    expect(sentPrompt).toEqual(expect.stringContaining('<current_datetime>'));
    expect(sentPrompt).toEqual(expect.stringContaining('<timezone>'));
    expect(sentPrompt).toEqual(expect.stringContaining('hello'));
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
    const completed = tm.listTasks({ status: 'TASK_STATE_COMPLETED' as TaskState });
    expect(completed.tasks.length).toBe(1);
    expect(completed.tasks[0].id).toBe(task.id);
  });


  it('cancelTask() sets state to canceled', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    const canceled = tm.cancelTask(task.id);
    expect(canceled.status.state).toBe('TASK_STATE_CANCELED');
  });

  it('cancelTask() aborts the active session before cleanup', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    tm.cancelTask(task.id);

    expect(latestMockSession.abort).toHaveBeenCalledOnce();
  });


  it('cancelTask() on terminal task throws', async () => {
    const task = await tm.sendTask(makeRequest('target-1', 'hello'));
    await flushPromises();

    latestMockSession._emit('session.idle');
    await flushPromises();

    const taskBeforeCancel = tm.getTask(task.id);
    if (!taskBeforeCancel) throw new Error('Expected task to exist');
    expect(taskBeforeCancel.status.state).toBe('TASK_STATE_COMPLETED');
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
      expect(t.status.state).toBe('TASK_STATE_COMPLETED');
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
    let capturedOnUserInputRequest: UserInputHandler | undefined;

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
      capturedOnUserInputRequest({ question: 'What is your name?' }, { sessionId: 'sess-1' });
      await flushPromises();

      const fetched = tm.getTask(task.id);
      if (!fetched) throw new Error('Expected task to exist');
      expect(fetched.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
    });


    it('input-required emits task:status-update', async () => {
      const events: TaskStatusUpdateEvent[] = [];
      tm.on('task:status-update', (e) => events.push(e));

      await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      capturedOnUserInputRequest({ question: 'Need info' }, { sessionId: 'sess-1' });
      await flushPromises();

      const inputRequiredEvent = events.find((e) => e.status.state === 'TASK_STATE_INPUT_REQUIRED');
      expect(inputRequiredEvent).toBeDefined();
      expect(inputRequiredEvent!.status.message).toBeDefined();
      expect(inputRequiredEvent!.status.message!.parts[0].text).toBe('Need info');
    });


    it('cancelTask clears pending input state for input-required tasks', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      capturedOnUserInputRequest({ question: 'Pick a color' }, { sessionId: 'sess-1' });
      await flushPromises();

      const internals = tm as unknown as {
        pendingInputs: Map<string, (answer: { answer: string; wasFreeform: boolean }) => void>;
        taskTargets: Map<string, string>;
      };
      expect(internals.pendingInputs.has(task.id)).toBe(true);

      tm.cancelTask(task.id);

      expect(internals.pendingInputs.has(task.id)).toBe(false);
      expect(internals.taskTargets.has(task.id)).toBe(false);
      expect(tm.getTask(task.id)?.status.state).toBe('TASK_STATE_CANCELED');
    });

    it('resumeTask sends answer to session callback', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Trigger input-required and capture the promise
      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      const inputPromise = capturedOnUserInputRequest({ question: 'Pick a color' }, { sessionId: 'sess-1' });
      await flushPromises();

      // Resume with user answer
      const answerMessage: Message = {
        messageId: 'msg-answer-1',
        role: 'ROLE_USER',
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
      capturedOnUserInputRequest({ question: 'Confirm?' }, { sessionId: 'sess-1' });
      await flushPromises();

      const answerMessage: Message = {
        messageId: 'msg-answer-2',
        role: 'ROLE_USER',
        parts: [{ text: 'Yes', mediaType: 'text/plain' }],
      };
      tm.resumeTask(task.id, answerMessage);

      const fetched = tm.getTask(task.id);
      if (!fetched) throw new Error('Expected task to exist');
      expect(fetched.status.state).toBe('TASK_STATE_WORKING');
    });


    it('resumeTask on non-input-required task throws', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();
      // Task is in 'TASK_STATE_WORKING' state, not 'TASK_STATE_INPUT_REQUIRED'

      const answerMessage: Message = {
        messageId: 'msg-answer-3',
        role: 'ROLE_USER',
        parts: [{ text: 'answer', mediaType: 'text/plain' }],
      };
      expect(() => tm.resumeTask(task.id, answerMessage)).toThrow(/not in input-required state/);
    });


    it('resumeTask on unknown task throws', () => {
      const answerMessage: Message = {
        messageId: 'msg-answer-4',
        role: 'ROLE_USER',
        parts: [{ text: 'answer', mediaType: 'text/plain' }],
      };
      expect(() => tm.resumeTask('nonexistent-task', answerMessage)).toThrow(/not found/);
    });

    // 27 (resumeTask snapshot)
    it('resumeTask returns a distinct snapshot', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      capturedOnUserInputRequest({ question: 'Pick a color' }, { sessionId: 'sess-1' });
      await flushPromises();

      const answerMessage: Message = {
        messageId: 'msg-snap-1',
        role: 'ROLE_USER',
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
      (returned.status as { state: string }).state = 'TASK_STATE_FAILED';
      const afterMutation = tm.getTask(task.id);
      if (!afterMutation) throw new Error('Expected task to exist');
      expect(afterMutation.status.state).toBe('TASK_STATE_WORKING');
    });


    it('full flow: send → working → input-required → resume → completed', async () => {
      const events: TaskStatusUpdateEvent[] = [];
      tm.on('task:status-update', (e) => events.push(e));

      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      // Should be working now
      expect(events.some((e) => e.status.state === 'TASK_STATE_WORKING')).toBe(true);

      // Agent asks for input
      if (!capturedOnUserInputRequest) throw new Error('Expected callback');
      const inputPromise = capturedOnUserInputRequest({ question: 'What color?' }, { sessionId: 'sess-1' });
      await flushPromises();

      const taskAfterInput = tm.getTask(task.id);
      if (!taskAfterInput) throw new Error('Expected task to exist');
      expect(taskAfterInput.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
      expect(events.some((e) => e.status.state === 'TASK_STATE_INPUT_REQUIRED')).toBe(true);

      // User provides answer
      const answerMessage: Message = {
        messageId: 'msg-answer-5',
        role: 'ROLE_USER',
        parts: [{ text: 'Red', mediaType: 'text/plain' }],
      };
      tm.resumeTask(task.id, answerMessage);

      // Verify answer resolves correctly
      const result = await inputPromise;
      expect(result.answer).toBe('Red');

      // Task should be back to working
      const taskAfterResume = tm.getTask(task.id);
      if (!taskAfterResume) throw new Error('Expected task to exist');
      expect(taskAfterResume.status.state).toBe('TASK_STATE_WORKING');

      // Agent completes
      latestMockSession._emit('assistant.message', { data: { content: 'Done with Red' } });
      latestMockSession._emit('session.idle');
      await flushPromises();

      const taskAfterComplete = tm.getTask(task.id);
      if (!taskAfterComplete) throw new Error('Expected task to exist');
      expect(taskAfterComplete.status.state).toBe('TASK_STATE_COMPLETED');

      // Verify full state progression
      const states = events.map((e) => e.status.state);
      expect(states).toContain('TASK_STATE_SUBMITTED');
      expect(states).toContain('TASK_STATE_WORKING');
      expect(states).toContain('TASK_STATE_INPUT_REQUIRED');
      expect(states).toContain('TASK_STATE_COMPLETED');
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
      expect(completedTask.status.state).toBe('TASK_STATE_COMPLETED');
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
      expect(fetched.status.state).toBe('TASK_STATE_COMPLETED');
      if (!fetched.artifacts) throw new Error('Expected artifacts');
      expect(fetched.artifacts.length).toBeGreaterThan(0);
      expect(fetched.artifacts[0].parts[0].text).toContain('real response');
      expect(artifactEvents.length).toBeGreaterThan(0);
    });

    it('does not let stale session.error make a task terminal before send retry completes', async () => {
      const staleSession = createMockSession();
      staleSession.send.mockImplementationOnce(async () => {
        staleSession._emit('session.error', { data: { message: 'Session not found: abc' } });
        throw new Error('Session not found: abc');
      });
      mockMindManager.createTaskSession.mockResolvedValueOnce(staleSession);

      const freshSession = createMockSession();
      mockMindManager.createTaskSession.mockResolvedValueOnce(freshSession);

      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      await flushPromises();

      freshSession._emit('assistant.message', { data: { content: 'Recovered' } });
      freshSession._emit('session.idle');
      await flushPromises();

      const completedTask = tm.getTask(task.id);
      if (!completedTask) throw new Error('Expected task to exist');
      expect(completedTask.status.state).toBe('TASK_STATE_COMPLETED');
      expect(completedTask.artifacts?.[0].parts[0].text).toBe('Recovered');
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
      expect(failedTask1.status.state).toBe('TASK_STATE_FAILED');
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
      expect(failedTask2.status.state).toBe('TASK_STATE_FAILED');
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
      (fetched.status as { state: string }).state = 'TASK_STATE_FAILED';
      if (!fetched.history) throw new Error('Expected history');
      (fetched.history as unknown[]).push({ messageId: 'rogue', role: 'ROLE_USER', parts: [] });
      if (!fetched.artifacts) throw new Error('Expected artifacts');
      (fetched.artifacts as unknown[]).push({ artifactId: 'rogue' });

      // Internal state must be unchanged
      const internal = tm.getTask(task.id);
      if (!internal) throw new Error('Expected task to exist');
      expect(internal.status.state).not.toBe('TASK_STATE_FAILED');
      if (!internal.history) throw new Error('Expected history');
      expect(internal.history.find((m: Message) => m.messageId === 'rogue')).toBeUndefined();
      if (!internal.artifacts) throw new Error('Expected artifacts');
      expect(internal.artifacts.find((a: Artifact) => a.artifactId === 'rogue')).toBeUndefined();
    });

    it('listTasks() tasks are distinct from internal state', async () => {
      await tm.sendTask(makeRequest('target-1', 'hello'));

      const listed = tm.listTasks().tasks[0];
      (listed.status as { state: string }).state = 'TASK_STATE_FAILED';
      if (!listed.artifacts) throw new Error('Expected artifacts');
      (listed.artifacts as unknown[]).push({ artifactId: 'rogue' });

      const internal = tm.listTasks().tasks[0];
      expect(internal.status.state).not.toBe('TASK_STATE_FAILED');
      if (!internal.artifacts) throw new Error('Expected artifacts');
      expect(internal.artifacts.find((a: Artifact) => a.artifactId === 'rogue')).toBeUndefined();
    });

    it('cancelTask() returns a distinct snapshot', async () => {
      const task = await tm.sendTask(makeRequest('target-1', 'hello'));
      const canceled = tm.cancelTask(task.id);

      (canceled.status as { state: string }).state = 'TASK_STATE_COMPLETED';
      if (!canceled.artifacts) throw new Error('Expected artifacts');
      (canceled.artifacts as unknown[]).push({ artifactId: 'rogue' });

      const internal = tm.getTask(task.id);
      if (!internal) throw new Error('Expected task to exist');
      expect(internal.status.state).toBe('TASK_STATE_CANCELED');
      if (!internal.artifacts) throw new Error('Expected artifacts');
      expect(internal.artifacts.find((a: Artifact) => a.artifactId === 'rogue')).toBeUndefined();
    });
  });
});
