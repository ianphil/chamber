import { ipcMain, dialog, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { IPC } from '@chamber/shared';
import type { ChatService } from '@chamber/services';
import type { ConversationExportFormat, ConversationExportResult } from '@chamber/shared/types';

const EXPORT_DIALOG_FILTERS: Record<ConversationExportFormat, { name: string; extensions: string[] }> = {
  markdown: { name: 'Markdown', extensions: ['md'] },
  json: { name: 'JSON', extensions: ['json'] },
};

function normalizeExportFormat(format: ConversationExportFormat): ConversationExportFormat {
  return format === 'json' ? 'json' : 'markdown';
}

export function setupConversationHistoryIPC(chatService: ChatService): void {
  ipcMain.handle(IPC.CONVERSATION_HISTORY.LIST, async (_event, mindId: string) =>
    chatService.listConversationHistory(mindId));

  ipcMain.handle(IPC.CONVERSATION_HISTORY.RESUME, async (_event, mindId: string, sessionId: string) =>
    chatService.resumeConversation(mindId, sessionId));

  ipcMain.handle(IPC.CONVERSATION_HISTORY.RENAME, async (_event, mindId: string, sessionId: string, title: string) =>
    chatService.renameConversation(mindId, sessionId, title));

  ipcMain.handle(IPC.CONVERSATION_HISTORY.DELETE, async (_event, mindId: string, sessionId: string) =>
    chatService.deleteConversation(mindId, sessionId));

  ipcMain.handle(IPC.CONVERSATION_HISTORY.MESSAGES, async (_event, mindId: string, sessionId: string) =>
    chatService.getConversationMessages(mindId, sessionId));

  ipcMain.handle(
    IPC.CONVERSATION_HISTORY.EXPORT,
    async (event, mindId: string, sessionId: string, format: ConversationExportFormat): Promise<ConversationExportResult> => {
      const normalizedFormat = normalizeExportFormat(format);
      // Resolve the file name cheaply and show the save dialog before reading or
      // serializing the transcript, so a cancel costs no expensive work.
      const filename = chatService.getConversationExportFilename(mindId, sessionId, normalizedFormat);

      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Export conversation',
        defaultPath: filename,
        filters: [EXPORT_DIALOG_FILTERS[normalizedFormat], { name: 'All Files', extensions: ['*'] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return { status: 'canceled' };
      }

      const conversationExport = await chatService.exportConversation(mindId, sessionId, normalizedFormat);
      await writeFile(result.filePath, conversationExport.content, 'utf-8');
      return { status: 'saved', path: result.filePath, format: normalizedFormat };
    },
  );
}
