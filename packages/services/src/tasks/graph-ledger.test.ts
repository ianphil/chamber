import { describe, expect, it } from 'vitest';
import { GraphLedger, TaskGraph } from './index';

describe('GraphLedger', () => {
  it('test_graph_ledger_rejects_non_graph_values', () => {
    const ledger = new GraphLedger();
    expect(() => ledger.set('id', 'not a graph' as never)).toThrow('Expected TaskGraph, got string');
    expect(ledger.has('id')).toBe(false);
  });

  it('test_graph_ledger_rejects_graph_id_mismatch', () => {
    const ledger = new GraphLedger();
    const graph = new TaskGraph(undefined, { title: 'Build' });
    expect(() => ledger.set('wrong-id', graph)).toThrow('graph_id must match graph.id');
    expect(ledger.has('wrong-id')).toBe(false);
    expect(ledger.has(graph.id)).toBe(false);
  });

  it('test_graph_ledger_accepts_graph_under_its_own_id', () => {
    const ledger = new GraphLedger();
    const graph = new TaskGraph(undefined, { title: 'Build' });
    ledger.set(graph.id, graph);
    expect(ledger.has(graph.id)).toBe(true);
    expect(ledger.get(graph.id)).toBe(graph);
  });

  it('test_graph_ledger_iterates_in_insertion_order', () => {
    const ledger = new GraphLedger();
    const first = new TaskGraph(undefined, { title: 'First' });
    const second = new TaskGraph(undefined, { title: 'Second' });
    ledger.set(first.id, first);
    ledger.set(second.id, second);
    expect([...ledger]).toEqual([first, second]);
  });

  it('test_graph_ledger_repr_includes_graph_count', () => {
    expect(new GraphLedger().toString()).toBe('GraphLedger(0 graphs)');
  });

  it('test_graph_ledger_get_missing_graph_raises_key_error', () => {
    expect(() => new GraphLedger().get('missing')).toThrow('KeyError: missing');
  });

  it('test_graph_ledger_del_removes_graph', () => {
    const ledger = new GraphLedger();
    const graph = new TaskGraph(undefined, { title: 'Build' });
    ledger.set(graph.id, graph);
    ledger.delete(graph.id);
    expect(ledger.has(graph.id)).toBe(false);
    expect(ledger.size).toBe(0);
  });

  it('test_graph_ledger_delete_missing_graph_raises_key_error', () => {
    expect(() => new GraphLedger().delete('missing')).toThrow('KeyError: missing');
  });

  it('test_graph_id_cannot_change_after_storing_in_graph_ledger', () => {
    const ledger = new GraphLedger();
    const graph = new TaskGraph(undefined, { title: 'Build' });
    const id = graph.id;
    ledger.set(id, graph);
    expect(() => { graph.id = 'new-id'; }).toThrow();
    expect(graph.id).toBe(id);
    expect(ledger.get(id)).toBe(graph);
  });
});
