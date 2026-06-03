import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = process.cwd();

describe('A2A runtime invariants', () => {
  it('desktop production wiring supplies the A2A bridge handler and per-mind ttasks store', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'src', 'main.ts'), 'utf8');

    expect(source).toContain('const ttasksStoresByMindPath = new Map<string, SqliteStore>();');
    expect(source).toContain('const createTTasksStore = (mindPath: string): SqliteStore => {');
    expect(source).toContain('ttasksStoresByMindPath.set(mindPath, store);');
    expect(source).toContain('const closeTTasksStores = (): void => {');
    expect(source).toContain('store.close();');
    expect(source).toContain('closeTTasksStores();');
    expect(source).toContain('new TaskManager(mindManager, agentCardRegistry, {');
    expect(source).toContain('createTTasksStore: (mindId) => {');
    expect(source).toContain('onA2a: async ({ mindId, recipient, message, contextId, referenceTaskIds }) => {');
    expect(source).toContain('new SqliteStore');
  });

  it('persisted A2A ttasks rows use the registered chamber:a2a handler payload shape', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'a2a', 'TaskManager.ts'), 'utf8');

    expect(source).toContain("TTasksTask.custom('chamber:a2a', JSON.stringify({");
    expect(source).toContain('recipient: request.recipient,');
    expect(source).toContain('message: getMessageText(request.message),');
    expect(source).toContain('contextId: task.contextId,');
    expect(source).toContain('referenceTaskIds: request.message.referenceTaskIds,');
  });

  it('A2A task persistence stays best-effort when ttasks storage fails', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'a2a', 'TaskManager.ts'), 'utf8');

    expect(source).toContain('private persistTTasksTask(task: A2ATask, targetMindId: string, request: SendTaskRequest): void {');
    expect(source).toContain('try {');
    expect(source).toContain('log.warn(`Failed to persist ttasks row for A2A task ${task.id}:`, err);');
    expect(source).toContain('private persistTTasksResult(task: A2ATask, state: TaskState): void {');
    expect(source).toContain('log.warn(`Failed to update ttasks row for A2A task ${task.id}:`, err);');
  });

  it('terminal cleanup evicts ttasks and session state after A2A task completion', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'a2a', 'TaskManager.ts'), 'utf8');

    expect(source).toContain('private evictOldTasks(): void {');
    expect(source).toContain('this.ttasksTasks.delete(id);');
    expect(source).toContain('private cleanupTaskResources(taskId: string): void {');
    expect(source).toContain('this.pendingInputs.delete(taskId);');
    expect(source).toContain('this.taskTargets.delete(taskId);');
    expect(source).toContain('this.sessions.delete(taskId);');
    expect(source).toContain('this.ttasksTasks.delete(taskId);');
  });
});
