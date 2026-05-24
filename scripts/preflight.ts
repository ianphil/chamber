#!/usr/bin/env node
import {
  Task,
  TaskContext,
  TaskEvent,
  TaskGraph,
  TaskStatus,
  TaskType,
  makeDefaultExecutor,
} from '../packages/services/src/tasks/index';

function bash(title: string, payload: string, timeout: number | null = null): Task {
  return new Task({ title, payload, type: TaskType.Bash, timeout });
}

function printEvent(event: TaskEvent): void {
  const previous = event.previousStatus ?? 'none';
  const error = event.error ? ` error=${JSON.stringify(event.error)}` : '';
  console.log(
    `event: ${event.type.padEnd(9)} task=${JSON.stringify(event.task.title)} ${previous}->${event.status}${error}`,
  );
}

function clip(text: string | undefined, limit = 4_000): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... <truncated ${text.length - limit} characters>`;
}

function indent(text: string): string {
  return text.split('\n').map((line) => `    ${line}`).join('\n');
}

function makeRecommendationHandler() {
  return (context: TaskContext): string => {
    const tasks = [...context.upstream.values()];
    const failed = tasks.filter((task) => task.status === TaskStatus.Failed);
    const blocked = tasks.filter((task) => task.result === null && task.status === TaskStatus.Pending);

    const lines = [
      'Chamber preflight recommendation:',
      '',
    ];

    if (failed.length === 0 && blocked.length === 0) {
      lines.push('All required checks completed successfully. The branch looks ready from this local preflight.');
    } else {
      lines.push(`${failed.length} check(s) failed and ${blocked.length} check(s) were blocked or not run.`);
      lines.push('Fix the first failing required check, then rerun the preflight.');
    }

    lines.push('');
    lines.push('Check results:');
    for (const task of tasks) {
      const result = task.result;
      const duration = result ? `${result.duration.toFixed(2)}s` : '-';
      lines.push(`- ${task.title}: ${task.status} (${duration})`);
      if (task.status === TaskStatus.Failed && result?.error) {
        lines.push(`  error: ${clip(result.error, 500).replaceAll('\n', '\n  ')}`);
      }
    }

    return lines.join('\n');
  };
}

function buildGraph(): TaskGraph {
  const graph = new TaskGraph(undefined, { title: 'Chamber preflight' });

  const typecheck = bash('Type check', 'npm run typecheck', 180);
  const taskTests = bash(
    'Task module tests',
    'npm test -- --run packages/services/src/tasks',
    180,
  );

  for (const task of [typecheck, taskTests]) {
    graph.set(task, []);
  }

  const recommendation = new Task({
    title: 'Preflight recommendation',
    payload: 'Summarize upstream preflight results.',
    type: TaskType.Prompt,
    timeout: 30,
  });
  graph.addFinally(recommendation, {
    after: [typecheck, taskTests],
    required: false,
  });

  return graph;
}

function printSummary(graph: TaskGraph): void {
  console.log('\npreflight summary');
  console.log(`ok: ${graph.ok}`);

  for (const task of graph) {
    const result = task.result;
    const duration = result ? `${result.duration.toFixed(2)}s` : '-';
    console.log(`${task.status.padEnd(9)} ${duration.padStart(8)}  ${task.title}`);

    if (task.status === TaskStatus.Failed && result) {
      if (result.output) {
        console.log('  stdout:');
        console.log(indent(clip(result.output).trimEnd()));
      }
      if (result.error) {
        console.log('  stderr/error:');
        console.log(indent(clip(result.error).trimEnd()));
      }
    } else if (task.type === TaskType.Prompt && result?.output) {
      console.log('  recommendation:');
      console.log(indent(result.output.trimEnd()));
    }
  }

  if (graph.blocked.length > 0) {
    console.log(`blocked: ${graph.blocked.map((task) => task.title).join(', ')}`);
  }
}

async function main(): Promise<number> {
  const executor = makeDefaultExecutor();
  executor.register(TaskType.Prompt, makeRecommendationHandler());
  const unsubscribe = executor.events.subscribe(printEvent);
  const graph = buildGraph();

  try {
    await graph.run(executor);
  } finally {
    unsubscribe();
  }

  printSummary(graph);
  return graph.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
