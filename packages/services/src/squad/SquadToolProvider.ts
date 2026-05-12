import type { ChamberToolProvider } from '../chamberTools';
import type { Tool } from '../mind/types';
import type { SquadRoomService } from './SquadRoomService';

const MAX_TOOL_RESPONSE_CHARS = 8_000;

interface SessionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export class SquadToolProvider implements ChamberToolProvider {
  constructor(private readonly squadRoomService: SquadRoomService) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getToolsForMind(mindId: string, _mindPath: string): Tool[] {
    const getActiveRoom: SessionTool = {
      name: 'squad_get_active_room',
      description: 'Return the currently selected Squad Room, including repo path, status, coordinator, and members.',
      parameters: { type: 'object', properties: {} },
      handler: async () => this.squadRoomService.getActiveRoom(),
    };

    const listAgents: SessionTool = {
      name: 'squad_list_agents',
      description: 'List the coordinator and members in the currently selected Squad Room.',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        const room = await this.squadRoomService.getActiveRoom();
        if (room.status !== 'ready') return { error: room.lastError ?? 'No ready Squad Room is selected.', status: room.status };
        return {
          coordinator: room.coordinator,
          agents: room.agents,
        };
      },
    };

    const send: SessionTool = {
      name: 'squad_send',
      description: 'Send a prompt to the active Squad Room coordinator or a named Squad member.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Prompt to send to the active Squad Room' },
          target_agent_name: { type: 'string', description: 'Optional Squad member name. Omit to use the coordinator.' },
        },
        required: ['prompt'],
      },
      handler: async (args) => {
        const prompt = typeof args.prompt === 'string' ? args.prompt : '';
        const targetAgentName = typeof args.target_agent_name === 'string' ? args.target_agent_name : undefined;
        const room = await this.squadRoomService.getActiveRoom();
        if (room.status !== 'ready' || !room.repoPath) {
          return { success: false, reason: 'room-not-ready', error: room.lastError ?? 'No ready Squad Room is selected.' };
        }

        const result = await this.squadRoomService.send({
          roomId: room.id,
          repoPath: room.repoPath,
          prompt,
          ...(targetAgentName ? { targetAgentName } : {}),
          requestedBy: { kind: 'chamber-mind', id: mindId, name: mindId },
        });
        if (!result.success) return result;

        return {
          success: true,
          turnId: result.turnId,
          response: truncate(result.message.content),
        };
      },
    };

    return [getActiveRoom, listAgents, send] as Tool[];
  }
}

function truncate(value: string): string {
  return value.length > MAX_TOOL_RESPONSE_CHARS
    ? `${value.slice(0, MAX_TOOL_RESPONSE_CHARS)}\n...`
    : value;
}
