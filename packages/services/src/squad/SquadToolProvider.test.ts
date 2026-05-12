import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeSquadBridgeRunner } from './SquadBridgeRunner';
import { SquadRoomService } from './SquadRoomService';
import { SquadToolProvider } from './SquadToolProvider';

describe('SquadToolProvider', () => {
  it('reports unavailable room state', async () => {
    const provider = new SquadToolProvider(new SquadRoomService());
    const tools = provider.getToolsForMind('mind-1', 'C:\\minds\\one');

    await expect(findTool(tools, 'squad_get_active_room').handler({})).resolves.toMatchObject({
      status: 'unselected',
    });
    await expect(findTool(tools, 'squad_list_agents').handler({})).resolves.toEqual({
      error: 'No ready Squad Room is selected.',
      status: 'unselected',
    });
  });

  it('sends through the active Squad Room with mind identity', async () => {
    const repo = await createTempRepo();
    await writeSquadFixture(repo);
    const service = new SquadRoomService({ bridgeRunner: new FakeSquadBridgeRunner(['hello mind']) });
    await service.getRoom(repo);
    const provider = new SquadToolProvider(service);
    const sendTool = findTool(provider.getToolsForMind('mind-1', 'C:\\minds\\one'), 'squad_send');

    await expect(sendTool.handler({ prompt: 'help', target_agent_name: 'Trinity' })).resolves.toEqual({
      success: true,
      turnId: 'turn-1',
      response: 'hello mind',
    });
    await expect(service.history(repo)).resolves.toMatchObject([
      {
        sender: { kind: 'chamber-mind', id: 'mind-1', name: 'mind-1' },
        content: 'help',
      },
      {
        sender: { kind: 'squad-agent', id: 'Trinity', name: 'Trinity' },
        content: 'hello mind',
      },
    ]);
  });
});

function findTool(tools: ReturnType<SquadToolProvider['getToolsForMind']>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool as unknown as { handler: (args: Record<string, unknown>) => Promise<unknown> };
}

async function createTempRepo(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'chamber-squad-tool-'));
}

async function writeSquadFixture(repo: string): Promise<void> {
  const squad = path.join(repo, '.squad');
  await mkdir(squad, { recursive: true });
  await writeFile(path.join(squad, 'config.json'), '{"version":1}');
  await writeFile(path.join(squad, 'team.md'), [
    '# Squad Team',
    '',
    '## Coordinator',
    '',
    '| Name | Role | Notes |',
    '|------|------|-------|',
    '| Squad | Coordinator | Routes work |',
    '',
    '## Members',
    '',
    '| Name | Role | Charter | Status |',
    '|------|------|---------|--------|',
    '| Trinity | Frontend | agents/trinity/charter.md | ready |',
  ].join('\n'));
}
