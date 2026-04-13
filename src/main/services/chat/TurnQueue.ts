export class TurnQueue {
  private chains = new Map<string, Promise<void>>();
  private active = new Set<string>();

  enqueue<T>(mindId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(mindId) ?? Promise.resolve();

    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

    const next = previous.then(async () => {
      this.active.add(mindId);
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        this.active.delete(mindId);
      }
    });

    // Chain always resolves so subsequent enqueues aren't blocked by errors
    this.chains.set(mindId, next.then(() => { /* noop */ }, () => { /* noop */ }));

    return promise;
  }

  isBusy(mindId: string): boolean {
    return this.active.has(mindId);
  }
}
