import * as fs from 'fs';
import * as path from 'path';
import type { AgentCard, AgentSkill } from './types';
import type { MindContext } from '@chamber/shared/types';
import { Logger } from '../logger';

const log = Logger.create('AgentCardRegistry');

/** Required AgentCard fields for disk-loaded cards. */
const REQUIRED_CARD_FIELDS: ReadonlyArray<keyof AgentCard> = [
  'name',
  'description',
  'version',
  'supportedInterfaces',
  'capabilities',
  'defaultInputModes',
  'defaultOutputModes',
  'skills',
];

export interface LoadExtensionCardsResult {
  loaded: string[];
  skipped: { dir: string; reason: string }[];
}

export class AgentCardRegistry {
  private cards = new Map<string, AgentCard>();

  getCard(mindId: string): AgentCard | null {
    return this.cards.get(mindId) ?? null;
  }

  getCards(): AgentCard[] {
    return [...this.cards.values()];
  }

  getCardByName(name: string): AgentCard | null {
    const matches = this.getCards().filter((c) => c.name === name);
    return matches.length === 1 ? matches[0] : null;
  }

  register(ctx: MindContext): void {
    const skills = this.discoverSkills(ctx.mindPath);
    const description = this.extractDescription(ctx.identity.systemMessage, ctx.identity.name);

    const card: AgentCard = {
      name: ctx.identity.name,
      description,
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills,
      mindId: ctx.mindId,
    };
    this.cards.set(ctx.mindId, card);
  }

  unregister(mindId: string): void {
    this.cards.delete(mindId);
  }

  /**
   * Load AgentCards from `<extensionsRoot>/<dir>/agent-card.json` files.
   *
   * Each card is registered under the synthetic key `extension:<card.name>`,
   * keeping it distinct from in-process Mind cards keyed by mindId.
   * `getCardByName` continues to resolve them by their declared `name`.
   *
   * Invalid cards (missing fields, malformed JSON) are skipped, not thrown,
   * so a single bad extension cannot brick startup. The result describes
   * what was loaded and what was skipped (with reasons) so the composition
   * root can log it.
   */
  loadExtensionCards(extensionsRoot: string): LoadExtensionCardsResult {
    const result: LoadExtensionCardsResult = { loaded: [], skipped: [] };
    if (!fs.existsSync(extensionsRoot)) return result;

    const entries = fs.readdirSync(extensionsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const cardPath = path.join(extensionsRoot, entry.name, 'agent-card.json');
      if (!fs.existsSync(cardPath)) {
        result.skipped.push({ dir: entry.name, reason: 'no agent-card.json' });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(cardPath, 'utf-8'));
      } catch (err) {
        result.skipped.push({ dir: entry.name, reason: `invalid JSON: ${(err as Error).message}` });
        continue;
      }

      const validation = validateAgentCard(parsed);
      if (!validation.ok) {
        result.skipped.push({ dir: entry.name, reason: validation.reason });
        continue;
      }

      const card = parsed as AgentCard;
      const key = `extension:${card.name}`;
      this.cards.set(key, card);
      result.loaded.push(card.name);
      log.info(`Loaded extension AgentCard: ${card.name} (from ${entry.name})`);
    }

    return result;
  }

  private discoverSkills(mindPath: string): AgentSkill[] {
    const skillsDir = path.join(mindPath, '.github', 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const skillMd = path.join(skillsDir, e.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) return null;
        const content = fs.readFileSync(skillMd, 'utf-8');
        const name = this.extractSkillName(content, e.name);
        const description = this.extractSkillDescription(content);
        return { id: e.name, name, description, tags: [e.name] } as AgentSkill;
      })
      .filter((s): s is AgentSkill => s !== null);
  }

  private extractDescription(systemMessage: string, fallbackName: string): string {
    const lines = systemMessage.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) return trimmed;
    }
    return `${fallbackName} agent`;
  }

  private extractSkillName(content: string, fallback: string): string {
    const match = content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : fallback;
  }

  private extractSkillDescription(content: string): string {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) return trimmed;
    }
    return '';
  }
}

type ValidationResult = { ok: true } | { ok: false; reason: string };

function validateAgentCard(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'card is not an object' };
  }
  const card = value as Record<string, unknown>;

  for (const field of REQUIRED_CARD_FIELDS) {
    if (!(field in card)) {
      return { ok: false, reason: `missing required field: ${field}` };
    }
  }

  if (typeof card.name !== 'string' || card.name.length === 0) {
    return { ok: false, reason: 'name must be a non-empty string' };
  }
  if (typeof card.description !== 'string') {
    return { ok: false, reason: 'description must be a string' };
  }
  if (typeof card.version !== 'string') {
    return { ok: false, reason: 'version must be a string' };
  }
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) {
    return { ok: false, reason: 'supportedInterfaces must be a non-empty array' };
  }
  for (const iface of card.supportedInterfaces) {
    if (
      typeof iface !== 'object' || iface === null ||
      typeof (iface as { url?: unknown }).url !== 'string' ||
      typeof (iface as { protocolBinding?: unknown }).protocolBinding !== 'string' ||
      typeof (iface as { protocolVersion?: unknown }).protocolVersion !== 'string'
    ) {
      return { ok: false, reason: 'supportedInterfaces entry is malformed' };
    }
  }
  if (typeof card.capabilities !== 'object' || card.capabilities === null) {
    return { ok: false, reason: 'capabilities must be an object' };
  }
  if (!Array.isArray(card.defaultInputModes)) {
    return { ok: false, reason: 'defaultInputModes must be an array' };
  }
  if (!Array.isArray(card.defaultOutputModes)) {
    return { ok: false, reason: 'defaultOutputModes must be an array' };
  }
  if (!Array.isArray(card.skills)) {
    return { ok: false, reason: 'skills must be an array' };
  }

  return { ok: true };
}
