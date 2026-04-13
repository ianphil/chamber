import { randomUUID } from 'crypto';
import type { Message } from './types';

export function generateMessageId(): string {
  return `msg-${randomUUID()}`;
}

export function generateContextId(): string {
  return `ctx-${randomUUID()}`;
}

export function createTextMessage(
  fromId: string,
  text: string,
  opts?: { contextId?: string; fromName?: string; hopCount?: number },
): Message {
  return {
    messageId: generateMessageId(),
    contextId: opts?.contextId,
    role: 'user',
    parts: [{ text, mediaType: 'text/plain' }],
    metadata: {
      fromId,
      fromName: opts?.fromName ?? fromId,
      hopCount: opts?.hopCount ?? 0,
    },
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function serializeMessageToXml(message: Message): string {
  const fromId = (message.metadata?.fromId as string) ?? '';
  const fromName = (message.metadata?.fromName as string) ?? '';
  const hopCount = (message.metadata?.hopCount as number) ?? 0;
  const textContent = message.parts.find((p) => p.text)?.text ?? '';

  return `<agent-message from-id="${escapeXml(fromId)}" from-name="${escapeXml(fromName)}" message-id="${escapeXml(message.messageId)}" context-id="${escapeXml(message.contextId ?? '')}" hop-count="${hopCount}" role="${message.role}">
  <content>${escapeXml(textContent)}</content>
</agent-message>`;
}
