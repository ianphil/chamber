import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { Task, TaskExecutor, TaskGraph, TaskLedger, TaskStatus, TaskType, makeDefaultExecutor } from './index';

function bash(title: string, payload: string): Task {
  return new Task({ title, payload, type: TaskType.Bash });
}

describe('TaskGraph', () => {
  it('test_graph_has_read_only_id', () => {
    const graph = new TaskGraph();
    const id = graph.id;
    expect(() => { graph.id = 'new-id'; }).toThrow();
    expect(graph.id).toBe(id);
  });

  it('test_graph_accepts_title', () => {
    expect(new TaskGraph(undefined, { title: 'Build' }).title).toBe('Build');
  });

  it('test_graph_rejects_non_string_title', () => {
    expect(() => new TaskGraph(undefined, { title: 42 as never })).toThrow('title must be a str');
  });

  it('test_graph_created_at_defaults_to_now', () => {
    const before = new Date();
    const graph = new TaskGraph();
    const after = new Date();
    expect(graph.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(graph.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('test_setitem_registers_task_in_ledger', () => {
    const a = bash('A', 'echo a');
    const graph = new TaskGraph();
    graph.set(a, []);
    expect(graph.ledger.has(a.id)).toBe(true);
    expect(graph.ledger.get(a.id)).toBe(a);
  });

  it('test_getitem_returns_dep_tasks', () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    expect(graph.get(b)).toEqual([a]);
    expect(graph.get(a)).toEqual([]);
  });

  it('test_contains_accepts_task_only', () => {
    const a = bash('A', 'echo a');
    const graph = new TaskGraph();
    graph.set(a, []);
    expect(graph.has(a)).toBe(true);
    expect(graph.has('not a task')).toBe(false);
    expect(graph.has(42)).toBe(false);
  });

  it('test_iter_yields_all_tasks', () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    expect([...graph]).toEqual([a, b]);
  });

  it('test_len_counts_tasks', () => {
    const graph = new TaskGraph();
    expect(graph.size).toBe(0);
    graph.set(bash('A', 'echo a'), []);
    expect(graph.size).toBe(1);
  });

  it('test_repr_includes_edges', () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    expect(graph.toString()).toContain('TaskGraph(2 tasks');
    expect(graph.toString()).toContain('A->B');
  });

  it('test_default_constructor_creates_own_ledger', () => {
    const graph = new TaskGraph();
    expect(graph.ledger).toBeInstanceOf(TaskLedger);
    expect(graph.ledger.size).toBe(0);
  });

  it('test_constructor_uses_provided_ledger', () => {
    const ledger = new TaskLedger();
    expect(new TaskGraph(ledger).ledger).toBe(ledger);
  });

  it('test_constructor_accepts_positional_ledger', () => {
    const ledger = new TaskLedger();
    const graph = new TaskGraph(ledger);
    expect(graph.ledger).toBe(ledger);
  });

  it('test_ledger_can_be_pre_populated', () => {
    const ledger = new TaskLedger();
    const a = bash('A', 'echo a');
    ledger.set(a.id, a);
    const graph = new TaskGraph(ledger);
    expect(graph.has(a)).toBe(false);
    expect(graph.size).toBe(0);
    expect(ledger.has(a.id)).toBe(true);
  });

  it('test_run_rejects_non_positive_max_workers', async () => {
    await expect(new TaskGraph().run(makeDefaultExecutor(), { maxWorkers: 0 })).rejects.toThrow('max_workers must be greater than 0');
  });

  it('test_run_raises_on_unregistered_dep', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(b, [a]);
    await expect(graph.run(makeDefaultExecutor())).rejects.toThrow('depends on unregistered');
  });

  it('test_run_raises_on_self_loop', async () => {
    const a = bash('A', 'echo a');
    const graph = new TaskGraph();
    graph.set(a, [a]);
    await expect(graph.run(makeDefaultExecutor())).rejects.toThrow('cycle');
  });

  it('test_run_raises_on_two_node_cycle', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, [b]);
    graph.set(b, [a]);
    await expect(graph.run(makeDefaultExecutor())).rejects.toThrow('cycle');
  });

  it('test_run_raises_on_larger_cycle', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const graph = new TaskGraph();
    graph.set(a, [c]);
    graph.set(b, [a]);
    graph.set(c, [b]);
    await expect(graph.run(makeDefaultExecutor())).rejects.toThrow('cycle');
  });

  it('test_graph_passes_direct_upstream_task_refs', async () => {
    const a = bash('A', '');
    const b = bash('B', '');
    const executor = new TaskExecutor();
    const graph = new TaskGraph();
    executor.register(TaskType.Bash, (context) => {
      if (context.id === a.id) return 'a';
      expect(context.upstream.get(a.id)).toBe(a);
      expect(context.upstream.get(a.id)).toBe(graph.ledger.get(a.id));
      expect(context.upstream.get(a.id)?.result).not.toBeNull();
      return context.upstream.get(a.id)!.result!.output.toUpperCase();
    });
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(executor);
    expect(b.result?.output).toBe('A');
  });

  it('test_graph_passes_only_direct_upstream_task_refs', async () => {
    const a = bash('A', '');
    const b = bash('B', '');
    const c = bash('C', '');
    const executor = new TaskExecutor();
    executor.register(TaskType.Bash, (context) => {
      if (context.id === a.id) return 'a';
      if (context.id === b.id) {
        expect([...context.upstream.keys()]).toEqual([a.id]);
        return 'b';
      }
      expect([...context.upstream.keys()]).toEqual([b.id]);
      expect(context.upstream.has(a.id)).toBe(false);
      return 'c';
    });
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [b]);
    await graph.run(executor);
    expect(graph.ok).toBe(true);
  });

  it('test_empty_graph_runs_without_hanging', async () => {
    const graph = new TaskGraph();
    await expect(graph.run(makeDefaultExecutor())).resolves.toBe(graph);
    expect(graph.ok).toBe(true);
  });

  it('test_single_node_runs', async () => {
    const a = bash('A', 'echo hello');
    const graph = new TaskGraph();
    graph.set(a, []);
    await graph.run(makeDefaultExecutor());
    expect(a.status).toBe(TaskStatus.Done);
    expect(a.result?.output.trim()).toBe('hello');
  });

  it('test_linear_chain_runs_in_order', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [b]);
    await graph.run(makeDefaultExecutor());
    expect(graph.ok).toBe(true);
    expect([a, b, c].map((task) => task.status)).toEqual([TaskStatus.Done, TaskStatus.Done, TaskStatus.Done]);
  });

  it('test_diamond_runs_with_parallelism', async () => {
    const a = bash('A', 'sleep 0.3');
    const b = bash('B', 'sleep 0.3');
    const c = bash('C', 'sleep 0.3');
    const d = bash('D', 'sleep 0.3');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [a]);
    graph.set(d, [b, c]);
    const start = performance.now();
    await graph.run(makeDefaultExecutor());
    expect((performance.now() - start) / 1000).toBeLessThan(1.15);
    expect(graph.ok).toBe(true);
  });

  it('test_graph_records_executor_errors', async () => {
    const a = bash('A', 'echo a');
    const graph = new TaskGraph();
    graph.set(a, []);
    await graph.run(new TaskExecutor());
    expect(graph.errors.has(a.id)).toBe(true);
    expect(a.status).toBe(TaskStatus.Pending);
    expect(graph.failed).toEqual([]);
    expect(graph.blocked).toEqual([]);
    expect(graph.ok).toBe(false);
  });

  it('test_executor_error_blocks_descendants', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(new TaskExecutor());
    expect(graph.errors.has(a.id)).toBe(true);
    expect(graph.blocked).toEqual([b]);
    expect(b.status).toBe(TaskStatus.Pending);
  });

  it('test_failure_blocks_descendants', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [b]);
    await graph.run(makeDefaultExecutor());
    expect(a.status).toBe(TaskStatus.Failed);
    expect(graph.failed).toEqual([a]);
    expect(new Set(graph.blocked.map((task) => task.id))).toEqual(new Set([b.id, c.id]));
  });

  it('test_failure_does_not_affect_independent_branch', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, []);
    graph.set(c, [b]);
    await graph.run(makeDefaultExecutor());
    expect(graph.failed).toEqual([a]);
    expect(new Set(graph.succeeded.map((task) => task.id))).toEqual(new Set([b.id, c.id]));
    expect(graph.blocked).toEqual([]);
  });

  it('test_failure_in_diamond_blocks_only_downstream', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const d = bash('D', 'echo d');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [a]);
    graph.set(d, [b, c]);
    await graph.run(makeDefaultExecutor());
    expect(new Set(graph.blocked.map((task) => task.id))).toEqual(new Set([b.id, c.id, d.id]));
  });

  it('test_failure_terminates_run_without_hanging', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    const start = performance.now();
    await graph.run(makeDefaultExecutor());
    expect((performance.now() - start) / 1000).toBeLessThan(2);
  });

  it('test_add_finally_runs_after_failed_and_blocked_tasks', async () => {
    const a = bash('A', '');
    const b = bash('B', '');
    const report = bash('Report', '');
    const executor = new TaskExecutor();
    executor.register(TaskType.Bash, (context) => {
      if (context.id === a.id) throw new Error('boom');
      expect(context.id).toBe(report.id);
      expect(new Set(context.upstream.keys())).toEqual(new Set([a.id, b.id]));
      expect(context.upstream.get(a.id)?.status).toBe(TaskStatus.Failed);
      expect(context.upstream.get(b.id)?.status).toBe(TaskStatus.Pending);
      return 'report';
    });
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.addFinally(report, { after: [a, b] });
    await graph.run(executor);
    expect(b.status).toBe(TaskStatus.Pending);
    expect(report.status).toBe(TaskStatus.Done);
    expect(report.result?.output).toBe('report');
    expect(graph.ok).toBe(false);
  });

  it('test_optional_finally_failure_does_not_make_graph_not_ok', async () => {
    const a = bash('A', '');
    const report = bash('Report', '');
    const executor = new TaskExecutor();
    executor.register(TaskType.Bash, (context) => {
      if (context.id === a.id) return 'a';
      throw new Error('copilot unavailable');
    });
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.addFinally(report, { after: [a], required: false });
    await graph.run(executor);
    expect(a.status).toBe(TaskStatus.Done);
    expect(report.status).toBe(TaskStatus.Failed);
    expect(graph.failed).toContain(report);
    expect(graph.errors.has(report.id)).toBe(true);
    expect(graph.ok).toBe(true);
  });

  it('test_required_finally_failure_makes_graph_not_ok', async () => {
    const a = bash('A', '');
    const report = bash('Report', '');
    const executor = new TaskExecutor();
    executor.register(TaskType.Bash, (context) => {
      if (context.id === a.id) return 'a';
      throw new Error('report failed');
    });
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.addFinally(report, { after: [a] });
    await graph.run(executor);
    expect(report.status).toBe(TaskStatus.Failed);
    expect(graph.ok).toBe(false);
  });

  it('test_add_finally_rejects_non_bool_required', () => {
    expect(() => new TaskGraph().addFinally(bash('Report', ''), { after: [], required: 'no' as never })).toThrow('required must be a bool');
  });

  it('test_ledger_carries_results_after_run', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    for (const task of graph.ledger) {
      expect(task.result?.status).toBe(TaskStatus.Done);
      expect(task.result?.output.trim()).toBe(task.title.toLowerCase());
    }
  });

  it('test_blocked_task_has_no_result_after_run', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    expect(a.result?.status).toBe(TaskStatus.Failed);
    expect(b.result).toBeNull();
    expect(b.status).toBe(TaskStatus.Pending);
  });

  it('test_run_returns_self', async () => {
    const graph = new TaskGraph();
    graph.set(bash('A', 'echo a'), []);
    await expect(graph.run(makeDefaultExecutor())).resolves.toBe(graph);
  });

  it('test_run_returns_self_for_empty_graph', async () => {
    const graph = new TaskGraph();
    await expect(graph.run(makeDefaultExecutor())).resolves.toBe(graph);
  });

  it('test_succeeded_lists_done_tasks_in_graph', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    expect(new Set(graph.succeeded.map((task) => task.id))).toEqual(new Set([a.id, b.id]));
  });

  it('test_succeeded_empty_before_run', () => {
    const graph = new TaskGraph();
    graph.set(bash('A', 'echo a'), []);
    expect(graph.succeeded).toEqual([]);
  });

  it('test_succeeded_only_lists_graph_tasks_not_whole_ledger', async () => {
    const ledger = new TaskLedger();
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const g1 = new TaskGraph(ledger);
    const g2 = new TaskGraph(ledger);
    g1.set(a, []);
    g2.set(b, []);
    await g1.run(makeDefaultExecutor());
    await g2.run(makeDefaultExecutor());
    expect(g1.succeeded).toEqual([a]);
    expect(g2.succeeded).toEqual([b]);
  });

  it('test_cancelled_lists_cancelled_tasks', async () => {
    const a = bash('A', 'echo a');
    a.cancel();
    const graph = new TaskGraph();
    graph.set(a, []);
    await graph.run(makeDefaultExecutor());
    expect(graph.cancelled).toEqual([a]);
    expect(graph.blocked).toEqual([a]);
    expect(graph.ok).toBe(false);
  });

  it('test_failed_lists_failed_tasks', async () => {
    const a = bash('A', 'exit 1');
    const graph = new TaskGraph();
    graph.set(a, []);
    await graph.run(makeDefaultExecutor());
    expect(graph.failed).toEqual([a]);
  });

  it('test_failed_empty_when_all_succeed', async () => {
    const graph = new TaskGraph();
    graph.set(bash('A', 'echo a'), []);
    await graph.run(makeDefaultExecutor());
    expect(graph.failed).toEqual([]);
  });

  it('test_blocked_lists_skipped_descendants', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [b]);
    await graph.run(makeDefaultExecutor());
    expect(new Set(graph.blocked.map((task) => task.id))).toEqual(new Set([b.id, c.id]));
  });

  it('test_blocked_empty_before_run', () => {
    const graph = new TaskGraph();
    graph.set(bash('A', 'echo a'), []);
    expect(graph.blocked).toEqual([]);
  });

  it('test_blocked_empty_when_no_failures', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    expect(graph.blocked).toEqual([]);
  });

  it('test_blocked_resets_at_start_of_run', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    expect(graph.blocked).toContain(b);
    await graph.run(makeDefaultExecutor());
    expect(new Set(graph.blocked.map((task) => task.id))).toEqual(new Set([b.id]));
  });

  it('test_clean_graph_can_be_run_again_without_blocking_done_dependencies', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    await graph.run(makeDefaultExecutor());
    expect(graph.ok).toBe(true);
    expect(graph.blocked).toEqual([]);
    expect(graph.failed).toEqual([]);
  });

  it('test_done_dependency_allows_pending_descendant_to_run', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    await graph.run(makeDefaultExecutor());
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    expect(graph.ok).toBe(true);
    expect(b.status).toBe(TaskStatus.Done);
  });

  it('test_cancelled_root_is_blocked_instead_of_hanging', async () => {
    const a = bash('A', 'echo a');
    a.cancel();
    const graph = new TaskGraph();
    graph.set(a, []);
    await graph.run(makeDefaultExecutor());
    expect(graph.blocked).toEqual([a]);
    expect(graph.ok).toBe(false);
  });

  it('test_ok_true_after_clean_run', async () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    expect(graph.ok).toBe(true);
  });

  it('test_ok_false_after_failure', async () => {
    const graph = new TaskGraph();
    graph.set(bash('A', 'exit 1'), []);
    await graph.run(makeDefaultExecutor());
    expect(graph.ok).toBe(false);
  });

  it('test_ok_false_when_tasks_blocked', async () => {
    const a = bash('A', 'exit 1');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    await graph.run(makeDefaultExecutor());
    expect(graph.ok).toBe(false);
  });

  it('test_ok_false_before_run', () => {
    const graph = new TaskGraph();
    graph.set(bash('A', 'echo a'), []);
    expect(graph.ok).toBe(false);
  });

  it('test_ok_true_for_empty_graph', async () => {
    const graph = new TaskGraph();
    await graph.run(makeDefaultExecutor());
    expect(graph.ok).toBe(true);
  });

  it('test_roots_returns_tasks_with_no_deps', () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, []);
    graph.set(c, [a, b]);
    expect(new Set(graph.roots().map((task) => task.id))).toEqual(new Set([a.id, b.id]));
  });

  it('test_roots_empty_for_empty_graph', () => {
    expect(new TaskGraph().roots()).toEqual([]);
  });

  it('test_roots_all_when_no_edges', () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, []);
    expect(new Set(graph.roots().map((task) => task.id))).toEqual(new Set([a.id, b.id]));
  });

  it('test_leaves_returns_tasks_with_no_dependents', () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [a]);
    expect(new Set(graph.leaves().map((task) => task.id))).toEqual(new Set([b.id, c.id]));
  });

  it('test_leaves_empty_for_empty_graph', () => {
    expect(new TaskGraph().leaves()).toEqual([]);
  });

  it('test_diamond_roots_and_leaves', () => {
    const a = bash('A', 'echo a');
    const b = bash('B', 'echo b');
    const c = bash('C', 'echo c');
    const d = bash('D', 'echo d');
    const graph = new TaskGraph();
    graph.set(a, []);
    graph.set(b, [a]);
    graph.set(c, [a]);
    graph.set(d, [b, c]);
    expect(graph.roots()).toEqual([a]);
    expect(graph.leaves()).toEqual([d]);
  });
});
