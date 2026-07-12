import type { ChatEvent, ChatMessage, ContentBlock } from './types';

/**
 * Fold a single {@link ChatEvent} into a {@link ChatMessage}, returning the
 * updated message. This is the one source of truth for how streaming chat
 * events accumulate into ordered content blocks, shared by the renderer's live
 * chat reducer and the main-process session-history transcript mapper so that a
 * resumed, exported, or searched conversation renders exactly like live chat.
 *
 * The function is pure: it never mutates `message`. When an event does not
 * change anything (unknown tool/permission id, duplicate permission request,
 * already-reconciled final message), the original `message` reference is
 * returned so callers can rely on referential equality to skip re-renders.
 */
export function applyChatEventToMessage(message: ChatMessage, event: ChatEvent): ChatMessage {
  const blocks = [...message.blocks];

  switch (event.type) {
    case 'chunk': {
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'text') {
        blocks[blocks.length - 1] = { ...last, content: last.content + event.content, sdkMessageId: event.sdkMessageId };
      } else {
        blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
      }
      return { ...message, blocks };
    }

    case 'tool_start': {
      blocks.push({
        type: 'tool_call',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        arguments: event.args,
        parentToolCallId: event.parentToolCallId,
      });
      return { ...message, blocks };
    }

    case 'tool_progress': {
      const idx = blocks.findIndex((b) => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
      if (idx >= 0) {
        const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
        blocks[idx] = { ...block, output: (block.output || '') + event.message + '\n' };
      }
      return { ...message, blocks };
    }

    case 'tool_output': {
      const idx = blocks.findIndex((b) => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
      if (idx >= 0) {
        const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
        blocks[idx] = { ...block, output: (block.output || '') + event.output };
      }
      return { ...message, blocks };
    }

    case 'tool_done': {
      const idx = blocks.findIndex((b) => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
      if (idx >= 0) {
        const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
        blocks[idx] = {
          ...block,
          status: event.success ? 'done' : 'error',
          ...(event.result && { output: (block.output || '') + event.result }),
          ...(event.error && { error: event.error }),
        };
      }
      return { ...message, blocks };
    }

    case 'permission_request': {
      if (blocks.some((b) => b.type === 'permission' && b.requestId === event.requestId)) {
        return message;
      }
      blocks.push({
        type: 'permission',
        requestId: event.requestId,
        kind: event.kind,
        summary: event.summary,
        outcome: 'pending',
        ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      });
      return { ...message, blocks };
    }

    case 'permission_outcome': {
      const idx = blocks.findIndex((b) => b.type === 'permission' && b.requestId === event.requestId);
      if (idx >= 0) {
        const block = blocks[idx] as Extract<ContentBlock, { type: 'permission' }>;
        blocks[idx] = { ...block, outcome: event.outcome };
      }
      return { ...message, blocks };
    }

    case 'reasoning': {
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'reasoning' && last.reasoningId === event.reasoningId) {
        blocks[blocks.length - 1] = { ...last, content: last.content + event.content };
      } else {
        blocks.push({ type: 'reasoning', reasoningId: event.reasoningId, content: event.content });
      }
      return { ...message, blocks };
    }

    case 'message_final': {
      // Reconciliation: add text only if this sdkMessageId was never streamed via chunks.
      const hasThisMessage = blocks.some((b) => b.type === 'text' && b.sdkMessageId === event.sdkMessageId);
      if (!hasThisMessage && event.content) {
        blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
        return { ...message, blocks };
      }
      return message;
    }

    case 'done':
      return { ...message, isStreaming: false };

    case 'error':
      return {
        ...message,
        isStreaming: false,
        blocks: [...blocks, { type: 'text', content: `Error: ${event.message}` }],
      };

    case 'timeout':
      return {
        ...message,
        isStreaming: false,
        blocks: [...blocks, { type: 'text', content: `Agent timed out after ${Math.round(event.timeoutMs / 1000)}s` }],
      };

    case 'reconnecting':
      return message;

    default:
      return message;
  }
}
