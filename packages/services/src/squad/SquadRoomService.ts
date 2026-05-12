import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  SquadAgentSummary,
  SquadDecisionSummary,
  SquadRoomEvent,
  SquadRoomMessage,
  SquadRoomTranscript,
  SquadRoomSnapshot,
  SquadRoutingRule,
  SquadSendRequest,
  SquadSendResult,
} from '@chamber/shared/squad-types';
import { UnavailableSquadBridgeRunner, type SquadBridgeRunner } from './SquadBridgeRunner';

const SQUAD_DIR_NAME = '.squad';
const MAX_TEXT_PREVIEW = 20_000;

interface SquadRoomServiceOptions {
  transcriptRoot?: string;
  bridgeRunner?: SquadBridgeRunner;
  now?: () => number;
}

export class SquadRoomService {
  private readonly bridgeRunner: SquadBridgeRunner;
  private readonly transcriptRoot: string | null;
  private readonly now: () => number;
  private readonly memoryTranscripts = new Map<string, SquadRoomTranscript>();
  private readonly activeRooms = new Set<string>();
  private readonly events = new EventEmitter();
  private activeRepoPath: string | null = null;

  constructor(options: SquadRoomServiceOptions = {}) {
    this.bridgeRunner = options.bridgeRunner ?? new UnavailableSquadBridgeRunner();
    this.transcriptRoot = options.transcriptRoot ?? null;
    this.now = options.now ?? Date.now;
  }

  async getRoom(repoPath?: string | null): Promise<SquadRoomSnapshot> {
    if (!repoPath?.trim() && this.activeRepoPath) {
      return this.getRoom(this.activeRepoPath);
    }
    if (!repoPath?.trim()) return this.createUnselectedSnapshot();

    try {
      const normalizedRepoPath = await resolveRepositoryPath(repoPath);
      this.activeRepoPath = normalizedRepoPath;
      const repoName = path.basename(normalizedRepoPath);
      const squadPath = path.join(normalizedRepoPath, SQUAD_DIR_NAME);
      const configPath = path.join(squadPath, 'config.json');

      if (!(await pathExists(squadPath))) {
        return {
          ...this.createBaseSnapshot(normalizedRepoPath),
          repoName,
          status: 'missing',
          lastError: null,
        };
      }

      const config = await readSquadConfig(configPath);
      const teamMarkdown = await readOptionalText(path.join(squadPath, 'team.md'));
      const routingMarkdown = await readOptionalText(path.join(squadPath, 'routing.md'));
      const decisionsMarkdown = await readOptionalText(path.join(squadPath, 'decisions.md'));
      const directives = await readOptionalText(path.join(squadPath, 'directives.md'));
      const team = parseTeamMarkdown(teamMarkdown);

      return {
        id: normalizedRepoPath,
        repoPath: normalizedRepoPath,
        repoName,
        squadPath,
        status: 'ready',
        version: config.version,
        coordinator: team.coordinator,
        agents: team.agents,
        routingRules: parseRoutingRules(routingMarkdown),
        decisions: parseDecisionSummaries(decisionsMarkdown),
        directives,
        sessions: await listSessionNames(path.join(squadPath, 'sessions')),
        lastError: null,
      };
    } catch (error) {
      return {
        ...this.createBaseSnapshot(repoPath),
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getActiveRoom(): Promise<SquadRoomSnapshot> {
    return this.getRoom();
  }

  private createUnselectedSnapshot(): SquadRoomSnapshot {
    return {
      id: 'unselected',
      repoPath: null,
      repoName: null,
      squadPath: null,
      status: 'unselected',
      version: null,
      coordinator: null,
      agents: [],
      routingRules: [],
      decisions: [],
      directives: null,
      sessions: [],
      lastError: null,
    };
  }

  private createBaseSnapshot(repoPath: string): SquadRoomSnapshot {
    return {
      id: repoPath,
      repoPath,
      repoName: path.basename(repoPath),
      squadPath: path.join(repoPath, SQUAD_DIR_NAME),
      status: 'missing',
      version: null,
      coordinator: null,
      agents: [],
      routingRules: [],
      decisions: [],
      directives: null,
      sessions: [],
      lastError: null,
    };
  }

  async history(roomId: string): Promise<SquadRoomMessage[]> {
    const transcript = await this.readTranscript(roomId, roomId);
    return transcript.messages;
  }

  async clear(roomId: string): Promise<void> {
    if (this.transcriptRoot) {
      await fs.rm(this.transcriptPath(roomId), { force: true });
    }
    this.memoryTranscripts.delete(roomId);
  }

  async send(request: SquadSendRequest): Promise<SquadSendResult> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      return { success: false, reason: 'failed', error: 'Squad prompt cannot be empty.' };
    }

    const room = await this.getRoom(request.repoPath);
    if (room.status !== 'ready' || !room.repoPath) {
      return {
        success: false,
        reason: 'room-not-ready',
        error: room.lastError ?? 'Selected repository does not have a ready Squad.',
      };
    }
    if (this.activeRooms.has(room.id)) {
      return { success: false, reason: 'busy', error: 'Squad Room already has an active turn.' };
    }

    this.activeRooms.add(room.id);
    const userMessage = createUserMessage(room.id, prompt, request.requestedBy, this.now());
    await this.appendMessages(room.id, room.repoPath, [userMessage]);

    try {
      const result = await this.bridgeRunner.send(
        { ...request, roomId: room.id, repoPath: room.repoPath, prompt },
        { onEvent: (event) => this.emitEvent(event) },
      );
      if (result.success) {
        await this.appendMessages(room.id, room.repoPath, [result.message]);
      } else {
        this.emitEvent({
          type: 'error',
          roomId: room.id,
          turnId: null,
          message: result.error,
        });
      }
      return result;
    } finally {
      this.activeRooms.delete(room.id);
    }
  }

  async stop(turnId: string): Promise<void> {
    await this.bridgeRunner.stop(turnId);
  }

  onEvent(callback: (event: SquadRoomEvent) => void): () => void {
    this.events.on('event', callback);
    return () => this.events.off('event', callback);
  }

  private emitEvent(event: SquadRoomEvent): void {
    this.events.emit('event', event);
  }

  private async appendMessages(roomId: string, repoPath: string, messages: SquadRoomMessage[]): Promise<void> {
    const transcript = await this.readTranscript(roomId, repoPath);
    transcript.messages.push(...messages);
    await this.writeTranscript(transcript);
  }

  private async readTranscript(roomId: string, repoPath: string): Promise<SquadRoomTranscript> {
    if (!this.transcriptRoot) {
      return this.memoryTranscripts.get(roomId) ?? { version: 1, roomId, repoPath, messages: [] };
    }

    try {
      const raw = await fs.readFile(this.transcriptPath(roomId), 'utf8');
      const parsed = JSON.parse(raw) as SquadRoomTranscript;
      if (parsed.version !== 1 || !Array.isArray(parsed.messages)) {
        throw new Error('Invalid Squad transcript format.');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, roomId, repoPath, messages: [] };
      }
      throw error;
    }
  }

  private async writeTranscript(transcript: SquadRoomTranscript): Promise<void> {
    if (!this.transcriptRoot) {
      this.memoryTranscripts.set(transcript.roomId, transcript);
      return;
    }

    await fs.mkdir(this.transcriptRoot, { recursive: true });
    await fs.writeFile(this.transcriptPath(transcript.roomId), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  }

  private transcriptPath(roomId: string): string {
    if (!this.transcriptRoot) throw new Error('Transcript root is not configured.');
    const key = createHash('sha256').update(roomId).digest('hex');
    return path.join(this.transcriptRoot, `${key}.json`);
  }
}

function createUserMessage(
  roomId: string,
  content: string,
  requestedBy: SquadSendRequest['requestedBy'],
  timestamp: number,
): SquadRoomMessage {
  return {
    id: randomUUID(),
    roomId,
    turnId: null,
    role: requestedBy?.kind === 'chamber-mind' ? 'assistant' : 'user',
    sender: requestedBy ?? { kind: 'user', id: 'user', name: 'User' },
    content,
    timestamp,
  };
}

export async function resolveRepositoryPath(repoPath: string): Promise<string> {
  if (!path.isAbsolute(repoPath)) {
    throw new Error('Repository path must be absolute.');
  }

  const resolved = path.resolve(repoPath);
  if (resolved.split(path.sep).includes('.working-memory')) {
    throw new Error('Squad Room cannot open agent-managed .working-memory directories.');
  }

  const real = await fs.realpath(resolved);
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new Error('Repository path must be a directory.');
  }
  return real;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readSquadConfig(configPath: string): Promise<{ version: number }> {
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'number') {
    throw new Error('Invalid .squad/config.json: expected numeric version.');
  }
  return { version: parsed.version };
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text.length > MAX_TEXT_PREVIEW ? `${text.slice(0, MAX_TEXT_PREVIEW)}\n...` : text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function parseTeamMarkdown(markdown: string | null): { coordinator: SquadAgentSummary | null; agents: SquadAgentSummary[] } {
  if (!markdown) return { coordinator: null, agents: [] };

  const coordinatorRows = parseMarkdownTableRows(section(markdown, 'Coordinator'));
  const memberRows = parseMarkdownTableRows(section(markdown, 'Members'));

  return {
    coordinator: coordinatorRows[0] ? toAgent(coordinatorRows[0], false) : null,
    agents: memberRows.map((row) => toAgent(row, true)),
  };
}

function toAgent(row: string[], hasStatus: boolean): SquadAgentSummary {
  return {
    name: row[0] ?? '',
    role: row[1] ?? '',
    charterPath: hasStatus ? row[2] || null : null,
    status: hasStatus ? row[3] || null : row[2] || null,
  };
}

function parseRoutingRules(markdown: string | null): SquadRoutingRule[] {
  return parseMarkdownTableRows(section(markdown ?? '', 'Routing Table')).map((row) => ({
    workType: row[0] ?? '',
    routeTo: row[1] ?? '',
    examples: row[2] ?? '',
  }));
}

function parseDecisionSummaries(markdown: string | null): SquadDecisionSummary[] {
  if (!markdown) return [];
  const active = section(markdown, 'Active Decisions');
  if (/No decisions recorded yet\./i.test(active)) return [];

  const decisions: SquadDecisionSummary[] = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of active.split(/\r?\n/)) {
    const heading = /^#{3,}\s+(.+)$/.exec(line.trim());
    if (heading) {
      if (current) decisions.push({ title: current.title, body: current.body.join('\n').trim() });
      current = { title: heading[1]?.trim() || 'Decision', body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) decisions.push({ title: current.title, body: current.body.join('\n').trim() });
  return decisions;
}

function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) return '';

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) break;
    body.push(line);
  }
  return body.join('\n');
}

function parseMarkdownTableRows(markdown: string): string[][] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length > 1 && !cells.every((cell) => /^-+$/.test(cell)) && !isHeaderRow(cells));
}

function isHeaderRow(cells: string[]): boolean {
  const headers = new Set(['name', 'role', 'notes', 'charter', 'status', 'work type', 'route to', 'examples']);
  return cells.every((cell) => headers.has(cell.toLowerCase()));
}

async function listSessionNames(sessionsPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(sessionsPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
