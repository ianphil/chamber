import { describe, it, expect } from 'vitest';
import { InMemoryStore, Task, TaskGraph } from '@ianphil/ttasks-ts';
import { TTasksCronRunStore } from './CronRunStore';

function recordWith(store: InMemoryStore, graphId: string) {
  const cronStore = new TTasksCronRunStore(store);
  const now = new Date().toISOString();
  const run = cronStore.recordRun({
    jobId: 'job-1',
    mindId: 'mind-1',
    status: 'completed',
    startedAt: now,
    endedAt: now,
    graphId,
    output: 'ok',
    source: 'manual',
  });
  return { cronStore, run };
}

describe('TTasksCronRunStore.getRunDetail', () => {
  it('returns the script graph member tasks via graph_members, not task metadata', () => {
    const store = new InMemoryStore();
    const graphId = 'graph-abc';
    const graph = new TaskGraph({ id: graphId });
    const first = Task.bash('echo one', { title: 'first task' });
    const second = Task.bash('echo two', { title: 'second task' });
    graph.add(first);
    graph.add(second, { after: [first] });
    store.graphs.save(graph);

    const { cronStore, run } = recordWith(store, graphId);
    const detail = cronStore.getRunDetail(run.id);

    expect(detail).not.toBeNull();
    expect(detail!.run.graphId).toBe(graphId);
    expect(detail!.graph.map((node) => node.title)).toEqual(['first task', 'second task']);
    // The cron run record task itself must not leak into the per-task tree.
    expect(detail!.graph.some((node) => node.id === run.id)).toBe(false);
  });

  it('returns an empty graph when the run has no resolvable script graph', () => {
    const store = new InMemoryStore();
    const { cronStore, run } = recordWith(store, 'missing-graph');
    const detail = cronStore.getRunDetail(run.id);

    expect(detail).not.toBeNull();
    expect(detail!.graph).toEqual([]);
  });

  it('returns null for an unknown run id', () => {
    const store = new InMemoryStore();
    const cronStore = new TTasksCronRunStore(store);
    expect(cronStore.getRunDetail('nope')).toBeNull();
  });
});
