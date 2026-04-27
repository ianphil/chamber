import type {
  AddMindResponse,
  CommandResponse,
  ListModelsResponse,
  ListMindsResponse,
  MindDto,
  ModelDto,
  SendChatRequest,
} from '@chamber/wire-contracts';

export interface AuthProgressDto {
  step: string;
  userCode?: string;
  verificationUri?: string;
  login?: string;
  error?: string;
}

export interface AuthLoginResultDto {
  success: boolean;
  login?: string;
  error?: string;
}

export interface ChamberClientOptions {
  baseUrl: string;
  token: string;
  origin?: string;
}

export class ChamberClient {
  constructor(private readonly options: ChamberClientOptions) {}

  async listMinds(): Promise<MindDto[]> {
    const body = await this.get<ListMindsResponse>('/api/mind/list');
    return body.minds;
  }

  async addMind(mindPath: string): Promise<MindDto> {
    const body = await this.post<AddMindResponse>('/api/mind/add', { mindPath });
    return body.mind;
  }

  async getConfig(): Promise<unknown> {
    return this.get('/api/config');
  }

  async listLensViews(): Promise<unknown> {
    return this.get('/api/lens/list');
  }

  async getGenesisStatus(): Promise<unknown> {
    return this.get('/api/genesis/status');
  }

  async getAuthStatus(): Promise<{ authenticated: boolean; login?: string }> {
    return this.get('/api/auth/status');
  }

  async listAuthAccounts(): Promise<Array<{ login: string }>> {
    const body = await this.get<{ accounts: Array<{ login: string }> }>('/api/auth/accounts');
    return body.accounts;
  }

  async startAuthLogin(onProgress: (progress: AuthProgressDto) => void): Promise<AuthLoginResultDto> {
    const response = await fetch(new URL('/api/auth/login', this.options.baseUrl), {
      headers: this.headers(),
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to POST /api/auth/login: ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Auth login response did not include a stream.');
    }

    let result: AuthLoginResultDto = { success: false, error: 'Authentication did not complete.' };
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as
          | { type: 'progress'; progress: AuthProgressDto }
          | { type: 'result'; result: AuthLoginResultDto };
        if (event.type === 'progress') {
          onProgress(event.progress);
        } else {
          result = event.result;
        }
      }
      if (done) break;
    }

    return result;
  }

  async switchAuthAccount(login: string): Promise<void> {
    await this.post('/api/auth/switch', { login });
  }

  async logoutAuth(): Promise<void> {
    await this.post('/api/auth/logout', {});
  }

  async listChamberTools(): Promise<unknown> {
    return this.get('/api/chamber-tools/list');
  }

  async uploadAttachment(file: Blob, name: string): Promise<unknown> {
    const response = await fetch(new URL(`/api/attachments?name=${encodeURIComponent(name)}`, this.options.baseUrl), {
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(this.options.origin ? { origin: this.options.origin } : {}),
      },
      method: 'POST',
      body: file,
    });
    return readJson(response, 'upload attachment');
  }

  async cancelChat(sessionId: string): Promise<CommandResponse> {
    return this.post('/api/chat/cancel', { sessionId });
  }

  async sendChat(request: SendChatRequest): Promise<CommandResponse> {
    return this.post('/api/chat/send', request);
  }

  async startNewConversation(mindId: string): Promise<CommandResponse> {
    return this.post('/api/chat/new', { mindId });
  }

  async listModels(mindId?: string): Promise<ModelDto[]> {
    const query = mindId ? `?mindId=${encodeURIComponent(mindId)}` : '';
    const body = await this.get<ListModelsResponse>(`/api/chat/models${query}`);
    return body.models;
  }

  private async get<TBody = unknown>(path: string): Promise<TBody> {
    const response = await fetch(new URL(path, this.options.baseUrl), {
      headers: this.headers(),
    });
    return readJson<TBody>(response, `GET ${path}`);
  }

  private async post<TBody = unknown>(path: string, body: unknown): Promise<TBody> {
    const response = await fetch(new URL(path, this.options.baseUrl), {
      headers: { ...this.headers(), 'content-type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(body),
    });
    return readJson<TBody>(response, `POST ${path}`);
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.token}`,
      ...(this.options.origin ? { origin: this.options.origin } : {}),
    };
  }
}

async function readJson<TBody>(response: Response, operation: string): Promise<TBody> {
  if (!response.ok) {
    throw new Error(`Failed to ${operation}: ${response.status}`);
  }
  return response.json() as Promise<TBody>;
}
