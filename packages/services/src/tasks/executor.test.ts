import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
  Task,
  TaskCancelled,
  TaskContext,
  TaskEvent,
  TaskEventType,
  TaskExecutionError,
  TaskExecutor,
  TaskResult,
  TaskStatus,
  TaskTimeoutError,
  TaskType,
  makeCopilotAgentHandler,
  makeCopilotPromptHandler,
  makeDefaultExecutor,
  setCopilotSessionFactory,
} from './index';

function bash(title = 'Example', payload = ''): Task {
  return new Task({ title, payload, type: TaskType.Bash });
}

function assertResultTiming(result: TaskResult, before: Date, after: Date): void {
  expect(result.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  expect(result.finishedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  expect(result.finishedAt.getTime()).toBeGreaterThanOrEqual(result.startedAt.getTime());
  expect(result.duration).toBeGreaterThanOrEqual(0);
}

function installFakeCopilot(options: { content?: string | null; error?: Error | null } = {}): Record<string, unknown> {
  const recorded: Record<string, unknown> = {};
  setCopilotSessionFactory((sessionOptions) => {
    recorded.createSession = sessionOptions;
    return {
      async sendAndWait(prompt, waitOptions) {
        recorded.prompt = prompt;
        recorded.timeout = waitOptions.timeout;
        if (options.error) throw options.error;
        if (options.content === null) return null;
        return { data: { content: options.content ?? 'response' } };
      },
    };
  });
  return recorded;
}

describe('TaskExecutor', () => {
  it('test_task_context_exposes_read_only_task_view', () => {
    const task = new Task({ title: 'Example', description: 'Demo task', payload: 'echo hi', type: TaskType.Bash, timeout: 1.5 });
    const context = new TaskContext(task);
    expect(context.id).toBe(task.id);
    expect(context.title).toBe('Example');
    expect(context.description).toBe('Demo task');
    expect(context.payload).toBe('echo hi');
    expect(context.type).toBe(TaskType.Bash);
    expect(context.timeout).toBe(1.5);
    expect(context.status).toBe(TaskStatus.Pending);
    expect(context.cancelled).toBe(false);
    expect([...context.upstream]).toEqual([]);
    context.raiseIfCancelled();
  });

  it('test_task_context_exposes_read_only_upstream_task_refs', () => {
    const parent = bash('Parent');
    const child = bash('Child');
    const context = new TaskContext(child, new Map([[parent.id, parent]]));
    expect(context.upstream.get(parent.id)).toBe(parent);
    expect(() => (context.upstream as Map<string, Task>).set('other', child)).toThrow();
  });

  it('test_register_rejects_non_task_type', () => {
    expect(() => new TaskExecutor().register('not-a-task-type' as TaskType, () => 'ok')).toThrow('task_type must be a TaskType');
  });

  it('test_register_rejects_non_callable_handler', () => {
    expect(() => new TaskExecutor().register(TaskType.Bash, 'not callable' as never)).toThrow('handler must be callable');
  });

  it('test_execute_success_emits_started_and_succeeded_events', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    const events: TaskEvent[] = [];
    executor.register(TaskType.Bash, (context) => {
      expect(context.status).toBe(TaskStatus.Running);
      return 'ok';
    });
    executor.events.subscribe((event) => events.push(event));
    await executor.execute(task);
    expect(events.map((event) => event.type)).toEqual([TaskEventType.Started, TaskEventType.Succeeded]);
    expect(events.map((event) => event.previousStatus)).toEqual([TaskStatus.Pending, TaskStatus.Running]);
    expect(events.map((event) => event.status)).toEqual([TaskStatus.Running, TaskStatus.Done]);
    expect(events.every((event) => event.task === task)).toBe(true);
  });

  it('test_execute_failure_emits_started_and_failed_events', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    const events: TaskEvent[] = [];
    executor.register(TaskType.Bash, () => { throw new Error('boom'); });
    executor.events.subscribe((event) => events.push(event));
    await expect(executor.execute(task)).rejects.toThrow('boom');
    expect(events.map((event) => event.type)).toEqual([TaskEventType.Started, TaskEventType.Failed]);
    expect(events[1].previousStatus).toBe(TaskStatus.Running);
    expect(events[1].status).toBe(TaskStatus.Failed);
    expect(events[1].error).toBe('boom');
  });

  it('test_execute_cancellation_emits_started_and_cancelled_events', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    const events: TaskEvent[] = [];
    executor.register(TaskType.Bash, () => { throw new TaskCancelled('stop'); });
    executor.events.subscribe((event) => events.push(event));
    await expect(executor.execute(task)).rejects.toThrow(TaskCancelled);
    expect(events.map((event) => event.type)).toEqual([TaskEventType.Started, TaskEventType.Cancelled]);
    expect(events[1].error).toBe('stop');
  });

  it('test_retry_after_failure_emits_started_event_from_failed_status', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    const events: TaskEvent[] = [];
    let attempts = 0;
    executor.register(TaskType.Bash, () => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
      return 'ok';
    });
    executor.events.subscribe((event) => events.push(event));
    await expect(executor.execute(task)).rejects.toThrow('boom');
    await executor.execute(task);
    expect(events.filter((event) => event.type === TaskEventType.Started).map((event) => event.previousStatus)).toEqual([TaskStatus.Pending, TaskStatus.Failed]);
  });

  it('test_execute_passes_upstream_task_refs_to_handler', async () => {
    const executor = new TaskExecutor();
    const parent = bash('Parent');
    const child = bash('Child');
    executor.register(TaskType.Bash, (context) => {
      expect(context.upstream.get(parent.id)).toBe(parent);
      return 'ok';
    });
    const result = await executor.execute(child, new Map([[parent.id, parent]]));
    expect(result.output).toBe('ok');
    expect(child.status).toBe(TaskStatus.Done);
  });

  it('test_execute_moves_task_through_running_to_done', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    executor.register(TaskType.Bash, (context) => {
      expect(context.status).toBe(TaskStatus.Running);
      return 'ok';
    });
    const result = await executor.execute(task);
    expect(result.taskId).toBe(task.id);
    expect(result.status).toBe(TaskStatus.Done);
    expect(result.output).toBe('ok');
    expect(result.raw).toBe('ok');
    expect(task.status).toBe(TaskStatus.Done);
  });

  it('test_task_result_wraps_non_string_raw_values', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    const raw = { answer: 42 };
    executor.register(TaskType.Bash, () => raw);
    const result = await executor.execute(task);
    expect(result.raw).toBe(raw);
    expect(result.output).toBe('');
  });

  it('test_execute_rejects_task_without_registered_handler', async () => {
    const task = bash();
    await expect(new TaskExecutor().execute(task)).rejects.toThrow("No handler registered for task type 'bash'");
    expect(task.status).toBe(TaskStatus.Pending);
  });

  it('test_handler_failure_marks_task_failed_and_stores_error', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    executor.register(TaskType.Bash, () => { throw new Error('boom'); });
    await expect(executor.execute(task)).rejects.toThrow('boom');
    expect(task.status).toBe(TaskStatus.Failed);
    expect(task.error).toBe('boom');
  });

  it('test_execute_rejects_cancelled_task_without_calling_handler', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    let called = false;
    executor.register(TaskType.Bash, () => { called = true; });
    task.cancel();
    await expect(executor.execute(task)).rejects.toThrow("Cannot execute task with status 'cancelled'");
    expect(called).toBe(false);
  });

  it('test_executor_clears_previous_error_on_successful_retry', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    let attempts = 0;
    executor.register(TaskType.Bash, () => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
      return 'ok';
    });
    await expect(executor.execute(task)).rejects.toThrow('boom');
    expect(task.error).toBe('boom');
    const result = await executor.execute(task);
    expect(result.output).toBe('ok');
    expect(task.error).toBeNull();
  });

  it('test_successful_execute_sets_task_result_timing', async () => {
    const executor = makeDefaultExecutor();
    const task = bash('Example', 'echo hi');
    const before = new Date();
    const result = await executor.execute(task);
    const after = new Date();
    assertResultTiming(result, before, after);
    expect(task.result).toBe(result);
  });

  it('test_default_executor_can_execute_bash', async () => {
    const executor = makeDefaultExecutor();
    const task = bash('Example', 'echo hi');
    const result = await executor.execute(task);
    expect(result.output).toBe('hi\n');
    expect(result.returncode).toBe(0);
    expect(task.status).toBe(TaskStatus.Done);
    expect(executor.isRunning(task.id)).toBe(false);
  });

  it('test_bash_task_supports_shell_syntax', async () => {
    const result = await makeDefaultExecutor().execute(bash('Shell syntax', "printf 'hello\\n' | grep hello"));
    expect(result.output).toBe('hello\n');
  });

  it('test_bash_nonzero_exit_marks_task_failed', async () => {
    const executor = makeDefaultExecutor();
    const task = bash('Failing command', 'exit 7');
    await expect(executor.execute(task)).rejects.toThrow(TaskExecutionError);
    expect(task.status).toBe(TaskStatus.Failed);
    expect(task.error).toBe('exited with code 7');
    expect(executor.isRunning(task.id)).toBe(false);
  });

  it('test_bash_failure_uses_stderr_as_error', async () => {
    const task = bash('Failing command', 'echo boom >&2; exit 1');
    await expect(makeDefaultExecutor().execute(task)).rejects.toThrow('boom');
    expect(task.error).toBe('boom\n');
  });

  it('test_failed_subprocess_result_preserves_output_error_and_returncode', async () => {
    const task = bash('Structured failure', 'echo before; echo boom >&2; exit 7');
    await expect(makeDefaultExecutor().execute(task)).rejects.toThrow('boom');
    expect(task.result?.status).toBe(TaskStatus.Failed);
    expect(task.result?.output).toBe('before\n');
    expect(task.result?.error).toBe('boom\n');
    expect(task.result?.returncode).toBe(7);
  });

  it('test_running_process_registry_is_cleaned_after_failure', async () => {
    const executor = makeDefaultExecutor();
    const task = bash('Fail', 'exit 1');
    await expect(executor.execute(task)).rejects.toThrow();
    expect(executor.isRunning(task.id)).toBe(false);
  });

  it('test_powershell_task_executes', async () => {
    const hasPwsh = await commandSucceeds('command -v pwsh');
    if (!hasPwsh) return;
    const executor = makeDefaultExecutor();
    const task = new Task({ title: 'PowerShell', payload: "'hello'", type: TaskType.PowerShell });
    const result = await executor.execute(task);
    expect(result.output).toContain('hello');
  });

  it('test_bash_task_without_timeout_waits_for_completion', async () => {
    const task = bash('No timeout', 'sleep 0.1; echo done');
    const result = await makeDefaultExecutor().execute(task);
    expect(result.output).toBe('done\n');
    expect(task.timeout).toBeNull();
  });

  it('test_bash_task_times_out', async () => {
    const task = new Task({ title: 'Slow', payload: 'sleep 30', type: TaskType.Bash, timeout: 0.1 });
    await expect(makeDefaultExecutor().execute(task)).rejects.toThrow(TaskTimeoutError);
    expect(task.status).toBe(TaskStatus.Failed);
    expect(task.error).toBe('Task timed out after 0.1 seconds');
  });

  it('test_timed_out_subprocess_result_preserves_partial_output', async () => {
    const task = new Task({ title: 'Partial timeout', payload: 'echo before; echo warn >&2; sleep 30', type: TaskType.Bash, timeout: 0.1 });
    await expect(makeDefaultExecutor().execute(task)).rejects.toThrow(TaskTimeoutError);
    expect(task.result?.output).toBe('before\n');
    expect(task.result?.error).toBe('Task timed out after 0.1 seconds');
    expect((task.result?.raw as { stderr: string }).stderr).toBe('warn\n');
  });

  it('test_handler_cancellation_after_return_raises_task_cancelled', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    executor.register(TaskType.Bash, () => { task.cancel(); return 'ignored'; });
    await expect(executor.execute(task)).rejects.toThrow(TaskCancelled);
    expect(task.status).toBe(TaskStatus.Cancelled);
  });

  it('test_handler_task_cancelled_exception_marks_task_cancelled', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    executor.register(TaskType.Bash, () => { throw new TaskCancelled('worker cancelled'); });
    await expect(executor.execute(task)).rejects.toThrow('worker cancelled');
    expect(task.result?.status).toBe(TaskStatus.Cancelled);
    expect(task.result?.error).toBe('worker cancelled');
  });

  it('test_handler_error_after_cancellation_raises_task_cancelled', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    executor.register(TaskType.Bash, () => { task.cancel(); throw new Error('worker stopped'); });
    await expect(executor.execute(task)).rejects.toThrow(TaskCancelled);
    expect(task.status).toBe(TaskStatus.Cancelled);
    expect(task.error).toBeNull();
  });

  it('test_cancel_without_running_process_only_cancels_task', () => {
    const executor = new TaskExecutor();
    const task = bash();
    executor.cancel(task);
    executor.cancel(task);
    expect(task.status).toBe(TaskStatus.Cancelled);
    expect(executor.isRunning(task.id)).toBe(false);
  });

  it('test_run_command_terminates_if_task_cancelled_during_process_start', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    task.transitionTo(TaskStatus.Running);
    task.cancel();
    await expect(executor.runCommand(new TaskContext(task), 'exit 1', { shell: true })).rejects.toThrow(TaskCancelled);
  });

  it('test_run_command_reports_cancelled_nonzero_process_as_task_cancelled', async () => {
    const executor = new TaskExecutor();
    const task = bash();
    task.transitionTo(TaskStatus.Running);
    task.cancel();
    await expect(executor.runCommand(new TaskContext(task), 'exit 1', { shell: true })).rejects.toThrow(TaskCancelled);
  });

  it('test_terminate_process_ignores_already_exited_process', () => {
    const executor = new TaskExecutor();
    expect(() => executor.terminateProcess({ exitCode: 0 } as never)).not.toThrow();
  });

  it('test_terminate_process_escalates_to_sigkill', () => {
    const executor = new TaskExecutor();
    expect(() => executor.terminateProcess({ exitCode: null, pid: undefined, kill: () => true } as never)).not.toThrow();
  });

  it('test_terminate_process_ignores_missing_group_during_sigkill', () => {
    const executor = new TaskExecutor();
    expect(() => executor.terminateProcess({ exitCode: null, pid: 9_999_999, kill: () => true } as never)).not.toThrow();
  });

  it('test_make_copilot_prompt_handler_rejects_empty_model', () => {
    expect(() => makeCopilotPromptHandler({ model: '' })).toThrow('model must not be empty');
  });

  it('test_make_copilot_prompt_handler_rejects_non_positive_timeout', () => {
    expect(() => makeCopilotPromptHandler({ timeout: 0 })).toThrow('timeout must be greater than 0');
  });

  it('test_default_prompt_handler_uses_copilot_sdk', async () => {
    const recorded = installFakeCopilot({ content: 'hello back' });
    const task = new Task({ title: 'Prompt', payload: 'hello', type: TaskType.Prompt });
    const result = await makeDefaultExecutor().execute(task);
    expect(result.output).toBe('hello back');
    expect(recorded.prompt).toBe('hello');
    expect(recorded.timeout).toBe(60);
    expect(recorded.createSession).toMatchObject({ model: 'gpt-5.4-mini', availableTools: [], toolsEnabled: false });
    setCopilotSessionFactory(null);
  });

  it('test_copilot_prompt_handler_uses_task_timeout', async () => {
    const recorded = installFakeCopilot({ content: 'done' });
    const task = new Task({ title: 'Prompt', payload: 'hello', type: TaskType.Prompt, timeout: 2.5 });
    await makeDefaultExecutor().execute(task);
    expect(recorded.timeout).toBe(2.5);
    setCopilotSessionFactory(null);
  });

  it('test_copilot_prompt_handler_allows_model_override', async () => {
    const recorded = installFakeCopilot({ content: 'done' });
    const executor = makeDefaultExecutor();
    executor.register(TaskType.Prompt, makeCopilotPromptHandler({ model: 'gpt-custom', timeout: 12 }));
    await executor.execute(new Task({ title: 'Prompt', payload: 'hello', type: TaskType.Prompt }));
    expect(recorded.timeout).toBe(12);
    expect(recorded.createSession).toMatchObject({ model: 'gpt-custom', availableTools: [] });
    setCopilotSessionFactory(null);
  });

  it('test_copilot_prompt_handler_none_response_returns_empty_string', async () => {
    installFakeCopilot({ content: null });
    const result = await makeDefaultExecutor().execute(new Task({ title: 'Prompt', payload: 'hello', type: TaskType.Prompt }));
    expect(result.output).toBe('');
    setCopilotSessionFactory(null);
  });

  it('test_copilot_prompt_handler_unknown_response_data_returns_empty_string', async () => {
    setCopilotSessionFactory(() => ({ async sendAndWait() { return { data: null }; } }));
    const result = await makeDefaultExecutor().execute(new Task({ title: 'Prompt', payload: 'hello', type: TaskType.Prompt }));
    expect(result.output).toBe('');
    setCopilotSessionFactory(null);
  });

  it('test_copilot_prompt_handler_sdk_error_marks_task_failed', async () => {
    installFakeCopilot({ error: new Error('sdk boom') });
    const task = new Task({ title: 'Prompt', payload: 'hello', type: TaskType.Prompt });
    await expect(makeDefaultExecutor().execute(task)).rejects.toThrow('sdk boom');
    expect(task.status).toBe(TaskStatus.Failed);
    setCopilotSessionFactory(null);
  });

  it('test_make_copilot_agent_handler_rejects_empty_model', () => {
    expect(() => makeCopilotAgentHandler({ model: '' })).toThrow('model must not be empty');
  });

  it('test_default_agent_handler_uses_copilot_sdk_with_tools_enabled', async () => {
    const recorded = installFakeCopilot({ content: 'agent done' });
    const task = new Task({ title: 'Agent', payload: 'inspect repo', type: TaskType.Agent });
    const result = await makeDefaultExecutor().execute(task);
    expect(result.output).toBe('agent done');
    expect(recorded.prompt).toBe('inspect repo');
    expect(recorded.timeout).toBeNull();
    expect(recorded.createSession).toMatchObject({ model: 'gpt-5.5', toolsEnabled: true });
    setCopilotSessionFactory(null);
  });

  it('test_copilot_agent_handler_uses_task_timeout', async () => {
    const recorded = installFakeCopilot({ content: 'done' });
    await makeDefaultExecutor().execute(new Task({ title: 'Agent', payload: 'hello', type: TaskType.Agent, timeout: 3.5 }));
    expect(recorded.timeout).toBe(3.5);
    setCopilotSessionFactory(null);
  });

  it('test_copilot_agent_handler_allows_model_override', async () => {
    const recorded = installFakeCopilot({ content: 'done' });
    const executor = makeDefaultExecutor();
    executor.register(TaskType.Agent, makeCopilotAgentHandler({ model: 'agent-custom' }));
    await executor.execute(new Task({ title: 'Agent', payload: 'hello', type: TaskType.Agent }));
    expect(recorded.createSession).toMatchObject({ model: 'agent-custom' });
    setCopilotSessionFactory(null);
  });

  it('test_copilot_agent_handler_sdk_error_marks_task_failed', async () => {
    installFakeCopilot({ error: new Error('agent boom') });
    const task = new Task({ title: 'Agent', payload: 'hello', type: TaskType.Agent });
    await expect(makeDefaultExecutor().execute(task)).rejects.toThrow('agent boom');
    expect(task.status).toBe(TaskStatus.Failed);
    setCopilotSessionFactory(null);
  });

  it('test_cancel_stops_in_flight_bash_task', async () => {
    const executor = makeDefaultExecutor();
    const task = bash('Long running', 'sleep 30');
    const errors: unknown[] = [];
    const running = executor.execute(task).catch((error) => { errors.push(error); });
    for (let i = 0; i < 100 && !executor.isRunning(task.id); i += 1) await sleep(10);
    expect(executor.isRunning(task.id)).toBe(true);
    executor.cancel(task);
    await running;
    expect(task.status).toBe(TaskStatus.Cancelled);
    expect(errors[0]).toBeInstanceOf(TaskCancelled);
    expect(executor.isRunning(task.id)).toBe(false);
  });

  it('test_task_result_is_none_before_execution', () => {
    expect(bash('X', 'echo hi').result).toBeNull();
  });

  it('test_successful_execute_sets_task_result', async () => {
    const task = bash('X', 'echo hi');
    const returned = await makeDefaultExecutor().execute(task);
    expect(task.result).toBe(returned);
    expect(task.result?.status).toBe(TaskStatus.Done);
    expect(task.result?.output.trim()).toBe('hi');
  });

  it('test_failed_execute_sets_task_result_with_failed_status', async () => {
    const task = bash('X', 'exit 1');
    const before = new Date();
    await expect(makeDefaultExecutor().execute(task)).rejects.toThrow();
    const after = new Date();
    expect(task.result?.status).toBe(TaskStatus.Failed);
    assertResultTiming(task.result!, before, after);
  });

  it('test_cancelled_execute_sets_task_result_with_cancelled_status', async () => {
    const executor = makeDefaultExecutor();
    const task = bash('X', 'sleep 5');
    const errors: unknown[] = [];
    const before = new Date();
    const running = executor.execute(task).catch((error) => { errors.push(error); });
    for (let i = 0; i < 100 && !executor.isRunning(task.id); i += 1) await sleep(10);
    executor.cancel(task);
    await running;
    const after = new Date();
    expect(errors[0]).toBeInstanceOf(TaskCancelled);
    expect(task.result?.status).toBe(TaskStatus.Cancelled);
    assertResultTiming(task.result!, before, after);
  });

  it('test_retry_after_failure_replaces_task_result', async () => {
    const task = bash('X', 'exit 1');
    const executor = makeDefaultExecutor();
    await expect(executor.execute(task)).rejects.toThrow();
    const first = task.result;
    task.payload = 'echo recovered';
    await executor.execute(task);
    expect(task.result).not.toBe(first);
    expect(task.result?.status).toBe(TaskStatus.Done);
    expect(task.result?.output.trim()).toBe('recovered');
  });
});

async function commandSucceeds(command: string): Promise<boolean> {
  const task = bash('probe', command);
  try {
    await makeDefaultExecutor().execute(task);
    return true;
  } catch {
    return false;
  }
}
