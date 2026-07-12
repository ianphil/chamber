import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(async () => undefined),
}));

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { IpcMainInvokeEvent } from 'electron';
import { setupConversationHistoryIPC } from './conversationHistory';
import type { ChatService } from '@chamber/services';
import type { ConversationExport } from '@chamber/shared/types';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const EVT = { sender: {} } as IpcMainInvokeEvent;

const markdownExport: ConversationExport = {
  format: 'markdown',
  filename: 'planning.md',
  content: '# Planning\n',
};

function handlerFor(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((entry) => entry[0] === channel);
  if (!call) throw new Error(`No handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}

function createChatService(overrides: Partial<ChatService> = {}): ChatService {
  return {
    listConversationHistory: vi.fn(() => []),
    resumeConversation: vi.fn(async () => ({ sessionId: '', messages: [], conversations: [] })),
    renameConversation: vi.fn(() => []),
    deleteConversation: vi.fn(async () => ({ sessionId: '', messages: [], conversations: [] })),
    getConversationMessages: vi.fn(async () => []),
    getConversationExportFilename: vi.fn(() => markdownExport.filename),
    exportConversation: vi.fn(async () => markdownExport),
    ...overrides,
  } as unknown as ChatService;
}

describe('setupConversationHistoryIPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1 } as never);
  });

  it('registers list, resume, rename, delete, messages, and export handlers', () => {
    setupConversationHistoryIPC(createChatService());

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((entry) => entry[0]);

    expect(channels).toEqual(expect.arrayContaining([
      'conversationHistory:list',
      'conversationHistory:resume',
      'conversationHistory:rename',
      'conversationHistory:delete',
      'conversationHistory:messages',
      'conversationHistory:export',
    ]));
  });

  it('messages handler delegates to chatService.getConversationMessages', async () => {
    const messages = [{ id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'hi' }], timestamp: 1 }];
    const chatService = createChatService({ getConversationMessages: vi.fn(async () => messages) as never });
    setupConversationHistoryIPC(chatService);

    const result = await handlerFor('conversationHistory:messages')(EVT, 'mind-1', 'session-1');

    expect(chatService.getConversationMessages).toHaveBeenCalledWith('mind-1', 'session-1');
    expect(result).toBe(messages);
  });

  it('export handler serializes, writes the chosen file, and returns the saved path', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: 'C:/tmp/planning.md' } as never);
    const chatService = createChatService();
    setupConversationHistoryIPC(chatService);

    const result = await handlerFor('conversationHistory:export')(EVT, 'mind-1', 'session-1', 'markdown');

    expect(chatService.getConversationExportFilename).toHaveBeenCalledWith('mind-1', 'session-1', 'markdown');
    expect(chatService.exportConversation).toHaveBeenCalledWith('mind-1', 'session-1', 'markdown');
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: 'planning.md' }),
    );
    expect(writeFile).toHaveBeenCalledWith('C:/tmp/planning.md', '# Planning\n', 'utf-8');
    expect(result).toEqual({ status: 'saved', path: 'C:/tmp/planning.md', format: 'markdown' });
  });

  it('export handler shows the save dialog before doing expensive transcript work', async () => {
    const order: string[] = [];
    vi.mocked(dialog.showSaveDialog).mockImplementation(async () => {
      order.push('dialog');
      return { canceled: true, filePath: undefined } as never;
    });
    const chatService = createChatService({
      exportConversation: vi.fn(async () => { order.push('export'); return markdownExport; }) as never,
    });
    setupConversationHistoryIPC(chatService);

    await handlerFor('conversationHistory:export')(EVT, 'mind-1', 'session-1', 'markdown');

    expect(order).toEqual(['dialog']);
    expect(chatService.exportConversation).not.toHaveBeenCalled();
  });

  it('export handler returns canceled and writes nothing when the dialog is dismissed', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never);
    const chatService = createChatService();
    setupConversationHistoryIPC(chatService);

    const result = await handlerFor('conversationHistory:export')(EVT, 'mind-1', 'session-1', 'markdown');

    expect(writeFile).not.toHaveBeenCalled();
    expect(chatService.exportConversation).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'canceled' });
  });

  it('export handler normalizes the json format and requests it from the service', async () => {
    const jsonExport: ConversationExport = { format: 'json', filename: 'planning.json', content: '{}\n' };
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: 'C:/tmp/planning.json' } as never);
    const chatService = createChatService({
      getConversationExportFilename: vi.fn(() => 'planning.json') as never,
      exportConversation: vi.fn(async () => jsonExport) as never,
    });
    setupConversationHistoryIPC(chatService);

    const result = await handlerFor('conversationHistory:export')(EVT, 'mind-1', 'session-1', 'json');

    expect(chatService.exportConversation).toHaveBeenCalledWith('mind-1', 'session-1', 'json');
    expect(writeFile).toHaveBeenCalledWith('C:/tmp/planning.json', '{}\n', 'utf-8');
    expect(result).toEqual({ status: 'saved', path: 'C:/tmp/planning.json', format: 'json' });
  });
});
