import { describe, it, expect } from 'vitest';
import type { Part, Message } from './types';
import {
  generateMessageId,
  generateContextId,
  createTextMessage,
  serializeMessageToXml,
} from './helpers';

describe('A2A Types', () => {
  describe('createTextMessage', () => {
    it('produces conformant Message with required fields', () => {
      const msg = createTextMessage('sender-1', 'Hello');
      expect(msg.messageId).toBeTruthy();
      expect(typeof msg.messageId).toBe('string');
      expect(msg.role).toBe('user');
      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0].text).toBe('Hello');
      expect(msg.parts[0].mediaType).toBe('text/plain');
      expect(msg.metadata).toBeDefined();
      expect(msg.metadata?.fromId).toBe('sender-1');
    });

    it('includes contextId when provided', () => {
      const msg = createTextMessage('sender-1', 'Hello', { contextId: 'ctx-123' });
      expect(msg.contextId).toBe('ctx-123');
    });

    it('includes hopCount in metadata defaulting to 0', () => {
      const msg = createTextMessage('sender-1', 'Hello');
      expect(msg.metadata?.hopCount).toBe(0);
    });
  });

  describe('Part', () => {
    it('supports text content', () => {
      const part: Part = { text: 'hello', mediaType: 'text/plain' };
      expect(part.text).toBe('hello');
      expect(part.mediaType).toBe('text/plain');
    });

    it('supports data content', () => {
      const part: Part = { data: { key: 'value' }, mediaType: 'application/json' };
      expect(part.data).toEqual({ key: 'value' });
      expect(part.mediaType).toBe('application/json');
    });
  });

  describe('serializeMessageToXml', () => {
    it('produces valid XML envelope', () => {
      const msg = createTextMessage('agent-1', 'Test content', {
        contextId: 'ctx-42',
        fromName: 'Agent One',
      });
      const xml = serializeMessageToXml(msg);
      expect(xml).toContain('<agent-message');
      expect(xml).toContain('from-id="agent-1"');
      expect(xml).toContain('from-name="Agent One"');
      expect(xml).toContain(`message-id="${msg.messageId}"`);
      expect(xml).toContain('context-id="ctx-42"');
      expect(xml).toContain('hop-count="0"');
      expect(xml).toContain('<content>Test content</content>');
    });

    it('escapes special characters in content', () => {
      const msg = createTextMessage('s', 'a < b > c & d "e"');
      const xml = serializeMessageToXml(msg);
      expect(xml).toContain('a &lt; b &gt; c &amp; d &quot;e&quot;');
    });

    it('handles message without contextId', () => {
      const msg = createTextMessage('s', 'hi');
      delete msg.contextId;
      const xml = serializeMessageToXml(msg);
      expect(xml).toContain('context-id=""');
      expect(xml).not.toContain('undefined');
    });
  });

  describe('generateMessageId', () => {
    it('produces unique IDs', () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateContextId', () => {
    it('produces unique IDs with ctx- prefix', () => {
      const id = generateContextId();
      expect(id.startsWith('ctx-')).toBe(true);
    });
  });
});
