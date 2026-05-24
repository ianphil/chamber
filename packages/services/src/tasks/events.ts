import type { Task, TaskStatus } from './task';

export enum TaskEventType {
  Started = 'started',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export interface TaskEvent {
  type: TaskEventType;
  taskId: string;
  task: Task;
  timestamp: Date;
  previousStatus: TaskStatus | null;
  status: TaskStatus;
  error?: string;
}

export type TaskEventHandler = (event: TaskEvent) => void;

export class EventBus {
  #subscribers: TaskEventHandler[] = [];
  #errors: unknown[] = [];

  get errors(): unknown[] {
    return [...this.#errors];
  }

  subscribe(subscriber: TaskEventHandler): () => void {
    if (typeof subscriber !== 'function') {
      throw new TypeError('subscriber must be callable');
    }
    this.#subscribers.push(subscriber);
    return () => {
      const index = this.#subscribers.indexOf(subscriber);
      if (index >= 0) this.#subscribers.splice(index, 1);
    };
  }

  emit(event: TaskEvent): void {
    for (const subscriber of [...this.#subscribers]) {
      try {
        subscriber(event);
      } catch (error) {
        this.#errors.push(error);
      }
    }
  }
}
