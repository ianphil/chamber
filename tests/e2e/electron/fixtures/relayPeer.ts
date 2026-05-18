import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

type RelayMessagePayload = {
  recipient?: string;
  message: {
    messageId: string;
    contextId?: string;
    role: string;
    parts: Array<{ text?: string; mediaType?: string }>;
    metadata?: { fromId?: string; fromName?: string };
  };
};

export interface RelayPeerInboxEntry {
  id: string;
  receivedAt: string;
  read: boolean;
  recipient?: string;
  sender: { id: string; name: string };
  contextId?: string;
  taskId?: string;
  text: string;
  message: RelayMessagePayload['message'];
}

interface ToolHandler {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

interface A2AClientToolsModule {
  createA2ATools: (
    state: Record<string, unknown>,
    hooks: { onMessage: (payload: RelayMessagePayload) => RelayPeerInboxEntry | void },
  ) => ToolHandler[];
  disconnectA2AClient: (state: Record<string, unknown>) => Promise<void>;
  pollA2AMessages: (
    state: Record<string, unknown>,
    hooks: { onMessage: (payload: RelayMessagePayload) => RelayPeerInboxEntry | void },
  ) => Promise<void>;
}

export interface RelayPeerOptions {
  relayUrl: string;
  agentName: string;
  token?: string;
  authMode?: 'static' | 'auto' | 'interactive';
  clientId?: string;
  tenantId?: string;
  scope?: string;
  loginHint?: string;
  domainHint?: string;
  /**
   * Path to a JSON file holding `{ refreshToken }` so subsequent runs don't
   * prompt for interactive Entra login. The peer reads it before connect and
   * writes it back after a successful auth-code or refresh exchange.
   */
  refreshTokenCachePath?: string;
}

/**
 * Test peer that registers as an A2A agent on a Switchboard relay using the
 * same a2a-client tools that the Copilot CLI extension uses. The handlers
 * speak plain HTTP to the relay — no Copilot SDK session is required, so
 * tests can drive the peer deterministically without spending tokens.
 *
 * Lifecycle:
 *   const peer = new RelayPeer({ relayUrl, agentName: 'SmokeBot-A', token });
 *   await peer.connect();
 *   await peer.sendTo('MindB', 'hello');
 *   const reply = await peer.waitForMessage((m) => m.text.includes('hi'));
 *   await peer.disconnect();
 */
export class RelayPeer {
  readonly inbox: RelayPeerInboxEntry[] = [];
  private tools: ToolHandler[] = [];
  private disconnectA2AClient: A2AClientToolsModule['disconnectA2AClient'] | undefined;
  private pollA2AMessages: A2AClientToolsModule['pollA2AMessages'] | undefined;
  // The a2a-tools polling loop reads/writes this state shape directly.
  private readonly state: Record<string, unknown> & { agentName: string };
  private readonly refreshTokenCachePath: string | undefined;
  private pollLoop: { stop: () => void } | undefined;

  constructor(options: RelayPeerOptions) {
    const clientId = options.clientId ?? '074530a3-b6c5-41c8-896c-4a6651bf5f16';
    this.refreshTokenCachePath = options.refreshTokenCachePath;
    const cachedRefreshToken = readRefreshTokenCache(this.refreshTokenCachePath);
    this.state = {
      chamberBaseUrl: options.relayUrl.replace(/\/$/, ''),
      chamberToken: options.token ?? '',
      authMode: options.authMode ?? (options.token ? 'static' : 'auto'),
      entraClientId: clientId,
      entraTenantId: options.tenantId ?? 'common',
      entraScope: options.scope ?? `api://${clientId}/user_impersonation`,
      entraLoginHint: options.loginHint,
      entraDomainHint: options.domainHint,
      accessToken: null,
      refreshToken: cachedRefreshToken,
      accessTokenExpiresAt: 0,
      tokenRequest: null,
      agentName: options.agentName,
      registeredAgentName: null,
      inbox: [],
      session: { log: () => undefined },
    };

  }

  async connect(): Promise<void> {
    const a2aClient = await loadA2AClientTools();
    this.disconnectA2AClient = a2aClient.disconnectA2AClient;
    this.pollA2AMessages = a2aClient.pollA2AMessages;
    this.tools = a2aClient.createA2ATools(this.state, {
      onMessage: (payload: RelayMessagePayload) => this.recordMessage(payload),
    }) as ToolHandler[];

    await this.callTool('a2a_connection', {});
    this.persistRefreshToken();
    // a2a-tools.mjs starts its own setTimeout poll loop on connect.
    // Stop it and replace with a tighter loop so tests don't wait 1s per poll.
    const existingTimer = this.state.pollTimer as ReturnType<typeof setTimeout> | null;
    if (existingTimer) clearTimeout(existingTimer);
    this.state.pollTimer = null;

    let cancelled = false;
    const loop = async (): Promise<void> => {
      while (!cancelled) {
        try {
          await this.pollA2AMessages!(this.state, {
            onMessage: (payload: RelayMessagePayload) => this.recordMessage(payload),
          });
        } catch {
          // Swallow transient poll errors; tests assert on inbox state.
        }
        await delay(250);
      }
    };
    void loop();
    this.pollLoop = { stop: () => { cancelled = true; } };
  }

  async sendTo(recipient: string, message: string, contextId?: string): Promise<unknown> {
    return this.callTool('a2a_send_agent_message', { recipient, message, context_id: contextId });
  }

  async listAgents(): Promise<{ agents?: Array<{ name?: string; id?: string }> }> {
    return this.callTool('a2a_list_remote_agents', {}) as Promise<{ agents?: Array<{ name?: string; id?: string }> }>;
  }

  async waitForMessage(
    predicate: (entry: RelayPeerInboxEntry) => boolean,
    options: { timeoutMs?: number } = {},
  ): Promise<RelayPeerInboxEntry> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = this.inbox.find(predicate);
      if (match) return match;
      await delay(150);
    }
    throw new Error(`RelayPeer(${this.state.agentName}): no inbox entry matched within ${timeoutMs}ms. Inbox: ${JSON.stringify(this.inbox, null, 2)}`);
  }

  clearInbox(): void {
    this.inbox.length = 0;
  }

  get agentName(): string {
    return this.state.agentName;
  }

  async disconnect(): Promise<void> {
    this.pollLoop?.stop();
    this.pollLoop = undefined;
    this.persistRefreshToken();
    await this.disconnectA2AClient?.(this.state).catch(() => undefined);
  }

  private recordMessage(payload: RelayMessagePayload): RelayPeerInboxEntry {
    const fromName = payload.message?.metadata?.fromName ?? payload.message?.metadata?.fromId ?? 'A2A peer';
    const fromId = payload.message?.metadata?.fromId ?? fromName;
    const text = payload.message?.parts?.find((part) => typeof part.text === 'string')?.text ?? '';
    const entry: RelayPeerInboxEntry = {
      id: payload.message.messageId,
      receivedAt: new Date().toISOString(),
      read: false,
      recipient: payload.recipient,
      sender: { id: String(fromId), name: String(fromName) },
      contextId: payload.message.contextId,
      text,
      message: payload.message,
    };
    if (!this.inbox.some((existing) => existing.id === entry.id)) {
      this.inbox.push(entry);
    }
    return entry;
  }

  private persistRefreshToken(): void {
    if (!this.refreshTokenCachePath) return;
    const refreshToken = this.state.refreshToken as string | null;
    if (!refreshToken) return;
    try {
      fs.mkdirSync(path.dirname(this.refreshTokenCachePath), { recursive: true });
      fs.writeFileSync(this.refreshTokenCachePath, JSON.stringify({ refreshToken }), { mode: 0o600 });
    } catch {
      // Cache is a best-effort optimization; ignore write failures.
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`RelayPeer: unknown tool "${name}"`);
    return tool.handler(args);
  }
}

function readRefreshTokenCache(filePath: string | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { refreshToken?: string };
    return typeof parsed.refreshToken === 'string' && parsed.refreshToken.length > 0 ? parsed.refreshToken : null;
  } catch {
    return null;
  }
}

async function loadA2AClientTools(): Promise<A2AClientToolsModule> {
  const toolsPath = resolveA2AClientToolsPath();
  return import(pathToFileURL(toolsPath).href) as Promise<A2AClientToolsModule>;
}

function resolveA2AClientToolsPath(): string {
  const explicitDir = process.env.A2A_CLIENT_EXTENSION_DIR;
  const copilotHome = process.env.COPILOT_HOME ?? path.join(os.homedir(), '.copilot');
  const candidates = [
    explicitDir ? path.join(explicitDir, 'tools', 'a2a-tools.mjs') : '',
    path.join(copilotHome, 'extensions', 'a2a-client', 'tools', 'a2a-tools.mjs'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'a2a-client', 'extensions', 'a2a-client', 'tools', 'a2a-tools.mjs'),
  ].filter(Boolean);

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error(
      `A2A client tools not found. Install https://github.com/ipdelete/a2a-client or set A2A_CLIENT_EXTENSION_DIR. Checked: ${candidates.join(', ')}`,
    );
  }
  return match;
}
