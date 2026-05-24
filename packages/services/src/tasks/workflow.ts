import { randomUUID } from 'node:crypto';
import type { TaskExecutor } from './executor';
import { TaskLedger } from './ledger';
import { Task, TaskStatus } from './task';

export class TaskGraph implements Iterable<Task> {
  #id = randomUUID();
  readonly createdAt = new Date();
  readonly ledger: TaskLedger;
  title: string;
  #deps = new Map<string, string[]>();
  #blocked = new Set<string>();
  #errors = new Map<string, unknown>();
  #finally = new Set<string>();
  #optional = new Set<string>();

  constructor(ledger?: TaskLedger, options: { title?: string } = {}) {
    if (typeof options.title !== 'undefined' && typeof options.title !== 'string') {
      throw new TypeError('title must be a str');
    }
    this.ledger = ledger ?? new TaskLedger();
    this.title = options.title ?? '';
  }

  get id(): string { return this.#id; }
  set id(_value: string) { throw new TypeError('id is read-only'); }

  set(task: Task, deps: Iterable<Task>): void {
    this.ledger.set(task.id, task);
    this.#deps.set(task.id, [...deps].map((dep) => dep.id));
    this.#finally.delete(task.id);
    this.#optional.delete(task.id);
  }

  addFinally(task: Task, options: { after: Iterable<Task>; required?: boolean }): void {
    const required = options.required ?? true;
    if (typeof required !== 'boolean') throw new TypeError('required must be a bool');
    this.ledger.set(task.id, task);
    this.#deps.set(task.id, [...options.after].map((dep) => dep.id));
    this.#finally.add(task.id);
    if (required) this.#optional.delete(task.id);
    else this.#optional.add(task.id);
  }

  get(task: Task): Task[] {
    return (this.#deps.get(task.id) ?? []).map((id) => this.ledger.get(id));
  }

  has(task: unknown): boolean {
    return task instanceof Task && this.#deps.has(task.id);
  }

  get size(): number { return this.#deps.size; }

  [Symbol.iterator](): Iterator<Task> {
    const ids = [...this.#deps.keys()];
    let index = 0;
    return {
      next: (): IteratorResult<Task> => {
        if (index >= ids.length) return { done: true, value: undefined };
        return { done: false, value: this.ledger.get(ids[index++]) };
      },
    };
  }

  toString(): string {
    const edges = [...this.#deps.entries()]
      .flatMap(([taskId, deps]) => deps.map((depId) => `${this.ledger.get(depId).title}->${this.ledger.get(taskId).title}`))
      .join(', ');
    return `TaskGraph(${this.size} tasks, edges=[${edges}])`;
  }

  get succeeded(): Task[] { return [...this].filter((task) => task.status === TaskStatus.Done); }
  get failed(): Task[] { return [...this].filter((task) => task.status === TaskStatus.Failed); }
  get cancelled(): Task[] { return [...this].filter((task) => task.status === TaskStatus.Cancelled); }
  get blocked(): Task[] { return [...this.#blocked].map((id) => this.ledger.get(id)); }
  get errors(): ReadonlyMap<string, unknown> { return new Map(this.#errors); }
  get ok(): boolean {
    const required = [...this.#deps.keys()].filter((id) => !this.#optional.has(id));
    return required.every((id) => this.ledger.get(id).status === TaskStatus.Done)
      && ![...this.#errors.keys()].some((id) => !this.#optional.has(id))
      && ![...this.#blocked].some((id) => !this.#optional.has(id));
  }

  roots(): Task[] {
    return [...this.#deps.entries()].filter(([, deps]) => deps.length === 0).map(([id]) => this.ledger.get(id));
  }

  leaves(): Task[] {
    const dependedOn = new Set([...this.#deps.values()].flat());
    return [...this.#deps.keys()].filter((id) => !dependedOn.has(id)).map((id) => this.ledger.get(id));
  }

  async run(executor: TaskExecutor, options: { maxWorkers?: number } = {}): Promise<this> {
    const maxWorkers = options.maxWorkers ?? 4;
    if (maxWorkers <= 0) throw new Error('max_workers must be greater than 0');
    this.validate();
    this.#blocked = new Set();
    this.#errors = new Map();
    if (this.#deps.size === 0) return this;

    const running = new Map<string, Promise<void>>();
    let active = 0;

    const succeeded = (id: string): boolean => this.ledger.get(id).status === TaskStatus.Done;
    const inactive = (id: string): boolean => {
      const task = this.ledger.get(id);
      return [TaskStatus.Done, TaskStatus.Failed, TaskStatus.Cancelled].includes(task.status)
        || this.#blocked.has(id)
        || this.#errors.has(id);
    };
    const ready = (id: string): boolean => {
      const deps = this.#deps.get(id) ?? [];
      if (this.#finally.has(id)) return deps.every(inactive);
      return deps.every(succeeded);
    };
    const depFailedOrBlocked = (id: string): boolean => (this.#deps.get(id) ?? []).some((dep) => {
      const task = this.ledger.get(dep);
      return this.#blocked.has(dep)
        || this.#errors.has(dep)
        || task.status === TaskStatus.Cancelled
        || task.status === TaskStatus.Failed;
    });
    const finished = (id: string): boolean => {
      const task = this.ledger.get(id);
      return task.status === TaskStatus.Done || this.#blocked.has(id) || this.#errors.has(id) || !running.has(id);
    };
    const upstream = (id: string): Map<string, Task> => new Map((this.#deps.get(id) ?? []).map((dep) => [dep, this.ledger.get(dep)]));

    return await new Promise<this>((resolve) => {
      const schedule = () => {
        let changed = true;
        while (changed) {
          changed = false;
          for (const id of this.#deps.keys()) {
            const task = this.ledger.get(id);
            if (running.has(id) || this.#blocked.has(id) || this.#errors.has(id) || task.status === TaskStatus.Done) continue;
            if (!this.#finally.has(id) && depFailedOrBlocked(id)) {
              this.#blocked.add(id);
              changed = true;
            } else if (ready(id) && active < maxWorkers) {
              if (task.canTransitionTo(TaskStatus.Running)) {
                active += 1;
                const promise = executor.execute(task, upstream(id))
                  .catch((error: unknown) => { this.#errors.set(id, error); })
                  .finally(() => {
                    active -= 1;
                    running.delete(id);
                    schedule();
                  });
                running.set(id, promise.then(() => undefined));
              } else {
                this.#blocked.add(id);
              }
              changed = true;
            }
          }
        }
        if ([...this.#deps.keys()].every(finished)) resolve(this);
      };
      schedule();
    });
  }

  private validate(): void {
    for (const [id, deps] of this.#deps.entries()) {
      for (const dep of deps) {
        if (!this.#deps.has(dep)) {
          throw new Error(`task ${this.ledger.get(id).title} depends on unregistered task id ${dep}`);
        }
      }
    }
    const indeg = new Map([...this.#deps.entries()].map(([id, deps]) => [id, deps.length]));
    const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
    let visited = 0;
    while (queue.length > 0) {
      const cur = queue.pop()!;
      visited += 1;
      for (const [id, deps] of this.#deps.entries()) {
        if (deps.includes(cur)) {
          indeg.set(id, (indeg.get(id) ?? 0) - 1);
          if (indeg.get(id) === 0) queue.push(id);
        }
      }
    }
    if (visited !== this.#deps.size) throw new Error('TaskGraph contains a cycle');
  }
}
