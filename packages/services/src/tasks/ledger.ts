import { Task } from './task';
import type { TaskGraph } from './workflow';

export class TaskLedger implements Iterable<Task> {
  #tasks = new Map<string, Task>();

  set(taskId: string, task: Task): void {
    if (!(task instanceof Task)) throw new TypeError(`Expected Task, got ${typeName(task)}`);
    if (taskId !== task.id) throw new Error('task_id must match task.id');
    this.#tasks.set(taskId, task);
  }

  get(taskId: string): Task {
    const task = this.#tasks.get(taskId);
    if (!task) throw new Error(`KeyError: ${taskId}`);
    return task;
  }

  has(taskId: string): boolean {
    return this.#tasks.has(taskId);
  }

  delete(taskId: string): void {
    if (!this.#tasks.delete(taskId)) throw new Error(`KeyError: ${taskId}`);
  }

  cancel(taskId: string): void {
    this.get(taskId).cancel();
  }

  get size(): number {
    return this.#tasks.size;
  }

  [Symbol.iterator](): Iterator<Task> {
    return this.#tasks.values();
  }

  toString(): string {
    return `TaskLedger(${this.size} tasks)`;
  }
}

export class GraphLedger implements Iterable<TaskGraph> {
  #graphs = new Map<string, TaskGraph>();

  set(graphId: string, graph: TaskGraph): void {
    if (!isTaskGraph(graph)) throw new TypeError(`Expected TaskGraph, got ${typeName(graph)}`);
    if (graphId !== graph.id) throw new Error('graph_id must match graph.id');
    this.#graphs.set(graphId, graph);
  }

  get(graphId: string): TaskGraph {
    const graph = this.#graphs.get(graphId);
    if (!graph) throw new Error(`KeyError: ${graphId}`);
    return graph;
  }

  has(graphId: string): boolean {
    return this.#graphs.has(graphId);
  }

  delete(graphId: string): void {
    if (!this.#graphs.delete(graphId)) throw new Error(`KeyError: ${graphId}`);
  }

  get size(): number {
    return this.#graphs.size;
  }

  [Symbol.iterator](): Iterator<TaskGraph> {
    return this.#graphs.values();
  }

  toString(): string {
    return `GraphLedger(${this.size} graphs)`;
  }
}

function isTaskGraph(value: unknown): value is TaskGraph {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'run' in value);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  return (value as object).constructor.name;
}
