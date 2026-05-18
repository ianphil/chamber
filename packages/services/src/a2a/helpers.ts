import { randomUUID } from 'crypto';
import { escapeXml } from '@chamber/shared/escapeXml';
import type { Message, TaskState, TaskStatus, Artifact } from './types';

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
    role: 'ROLE_USER',
    parts: [{ text, mediaType: 'text/plain' }],
    metadata: {
      fromId,
      fromName: opts?.fromName ?? fromId,
      hopCount: opts?.hopCount ?? 0,
    },
  };
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

export function generateTaskId(): string {
  return `task-${randomUUID()}`;
}

export function createTaskStatus(state: TaskState, message?: Message): TaskStatus {
  return {
    state,
    message,
    timestamp: new Date().toISOString(),
  };
}

export function createArtifact(name: string, text: string): Artifact {
  return {
    artifactId: `artifact-${randomUUID()}`,
    name,
    parts: [{ text, mediaType: 'text/plain' }],
  };
}
